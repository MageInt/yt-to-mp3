// Manual smoke test of extension/src/inject.js on real YouTube (Chromium, same MSE API as Firefox).
// Not run in CI: YouTube stops serving headless browsers after ~60 s and may block CI IPs.
// Usage (from e2e/, repo mounted at /w): node tools/extension-capture.mjs  [VIDEO=<id>] [MAX_SECONDS=60]
// Writes /w/shots/capture.<ext>, which can then be sent to POST /api/convert.
import { chromium } from '@playwright/test';
import fs from 'fs';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  locale: 'en-US',
});
await ctx.addCookies([
  { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' },
  { name: 'CONSENT', value: 'YES+', domain: '.youtube.com', path: '/' },
]);
await ctx.addInitScript({ path: '/w/extension/src/inject.js' });
const page = await ctx.newPage();

const ask = (cmd) => page.evaluate((cmd) => new Promise((resolve) => {
  const id = Math.random().toString(36).slice(2);
  const onMessage = (e) => {
    if (e.data?.channel === 'yt2mp3:page' && e.data.id === id) {
      window.removeEventListener('message', onMessage);
      const r = e.data.result;
      if (r.buffer) {
        const bytes = new Uint8Array(r.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        resolve({ status: r.status, base64: btoa(bin) });
      } else resolve(r);
    }
  };
  window.addEventListener('message', onMessage);
  window.postMessage({ channel: 'yt2mp3:ext', id, cmd }, '*');
}), cmd);

await page.goto('https://www.youtube.com/watch?v=' + (process.env.VIDEO || 'jNQXAC9IVRw'), { waitUntil: 'domcontentloaded' });
console.log('url:', page.url());
await page.waitForSelector('video', { timeout: 30000 });
await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; v.play().catch(() => {}); });

let status;
for (let i = 0; i < Number(process.env.MAX_SECONDS || 60); i++) {
  await page.waitForTimeout(1000);
  status = await ask('status');
  if (i % 15 === 0) console.log('video:', JSON.stringify(await page.evaluate(() => { const v = document.querySelector('video'); const p = document.getElementById('movie_player'); return { t: v?.currentTime?.toFixed(1), paused: v?.paused, rate: v?.playbackRate, ad: p?.classList.contains('ad-showing'), state: p?.getPlayerState?.(), err: document.querySelector('.ytp-error')?.textContent?.slice(0, 120) }; })));
  if (i % 15 === 0) console.log('t+' + i + 's', JSON.stringify({ available: status.available, covered: status.covered?.toFixed?.(1), duration: status.duration, bytes: status.bytes, complete: status.complete, gaps: status.gaps }));
  if (status.complete) break;
}
console.log('final status:', JSON.stringify(status));
fs.mkdirSync('/w/shots', { recursive: true });
const exported = await ask('export');
if (exported.base64) {
  fs.writeFileSync('/w/shots/capture.' + exported.status.ext, Buffer.from(exported.base64, 'base64'));
  console.log('exported', exported.status.mime, Buffer.from(exported.base64, 'base64').length, 'bytes');
} else console.log('export error:', exported.error);
await browser.close();
