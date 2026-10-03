import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateYoutubeUrl } from '../src/services/urlValidator.js';

test('accepts YouTube URLs', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=VCuS3enPwKI',
    'https://youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://music.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://www.youtube.com/shorts/abc123',
    'https://www.youtube.com/watch?v=abc&list=PL123&index=3',
    'http://WWW.YOUTUBE.COM/watch?v=abc',
    '  https://youtu.be/abc  ',
  ]) {
    assert.equal(validateYoutubeUrl(url).ok, true, url);
  }
});

test('rejects missing or non-string input', () => {
  for (const input of [undefined, null, '', 42, {}, ['https://youtu.be/abc']]) {
    assert.deepEqual(validateYoutubeUrl(input), { ok: false, error: 'URL is required' });
  }
});

test('rejects malformed URLs and other protocols', () => {
  for (const url of ['not-a-valid-url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://youtube.com/x', '--exec=id']) {
    assert.equal(validateYoutubeUrl(url).ok, false, url);
  }
});

test('rejects non-YouTube hosts (SSRF)', () => {
  for (const url of [
    'http://localhost:8080/api/health',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/',
    'https://example.com/watch?v=abc',
    'https://youtube.com.evil.com/watch?v=abc',
    'https://evilyoutube.com/watch?v=abc',
  ]) {
    const result = validateYoutubeUrl(url);
    assert.equal(result.ok, false, url);
  }
});

test('rejects credentials, custom ports and oversized URLs', () => {
  assert.equal(validateYoutubeUrl('https://user:pass@youtube.com/watch?v=abc').ok, false);
  assert.equal(validateYoutubeUrl('https://youtube.com:8443/watch?v=abc').ok, false);
  assert.equal(validateYoutubeUrl(`https://youtube.com/watch?v=${'a'.repeat(3000)}`).ok, false);
});

test('single-video mode: playlist params are ignored, video URL is kept', () => {
  const result = validateYoutubeUrl('https://www.youtube.com/watch?v=abc&list=PL123');
  assert.equal(result.ok && result.isPlaylist, false);
  assert.ok(result.ok);
});

test('single-video mode: rejects URLs without a video', () => {
  assert.deepEqual(validateYoutubeUrl('https://www.youtube.com/playlist?list=PL123'), {
    ok: false,
    error: 'Playlist downloads are disabled. Paste a link to a single video.',
  });
  for (const url of ['https://www.youtube.com/@channel', 'https://www.youtube.com/', 'https://youtu.be/', 'https://www.youtube.com/watch?v=']) {
    assert.deepEqual(validateYoutubeUrl(url), { ok: false, error: 'No video found in this URL' }, url);
  }
});

test('playlist mode: list= URLs become playlists', () => {
  const opts = { allowPlaylists: true };
  const pure = validateYoutubeUrl('https://www.youtube.com/playlist?list=PL123', opts);
  assert.ok(pure.ok && pure.isPlaylist);
  const mixed = validateYoutubeUrl('https://www.youtube.com/watch?v=abc&list=PL123', opts);
  assert.ok(mixed.ok && mixed.isPlaylist);
  const single = validateYoutubeUrl('https://youtu.be/abc', opts);
  assert.ok(single.ok && !single.isPlaylist);
  assert.equal(validateYoutubeUrl('https://www.youtube.com/@channel', opts).ok, false);
});
