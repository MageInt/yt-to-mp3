import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { buildYtDlpArgs } from '../src/services/downloadManager.js';
import { getAudioFormat } from '../src/services/audioFormats.js';

const mp3 = getAudioFormat('mp3')!;
const video = { url: 'https://www.youtube.com/watch?v=abc', tmpDir: '/tmp/x', isPlaylist: false, format: mp3 };
const playlist = { url: 'https://www.youtube.com/playlist?list=PL1', tmpDir: '/tmp/x', isPlaylist: true, format: mp3 };

afterEach(() => {
  config.ytdlpProxy = '';
});

test('URL is always last, right after --', () => {
  const args = buildYtDlpArgs(video);
  assert.deepEqual(args.slice(-2), ['--', video.url]);
});

test('single video disables playlists, playlist is capped', () => {
  assert.ok(buildYtDlpArgs(video).includes('--no-playlist'));
  const args = buildYtDlpArgs(playlist);
  assert.equal(args[args.indexOf('--playlist-end') + 1], String(config.maxPlaylistItems));
});

test('no --proxy by default', () => {
  assert.ok(!buildYtDlpArgs(video).includes('--proxy'));
});

test('YTDLP_PROXY is passed to yt-dlp before the URL', () => {
  config.ytdlpProxy = 'http://192.168.1.10:8890';
  const args = buildYtDlpArgs(video);
  const i = args.indexOf('--proxy');
  assert.equal(args[i + 1], 'http://192.168.1.10:8890');
  assert.ok(i < args.indexOf('--'));
});

test('audio format is passed to yt-dlp', () => {
  const args = buildYtDlpArgs({ ...video, format: getAudioFormat('ogg')! });
  assert.equal(args[args.indexOf('--audio-format') + 1], 'vorbis');
});
