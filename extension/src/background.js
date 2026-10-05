// Sends captured audio to the yt-to-mp3 server for conversion (or saves it as is) and downloads the result.
'use strict';

const DEFAULTS = { serverUrl: '', token: '', format: 'mp3' };

async function settings() {
  return { ...DEFAULTS, ...(await browser.storage.local.get(Object.keys(DEFAULTS))) };
}

function safeName(title, ext) {
  const base = String(title || 'audio').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
  return `${base || 'audio'}.${ext}`;
}

function serverEndpoint(serverUrl, pathAndQuery) {
  const base = new URL(serverUrl);
  return new URL(pathAndQuery, base.origin + base.pathname.replace(/\/?$/, '/')).toString();
}

async function readError(res) {
  const data = await res.json().catch(() => ({}));
  return data.error || `Server answered HTTP ${res.status}`;
}

async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function badge(text, color) {
  browser.action.setBadgeText({ text });
  if (color) browser.action.setBadgeBackgroundColor({ color });
}

async function processCapture({ mode, format, status, buffer }) {
  const blob = new Blob([buffer], { type: status.mime });

  if (mode === 'original') {
    const filename = safeName(status.title, status.ext);
    await download(blob, filename);
    return { ok: true, filename };
  }

  const { serverUrl, token } = await settings();
  if (!serverUrl || !token) return { ok: false, error: 'Set the server URL and token in the extension settings.' };

  const query = new URLSearchParams({ format, title: status.title ?? '' });
  if (status.author) query.set('artist', status.author);
  const res = await fetch(serverEndpoint(serverUrl, `api/convert?${query}`), {
    method: 'POST',
    headers: { 'Content-Type': status.mime, Authorization: `Bearer ${token}` },
    body: blob,
    credentials: 'omit',
  });
  if (!res.ok) return { ok: false, error: await readError(res) };

  const extension = { ogg: 'ogg', opus: 'opus', m4a: 'm4a', flac: 'flac', wav: 'wav' }[format] ?? 'mp3';
  const filename = safeName(status.title, extension);
  await download(await res.blob(), filename);
  return { ok: true, filename };
}

async function ping(serverUrl, token) {
  const res = await fetch(serverEndpoint(serverUrl, 'api/convert/ping'), {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
  });
  if (!res.ok) return { ok: false, error: res.status === 404 ? 'Conversion API disabled on this server (CONVERT_TOKEN not set).' : await readError(res) };
  return { ok: true, ...(await res.json()) };
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.cmd === 'process') {
    badge('…', '#3563e9');
    try {
      const result = await processCapture(message);
      badge(result.ok ? '✓' : '!', result.ok ? '#22c55e' : '#dc2626');
      return result;
    } catch (err) {
      badge('!', '#dc2626');
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      setTimeout(() => badge(''), 8000);
    }
  }
  if (message?.cmd === 'ping') {
    try {
      return await ping(message.serverUrl, message.token);
    } catch (err) {
      return { ok: false, error: `Cannot reach the server: ${err instanceof Error ? err.message : err}` };
    }
  }
  return undefined;
});
