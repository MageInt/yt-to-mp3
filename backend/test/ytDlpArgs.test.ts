import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { buildYtDlpArgs, summarizeError, BOT_CHECK_ERRORS } from '../src/services/downloadManager.js';
import { getAudioFormat } from '../src/services/audioFormats.js';

const mp3 = getAudioFormat('mp3')!;
const video = { url: 'https://www.youtube.com/watch?v=abc', tmpDir: '/tmp/x', isPlaylist: false, format: mp3 };
const playlist = { url: 'https://www.youtube.com/playlist?list=PL1', tmpDir: '/tmp/x', isPlaylist: true, format: mp3 };

afterEach(() => {
  config.ytdlpProxy = '';
  config.ytdlpCookiesFile = '';
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

test('cookies: yt-dlp only gets the jar path it is given', () => {
  assert.ok(!buildYtDlpArgs(video).includes('--cookies'));
  const args = buildYtDlpArgs(video, '/dev/shm/yt2mp3-x/cookies.txt');
  assert.equal(args[args.indexOf('--cookies') + 1], '/dev/shm/yt2mp3-x/cookies.txt');
  assert.ok(args.indexOf('--cookies') < args.indexOf('--'));
});

const BOT_OUTPUT = "ERROR: [youtube] THh5ykVxpSg: Sign in to confirm you\u2019re not a bot. Use --cookies-from-browser or --cookies";

test('bot check error is translated into an actionable message', () => {
  assert.equal(summarizeError(BOT_OUTPUT), BOT_CHECK_ERRORS.none);
  assert.equal(summarizeError(BOT_OUTPUT, 'session'), BOT_CHECK_ERRORS.session);
  assert.equal(summarizeError(BOT_OUTPUT, 'server'), BOT_CHECK_ERRORS.server);
  assert.match(BOT_CHECK_ERRORS.session, /expired/);
});

test('other errors keep the ERROR: lines only', () => {
  assert.equal(summarizeError('[info] x\nERROR: Video unavailable\n'), 'ERROR: Video unavailable');
});

test('user agent is forwarded only when present', () => {
  assert.ok(!buildYtDlpArgs(video).includes('--user-agent'));
  const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
  const args = buildYtDlpArgs({ ...video, userAgent: ua });
  assert.equal(args[args.indexOf('--user-agent') + 1], ua);
  assert.ok(args.indexOf('--user-agent') < args.indexOf('--'));
});
