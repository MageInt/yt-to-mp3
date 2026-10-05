import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetscapeCookies, serializeNetscapeCookies, earliestExpiry } from '../src/services/cookieJar.js';

const SAMPLE = [
  '# Netscape HTTP Cookie File',
  '# https://curl.haxx.se/rfc/cookie_spec.html',
  '',
  '.youtube.com\tTRUE\t/\tTRUE\t1893456000\tPREF\tf6=40000000&tz=Europe.Paris',
  '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\t__Secure-3PSID\tabc.DEF_123-xyz',
  '.google.com\tTRUE\t/\tTRUE\t1800000000\tSID\tgoogleValue',
  'accounts.google.com\tFALSE\t/\tTRUE\t0\tLSID\tsessionOnly',
  '.facebook.com\tTRUE\t/\tTRUE\t1893456000\tc_user\tshould-be-dropped',
  '.notyoutube.com\tTRUE\t/\tTRUE\t1893456000\tX\tdropped-too',
].join('\n');

test('parses Netscape cookies and keeps only YouTube / Google domains', () => {
  const result = parseNetscapeCookies(SAMPLE);
  assert.ok(result.ok);
  assert.deepEqual(result.cookies.map(c => c.name), ['PREF', '__Secure-3PSID', 'SID', 'LSID']);
  assert.equal(result.cookies[1].httpOnly, true);
  assert.equal(result.cookies[3].includeSubdomains, false);
});

test('round-trips through serialization', () => {
  const first = parseNetscapeCookies(SAMPLE);
  assert.ok(first.ok);
  const text = serializeNetscapeCookies(first.cookies);
  assert.ok(text.startsWith('# Netscape HTTP Cookie File\n'));
  assert.ok(!text.includes('facebook'));
  const second = parseNetscapeCookies(text);
  assert.ok(second.ok);
  assert.deepEqual(second.cookies, first.cookies);
});

test('earliest expiry only looks at persistent sign-in cookies', () => {
  const result = parseNetscapeCookies(SAMPLE);
  assert.ok(result.ok);
  assert.equal(earliestExpiry(result.cookies), 1800000000 * 1000);

  const shortLived = parseNetscapeCookies(`${SAMPLE}\n.youtube.com\tTRUE\t/\tTRUE\t1700000000\tGPS\t1`);
  assert.ok(shortLived.ok);
  assert.equal(earliestExpiry(shortLived.cookies), 1800000000 * 1000);

  const noAuth = parseNetscapeCookies('.youtube.com\tTRUE\t/\tTRUE\t1893456000\tPREF\tf6=4');
  assert.ok(noAuth.ok);
  assert.equal(earliestExpiry(noAuth.cookies), null);
});

test('rejects empty, non-string and oversized input', () => {
  for (const input of [undefined, null, 42, '', '   \n']) {
    assert.equal(parseNetscapeCookies(input).ok, false);
  }
  assert.deepEqual(parseNetscapeCookies('x'.repeat(100_001)), { ok: false, error: 'Cookies file is too large' });
});

test('rejects files that are not Netscape cookies', () => {
  for (const input of ['{"cookies": []}', 'SID=abc; HSID=def', '# only comments\n# here']) {
    assert.equal(parseNetscapeCookies(input).ok, false, input);
  }
});

test('rejects files without YouTube or Google cookies', () => {
  assert.deepEqual(parseNetscapeCookies('.example.com\tTRUE\t/\tFALSE\t0\ta\tb'), {
    ok: false,
    error: 'No YouTube or Google cookies found in this file',
  });
});

test('rejects malformed lines and injection attempts', () => {
  for (const line of [
    '.youtube.com\tTRUE\t/\tTRUE\tsoon\tSID\tv',           // non-numeric expiry
    '.youtube.com\tMAYBE\t/\tTRUE\t0\tSID\tv',             // bad flag
    '.youtube.com\tTRUE\tnoslash\tTRUE\t0\tSID\tv',        // bad path
    '.youtube.com\tTRUE\t/\tTRUE\t0\tS ID\tv',             // space in name
    '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tva lue',         // space in value
    '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tv;Path=/x',      // ; in value
    'you tube.com\tTRUE\t/\tTRUE\t0\tSID\tv',              // bad domain
    '.youtube.com\tTRUE\t/\tTRUE\t0\tSID',                 // 6 fields
  ]) {
    assert.equal(parseNetscapeCookies(line).ok, false, line);
  }
});

test('caps the number of cookies', () => {
  const lines = Array.from({ length: 301 }, (_, i) => `.youtube.com\tTRUE\t/\tTRUE\t0\tC${i}\tv`);
  assert.deepEqual(parseNetscapeCookies(lines.join('\n')), { ok: false, error: 'Too many cookies' });
});
