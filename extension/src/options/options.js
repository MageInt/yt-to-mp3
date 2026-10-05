'use strict';

const $ = (id) => document.getElementById(id);

function originPattern(url) {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

function setResult(text, ok) {
  $('result').textContent = text;
  $('result').className = `result ${ok ? 'ok' : 'error'}`;
}

async function init() {
  const { serverUrl = '', token = '' } = await browser.storage.local.get(['serverUrl', 'token']);
  $('server').value = serverUrl;
  $('token').value = token;

  $('toggle-token').addEventListener('click', () => {
    const shown = $('token').type === 'text';
    $('token').type = shown ? 'password' : 'text';
    $('toggle-token').textContent = shown ? 'Show' : 'Hide';
  });

  $('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    let serverUrl;
    try {
      const url = new URL($('server').value.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      serverUrl = url.toString();
    } catch {
      setResult('Enter a valid http(s) URL.', false);
      return;
    }
    const token = $('token').value.trim();

    // The background script needs host access to call the server without CORS restrictions.
    const granted = await browser.permissions.request({ origins: [originPattern(serverUrl)] });
    if (!granted) {
      setResult('Access to the server was not granted.', false);
      return;
    }

    $('save').disabled = true;
    setResult('Testing…', true);
    const answer = await browser.runtime.sendMessage({ cmd: 'ping', serverUrl, token });
    $('save').disabled = false;
    if (!answer?.ok) {
      setResult(answer?.error ?? 'The server did not answer.', false);
      return;
    }
    await browser.storage.local.set({ serverUrl, token });
    setResult(`✓ Connected. Uploads up to ${answer.maxUploadMb} MB.`, true);
  });
}

init();
