// Isolated-world bridge between the page hook (inject.js) and the extension.
// Works in Firefox and Chromium: runtime messages are JSON in Chromium, so the capture is handed
// over in base64 chunks pulled by the background script.
'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const CHANNEL_IN = 'yt2mp3:ext';
const CHANNEL_OUT = 'yt2mp3:page';
const CHUNK_SIZE = 2 * 1024 * 1024;
const pending = new Map();
let nextId = 1;
let transfer = null;

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

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const handlers = {
  status: () => askPage('status'),

  // Snapshots the capture; the background then pulls it with `chunk` and frees it with `release`.
  async export() {
    const result = await askPage('export', 30000);
    if (result.error) return { ok: false, error: result.error };
    transfer = { id: crypto.randomUUID(), bytes: new Uint8Array(result.buffer).slice() };
    return {
      ok: true,
      transferId: transfer.id,
      size: transfer.bytes.byteLength,
      chunkSize: CHUNK_SIZE,
      status: JSON.parse(JSON.stringify(result.status)),
    };
  },

  chunk({ transferId, index }) {
    if (!transfer || transfer.id !== transferId) return { ok: false, error: 'The capture is no longer available. Try again.' };
    return { ok: true, data: toBase64(transfer.bytes.subarray(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)) };
  },

  release({ transferId }) {
    if (transfer?.id === transferId) transfer = null;
    return { ok: true };
  },
};

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.cmd];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(message))
    .then(sendResponse, (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});
