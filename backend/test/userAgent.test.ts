import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseUserAgent, sanitizeUserAgent } from '../src/services/userAgent.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

test('real browser User-Agents are forwarded unchanged', () => {
  for (const ua of [CHROME, FIREFOX, SAFARI_IOS]) {
    assert.equal(sanitizeUserAgent(ua), ua);
  }
  assert.equal(sanitizeUserAgent(`  ${FIREFOX}  `), FIREFOX);
});

test('automation User-Agents are dropped', () => {
  for (const ua of [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'curl/8.10.1',
    'python-requests/2.32.3',
    'Wget/1.25.0',
  ]) {
    assert.equal(sanitizeUserAgent(ua), null, ua);
  }
});

test('malformed or dangerous values are dropped', () => {
  for (const ua of [
    undefined,
    null,
    42,
    '',
    'Mozilla/5.0',
    `${CHROME}\r\nX-Injected: 1`,
    `${CHROME}é`,
    `Mozilla/5.0 (${'x'.repeat(600)})`,
    'Opera/9.80 (Windows NT 6.1; U; en) Presto/2.12.388 Version/12.18',
  ]) {
    assert.equal(sanitizeUserAgent(ua), null, String(ua));
  }
});

test('with cookies, the UA captured at upload wins over the current request', () => {
  const session = { cookies: [{}], cookiesUserAgent: FIREFOX };
  assert.equal(chooseUserAgent(session, SAFARI_IOS), FIREFOX);
});

test('without cookies or captured UA, the request UA is used (sanitized)', () => {
  assert.equal(chooseUserAgent({ cookies: null, cookiesUserAgent: null }, CHROME), CHROME);
  assert.equal(chooseUserAgent({ cookies: [{}], cookiesUserAgent: null }, CHROME), CHROME);
  assert.equal(chooseUserAgent(undefined, 'curl/8.10.1'), null);
});
