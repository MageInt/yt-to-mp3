'use strict';

const FORMATS = [
  { id: 'mp3', label: 'MP3', hint: 'Converted on your server, plays everywhere' },
  { id: 'm4a', label: 'M4A', hint: 'AAC, converted on your server' },
  { id: 'opus', label: 'Opus', hint: 'Usually no re-encoding (YouTube audio is Opus)' },
  { id: 'ogg', label: 'OGG', hint: 'Vorbis, converted on your server' },
  { id: 'flac', label: 'FLAC', hint: 'Lossless container, larger files' },
  { id: 'wav', label: 'WAV', hint: 'Uncompressed, for editing' },
  { id: 'original', label: 'Original', hint: 'Raw capture (.webm / .m4a), no server needed' },
];
const YOUTUBE_ORIGINS = ['*://www.youtube.com/*', '*://music.youtube.com/*', '*://m.youtube.com/*'];

const $ = (id) => document.getElementById(id);
let tabId = null;
let format = 'mp3';
let lastStatus = null;
let busy = false;

function show(stateId) {
  for (const id of ['state-permission', 'state-not-youtube', 'state-waiting', 'state-capture']) {
    $(id).hidden = id !== stateId;
  }
}

function clock(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function size(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

function renderFormats() {
  const picker = $('format-picker');
  picker.replaceChildren(
    ...FORMATS.map((f) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(f.id === format));
      button.textContent = f.label;
      button.disabled = busy;
      button.addEventListener('click', () => {
        format = f.id;
        browser.storage.local.set({ format });
        renderFormats();
        renderAction();
      });
      return button;
    }),
  );
  $('format-hint').textContent = FORMATS.find((f) => f.id === format)?.hint ?? '';
}

function renderAction() {
  const action = $('action');
  const label = format === 'original' ? 'Save original' : `Convert to ${FORMATS.find((f) => f.id === format).label}`;
  action.textContent = busy ? 'Working…' : lastStatus?.complete ? label : `${label} anyway`;
  action.disabled = busy || !lastStatus?.available || lastStatus.protected;
}

function renderStatus(status) {
  lastStatus = status;
  $('state-protected').hidden = !status?.protected;
  if (!status?.available) {
    show('state-waiting');
    return;
  }
  show('state-capture');
  $('capture-title').textContent = status.title || status.videoId;
  $('capture-author').textContent = status.author || '';
  const pct = status.duration ? Math.min(100, (status.covered / status.duration) * 100) : 0;
  $('capture-bar').style.width = `${pct}%`;
  $('capture-time').textContent = `${clock(status.covered)} / ${clock(status.duration)}`;
  $('capture-size').textContent = `${size(status.bytes)} · ${status.ext}`;

  const badgeEl = $('capture-badge');
  badgeEl.className = `badge push-right ${status.complete ? 'badge-success' : 'badge-warning'}`;
  badgeEl.textContent = status.complete ? '✓ Complete' : `${Math.round(pct)} %`;

  const hint = $('capture-hint');
  hint.classList.toggle('warning', !status.complete);
  if (status.truncated) hint.textContent = 'Capture stopped: the file reached the 300 MB limit.';
  else if (status.formatChanged) hint.textContent = 'The audio format changed during playback: the file may be unusable. Reload and play again.';
  else if (status.gaps > 0) hint.textContent = `${status.gaps} gap(s): parts were skipped. Seek back to play them.`;
  else if (!status.complete) hint.textContent = 'Keep playing until the end, without skipping.';
  else hint.textContent = 'Ready to save.';
  renderAction();
}

async function refresh() {
  if (busy || tabId === null) return;
  try {
    renderStatus(await browser.tabs.sendMessage(tabId, { cmd: 'status' }));
  } catch {
    show('state-waiting');
  }
}

async function run() {
  busy = true;
  renderFormats();
  renderAction();
  const result = $('result');
  result.hidden = true;
  try {
    const answer = await browser.tabs.sendMessage(tabId, { cmd: 'export', mode: format === 'original' ? 'original' : 'convert', format });
    result.className = `result ${answer?.ok ? 'ok' : 'error'}`;
    result.textContent = answer?.ok ? `✓ Saved ${answer.filename}` : answer?.error ?? 'Something went wrong.';
  } catch (err) {
    result.className = 'result error';
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    result.hidden = false;
    busy = false;
    renderFormats();
    renderAction();
  }
}

async function init() {
  $('open-settings').addEventListener('click', () => browser.runtime.openOptionsPage());
  $('action').addEventListener('click', run);
  $('grant-youtube').addEventListener('click', async () => {
    if (await browser.permissions.request({ origins: YOUTUBE_ORIGINS })) {
      $('state-permission').hidden = true;
      show('state-waiting');
    }
  });

  format = (await browser.storage.local.get('format')).format ?? 'mp3';
  renderFormats();

  if (!(await browser.permissions.contains({ origins: YOUTUBE_ORIGINS }))) {
    show('state-permission');
    return;
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/(www|music|m)\.youtube\.com\//.test(tab.url)) {
    show('state-not-youtube');
    return;
  }
  tabId = tab.id;
  await refresh();
  setInterval(refresh, 1000);
}

init();
