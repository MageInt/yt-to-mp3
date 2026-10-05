#!/usr/bin/env node
// Stand-in for ffmpeg in tests: copies the -i input to the output path (last argument).
import fs from 'fs';

const args = process.argv.slice(2);
if (process.env.FAKE_FFMPEG_FAIL) {
  console.error('Invalid data found when processing input');
  process.exit(1);
}
fs.copyFileSync(args[args.indexOf('-i') + 1], args[args.length - 1]);
