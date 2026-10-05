#!/usr/bin/env python3
"""End-to-end check of the Firefox build in a real Firefox, outside CI (raw WebDriver, no deps).

Needs: a WebDriver server for Firefox on WEBDRIVER (e.g. selenium/standalone-firefox, host network),
the yt-to-mp3 server on SERVER_URL with CONVERT_TOKEN=TOKEN, and the Firefox build zipped at ADDON_ZIP,
built with EXTRA_HOST_PERMISSIONS=http://localhost/* (automated browsers cannot click the prompt).
Firefox downloads land in DOWNLOAD_DIR inside the browser container.
"""
import base64, json, os, sys, time, urllib.request

WD = os.environ.get('WEBDRIVER', 'http://localhost:4444')
SERVER_URL = os.environ['SERVER_URL']
TOKEN = os.environ['TOKEN']
VIDEO = os.environ.get('VIDEO', 'jNQXAC9IVRw')
UUID = '6d1f4a9e-2b7c-4f31-9a5e-0c8d7e6f5a41'
ADDON_ID = 'yt-to-mp3-capture@mageint'


def call(method, path, body=None):
    req = urllib.request.Request(WD + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            return json.load(res)['value']
    except urllib.error.HTTPError as err:
        sys.exit(f'{method} {path} -> {err.code} {err.read().decode()[:500]}')


caps = {'capabilities': {'alwaysMatch': {'browserName': 'firefox', 'moz:firefoxOptions': {
    # geckodriver must run with --allow-system-access: the test opens the extension page from the
    # browser chrome (WebDriver
    # refuses to navigate to moz-extension:// URLs).
    'args': ['-headless'],
    'prefs': {
        'extensions.webextensions.uuids': json.dumps({ADDON_ID: UUID}),
        'media.autoplay.default': 0,
        'browser.download.folderList': 2,
        'browser.download.dir': os.environ.get('DOWNLOAD_DIR', '/tmp/dl'),
        'browser.download.useDownloadDir': True,
        'browser.download.always_ask_before_handling_new_types': False,
    }}}}}
session = call('POST', '/session', caps)
sid = session['sessionId']
print('firefox', session['capabilities'].get('browserVersion'))
try:
    with open(os.environ['ADDON_ZIP'], 'rb') as f:
        addon = base64.b64encode(f.read()).decode()
    print('addon installed:', call('POST', f'/session/{sid}/moz/addon/install', {'addon': addon, 'temporary': True}))
    call('POST', f'/session/{sid}/timeouts', {'script': 240000})

    call('POST', f'/session/{sid}/url', {'url': 'https://www.youtube.com/'})
    call('POST', f'/session/{sid}/cookie', {'cookie': {'name': 'SOCS', 'value': 'CAI', 'domain': '.youtube.com', 'path': '/'}})
    call('POST', f'/session/{sid}/url', {'url': f'https://www.youtube.com/watch?v={VIDEO}'})
    time.sleep(5)
    call('POST', f'/session/{sid}/execute/sync', {'script': "const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => {}); } return Boolean(v);", 'args': []})

    before = set(call('GET', f'/session/{sid}/window/handles'))
    call('POST', f'/session/{sid}/moz/context', {'context': 'chrome'})
    call('POST', f'/session/{sid}/execute/sync', {'script': '''
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      win.gBrowser.selectedTab = win.gBrowser.addTab(arguments[0], {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      return true;''', 'args': [f'moz-extension://{UUID}/src/options/options.html']})
    call('POST', f'/session/{sid}/moz/context', {'context': 'content'})
    time.sleep(2)
    new_handle = (set(call('GET', f'/session/{sid}/window/handles')) - before).pop()
    call('POST', f'/session/{sid}/window', {'handle': new_handle})
    print('extension page:', call('GET', f'/session/{sid}/url'))

    script = """
    const [serverUrl, token, done] = arguments;
    (async () => {
      const ping = await browser.runtime.sendMessage({ cmd: 'ping', serverUrl, token });
      await browser.storage.local.set({ serverUrl, token });
      const [tab] = await browser.tabs.query({ url: '*://www.youtube.com/*' });
      let status;
      for (let i = 0; i < 60; i++) {
        try { status = await browser.tabs.sendMessage(tab.id, { cmd: 'status' }); } catch (e) { status = { error: String(e) }; }
        if (status?.complete) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      const results = {};
      for (const format of ['mp3', 'original']) {
        results[format] = await browser.runtime.sendMessage({ cmd: 'process', tabId: tab.id, format });
      }
      await new Promise(r => setTimeout(r, 3000));
      const downloads = (await browser.downloads.search({})).map(d => ({ state: d.state, file: d.filename, size: d.fileSize, error: d.error }));
      done({ ping, status, results, downloads });
    })().catch(e => done({ error: String(e), stack: e.stack }));
    """
    out = call('POST', f'/session/{sid}/execute/async', {'script': script, 'args': [SERVER_URL, TOKEN]})
    print(json.dumps(out, indent=2))
finally:
    call('DELETE', f'/session/{sid}')
