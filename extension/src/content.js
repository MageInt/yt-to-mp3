// Isolated-world bridge between the page hook (inject.js) and the extension.
// Works in Firefox and Chromium. The page only sends JSON strings (Firefox wraps page objects in
// Xrays that forbid copying binary data), and runtime messages are JSON in Chromium, so the capture
// stays base64 and is pulled by the background script in chunks.
'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const CHANNEL_IN = 'yt2mp3:ext';
const CHANNEL_OUT = 'yt2mp3:page';
// Base64 characters per chunk (multiple of 4, ~2 MB of audio).
const CHUNK_CHARS = 4 * 699_051;
const pending = new Map();
let nextId = 1;
let transfer = null;

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.channel !== CHANNEL_OUT) return;
  const id = event.data.id;
  const json = event.data.json;
  const resolve = pending.get(id);
  if (resolve && typeof json === 'string') {
    pending.delete(id);
    resolve(JSON.parse(json));
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

const handlers = {
  status: () => askPage('status'),

  // Snapshots the capture; the background then pulls it with `chunk` and frees it with `release`.
  async export() {
    const result = await askPage('export', 30000);
    if (result.error) return { ok: false, error: result.error };
    transfer = { id: crypto.randomUUID(), base64: result.base64 };
    return {
      ok: true,
      transferId: transfer.id,
      size: transfer.base64.length,
      chunkSize: CHUNK_CHARS,
      status: result.status,
    };
  },

  chunk({ transferId, index }) {
    if (!transfer || transfer.id !== transferId) return { ok: false, error: 'The capture is no longer available. Try again.' };
    return { ok: true, data: transfer.base64.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) };
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
