// Isolated-world bridge between the page hook (inject.js) and the extension.
'use strict';

const CHANNEL_IN = 'yt2mp3:ext';
const CHANNEL_OUT = 'yt2mp3:page';
const pending = new Map();
let nextId = 1;

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.channel !== CHANNEL_OUT) return;
  const resolve = pending.get(event.data.id);
  if (resolve) {
    pending.delete(event.data.id);
    resolve(event.data.result);
  }
});

function askPage(cmd, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${nextId++}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The page did not answer. Reload the YouTube tab.'));
    }, timeoutMs);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    window.postMessage({ channel: CHANNEL_IN, id, cmd }, '*');
  });
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.cmd === 'status') {
    return askPage('status');
  }
  if (message?.cmd === 'export') {
    const result = await askPage('export', 30000);
    if (result.error) return { ok: false, error: result.error };
    // Copy into this compartment before handing it to the background script.
    const buffer = new Uint8Array(result.buffer).slice().buffer;
    return browser.runtime.sendMessage({
      cmd: 'process',
      mode: message.mode,
      format: message.format,
      status: { ...result.status },
      buffer,
    });
  }
  return undefined;
});
