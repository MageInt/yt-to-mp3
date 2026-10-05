#!/usr/bin/env node
// Stand-in for yt-dlp in tests: prints progress, waits FAKE_YTDLP_DELAY_MS, writes the output file.
import fs from 'fs';

const args = process.argv.slice(2);
const template = args[args.indexOf('-o') + 1];
const audioFormat = args[args.indexOf('--audio-format') + 1];
const ext = { vorbis: 'ogg' }[audioFormat] ?? audioFormat;
const delay = Number(process.env.FAKE_YTDLP_DELAY_MS ?? 200);

if (process.env.FAKE_YTDLP_FAIL === 'bot') {
  console.error("ERROR: [youtube] abc: Sign in to confirm you're not a bot.");
  process.exit(1);
}

console.log('[download]   0.0% of 1.00MiB');
setTimeout(() => {
  console.log('[download] 100.0% of 1.00MiB');
  const file = template.replace('%(playlist_index)s', '1').replace('%(title)s', 'Fake').replace('%(ext)s', ext);
  fs.writeFileSync(file, 'fake audio');
  process.exit(0);
}, delay);

process.on('SIGTERM', () => process.exit(143));
