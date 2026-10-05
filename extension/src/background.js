// Pulls a capture from the YouTube tab, sends it to the yt-to-mp3 server for conversion and lets the
// browser download the result from the server. Same code for Firefox (event page) and Chromium
// (service worker, which cannot create blob URLs for downloads: the server serves the file instead).
'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { serverUrl: '', token: '', format: 'mp3' };

async function settings() {
  return { ...DEFAULTS, ...(await api.storage.local.get(Object.keys(DEFAULTS))) };
}

function serverEndpoint(serverUrl, pathAndQuery) {
  const base = new URL(serverUrl);
  return new URL(pathAndQuery, base.origin + base.pathname.replace(/\/?$/, '/')).toString();
}

async function readError(res) {
  const data = await res.json().catch(() => ({}));
  return data.error || `Server answered HTTP ${res.status}`;
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function badge(text, color) {
  api.action.setBadgeText({ text });
  if (color) api.action.setBadgeBackgroundColor({ color });
}

async function pullCapture(tabId, meta) {
  const parts = [];
  const count = Math.ceil(meta.size / meta.chunkSize);
  try {
    for (let index = 0; index < count; index++) {
      const answer = await api.tabs.sendMessage(tabId, { cmd: 'chunk', transferId: meta.transferId, index });
      if (!answer?.ok) throw new Error(answer?.error ?? 'Transfer from the tab failed.');
      parts.push(fromBase64(answer.data));
    }
  } finally {
    api.tabs.sendMessage(tabId, { cmd: 'release', transferId: meta.transferId }).catch(() => {});
  }
  return new Blob(parts, { type: meta.status.mime });
}

async function processTab(tabId, format) {
  const { serverUrl, token } = await settings();
  if (!serverUrl || !token) return { ok: false, error: 'Set the server URL and token in the extension settings.' };

  const meta = await api.tabs.sendMessage(tabId, { cmd: 'export' });
  if (!meta?.ok) return { ok: false, error: meta?.error ?? 'The YouTube tab did not answer. Reload it.' };
  const blob = await pullCapture(tabId, meta);

  const query = new URLSearchParams({ format, title: meta.status.title ?? '', delivery: 'link' });
  if (meta.status.author) query.set('artist', meta.status.author);
  const res = await fetch(serverEndpoint(serverUrl, `api/convert?${query}`), {
    method: 'POST',
    headers: { 'Content-Type': meta.status.mime, Authorization: `Bearer ${token}` },
    body: blob,
    credentials: 'omit',
  });
  if (!res.ok) return { ok: false, error: await readError(res) };

  const { url, filename } = await res.json();
  await api.downloads.download({ url: serverEndpoint(serverUrl, url), filename, saveAs: false });
  return { ok: true, filename };
}

async function ping(serverUrl, token) {
  const res = await fetch(serverEndpoint(serverUrl, 'api/convert/ping'), {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
  });
  if (!res.ok) {
    return { ok: false, error: res.status === 404 ? 'Conversion API disabled on this server (CONVERT_TOKEN not set).' : await readError(res) };
  }
  return { ok: true, ...(await res.json()) };
}

const handlers = {
  async process({ tabId, format }) {
    badge('…', '#3563e9');
    try {
      const result = await processTab(tabId, format);
      badge(result.ok ? '✓' : '!', result.ok ? '#22c55e' : '#dc2626');
      return result;
    } catch (err) {
      badge('!', '#dc2626');
      throw err;
    } finally {
      setTimeout(() => badge(''), 8000);
    }
  },

  async ping({ serverUrl, token }) {
    try {
      return await ping(serverUrl, token);
    } catch (err) {
      return { ok: false, error: `Cannot reach the server: ${err instanceof Error ? err.message : err}` };
    }
  },
};

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.cmd];
  if (!handler) return false;
  handler(message).then(sendResponse, (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});
