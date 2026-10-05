// End-to-end check of the Chromium (Brave/Chrome) build on real YouTube, outside CI.
// Needs: the server on SERVER_URL with CONVERT_TOKEN=TOKEN, and the extension built with
//   EXTRA_HOST_PERMISSIONS=http://localhost/* node scripts/build.mjs chromium
// Usage (from e2e/, repo at /w): SERVER_URL=http://localhost:8087/ TOKEN=... node tools/extension-chromium.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extensionPath = '/w/extension/dist/chromium';
const video = process.env.VIDEO || 'jNQXAC9IVRw';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt2mp3-ext-'));

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  locale: 'en-US',
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
console.log('extension id:', new URL(worker.url()).host);

await worker.evaluate(({ serverUrl, token }) => chrome.storage.local.set({ serverUrl, token }), {
  serverUrl: process.env.SERVER_URL,
  token: process.env.TOKEN,
});
const ping = await worker.evaluate(({ serverUrl, token }) => handlers.ping({ serverUrl, token }), {
  serverUrl: process.env.SERVER_URL,
  token: process.env.TOKEN,
});
console.log('ping:', JSON.stringify(ping));

await context.addCookies([{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }]);
const page = await context.newPage();
await page.goto(`https://www.youtube.com/watch?v=${video}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('video', { timeout: 30000 });
await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; v.play().catch(() => {}); });

const tabStatus = () => worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  return chrome.tabs.sendMessage(tab.id, { cmd: 'status' });
});
let status;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  status = await tabStatus();
  if (status?.complete) break;
}
console.log('status:', JSON.stringify(status));

for (const format of (process.env.FORMATS || 'mp3,original').split(',')) {
  const result = await worker.evaluate(async (format) => {
    const [tab] = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
    return handlers.process({ tabId: tab.id, format });
  }, format);
  console.log(`process ${format}:`, JSON.stringify(result));
}

let downloads = [];
for (let i = 0; i < 30; i++) {
  downloads = await worker.evaluate(() => chrome.downloads.search({}));
  if (downloads.length && downloads.every(d => d.state !== 'in_progress')) break;
  await page.waitForTimeout(500);
}
for (const d of downloads) {
  console.log('download:', d.state, path.basename(d.filename), d.fileSize, 'bytes', d.error ?? '');
  if (d.state === 'complete') fs.copyFileSync(d.filename, `/w/shots/${path.basename(d.filename)}`);
}
await context.close();
