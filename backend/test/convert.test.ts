import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { getAudioFormat } from '../src/services/audioFormats.js';
import { buildFfmpegArgs, cleanMetadata, safeFilename } from '../src/services/converter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'test-token-0123456789-abcdefghij';
const AUDIO = Buffer.from('fake webm audio bytes');

let server: Server;
let baseUrl: string;

before(async () => {
  config.ffmpegPath = path.join(here, 'fixtures', 'fake-ffmpeg.mjs');
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  config.convertToken = TOKEN;
  config.maxUploadBytes = 200 * 1024 * 1024;
  delete process.env.FAKE_FFMPEG_FAIL;
});

function convert(query: string, { body = AUDIO, type = 'audio/webm', token = TOKEN, origin }: { body?: Buffer; type?: string; token?: string | null; origin?: string } = {}) {
  return fetch(`${baseUrl}/api/convert?${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': type,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: new Uint8Array(body),
  });
}

test('conversion API is hidden when no token is configured', async () => {
  config.convertToken = '';
  assert.equal((await convert('format=mp3')).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/convert/ping`)).status, 404);
});

test('missing or wrong token is refused', async () => {
  assert.equal((await convert('format=mp3', { token: null })).status, 401);
  assert.equal((await convert('format=mp3', { token: 'wrong-token-wrong-token-wrong' })).status, 401);
  const ping = await fetch(`${baseUrl}/api/convert/ping`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(ping.status, 401);
});

test('ping with a valid token lists formats', async () => {
  const res = await fetch(`${baseUrl}/api/convert/ping`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.formats.some((f: { id: string }) => f.id === 'flac'));
});

test('converts and returns the file with a safe name, even from an extension origin', async () => {
  const res = await convert('format=mp3&title=My%20Song%20%2F%20Live&artist=Someone', { origin: 'moz-extension://1234-abcd' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /filename="My Song _ Live\.mp3"/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), AUDIO);
});

test('rejects unknown input types, formats and empty bodies', async () => {
  assert.equal((await convert('format=mp3', { type: 'video/mp4' })).status, 415);
  assert.equal((await convert('format=exe')).status, 400);
  assert.equal((await convert('format=mp3', { body: Buffer.alloc(0) })).status, 400);
});

test('rejects uploads above MAX_UPLOAD_MB', async () => {
  config.maxUploadBytes = 10;
  assert.equal((await convert('format=mp3')).status, 413);
});

test('ffmpeg failure is reported as 422', async () => {
  process.env.FAKE_FFMPEG_FAIL = '1';
  const res = await convert('format=mp3');
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Could not convert/);
});

test('ffmpeg arguments: fixed demuxer, file protocol only, stream copy when possible', () => {
  const opus = buildFfmpegArgs('/t/in.webm', 'webm', getAudioFormat('opus')!, '/t/out.opus', { title: 'T' });
  assert.deepEqual(opus.slice(opus.indexOf('-protocol_whitelist'), opus.indexOf('-protocol_whitelist') + 2), ['-protocol_whitelist', 'file']);
  assert.equal(opus[opus.indexOf('-f') + 1], 'matroska');
  assert.equal(opus[opus.indexOf('-c:a') + 1], 'copy');
  assert.ok(opus.includes('title=T'));
  assert.equal(opus[opus.length - 1], '/t/out.opus');

  const m4aFromMp4 = buildFfmpegArgs('/t/in.mp4', 'mp4', getAudioFormat('m4a')!, '/t/out.m4a', {});
  assert.equal(m4aFromMp4[m4aFromMp4.indexOf('-f') + 1], 'mov');
  assert.equal(m4aFromMp4[m4aFromMp4.indexOf('-c:a') + 1], 'copy');

  const mp3 = buildFfmpegArgs('/t/in.webm', 'webm', getAudioFormat('mp3')!, '/t/out.mp3', {});
  assert.equal(mp3[mp3.indexOf('-c:a') + 1], 'libmp3lame');
});

test('metadata and filenames are sanitized', () => {
  assert.equal(cleanMetadata('a\u0000b\nc   d'), 'a b c d');
  assert.equal(cleanMetadata(''), undefined);
  assert.equal(cleanMetadata(['x']), undefined);
  assert.equal(cleanMetadata('x'.repeat(500))!.length, 200);
  assert.equal(safeFilename('../../etc/passwd', 'mp3'), '_.._etc_passwd.mp3');
  assert.equal(safeFilename(undefined, 'flac'), 'audio.flac');
  assert.equal(safeFilename('a:b*c?"d<e>f|g', 'wav'), 'a_b_c__d_e_f_g.wav');
});
