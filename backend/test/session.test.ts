import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';

let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const COOKIES = [
  '# Netscape HTTP Cookie File',
  '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\t__Secure-3PSID\tsuper-secret-value',
  '.youtube.com\tTRUE\t/\tTRUE\t1893456000\tPREF\tf6=40000000',
].join('\n');

async function newSession(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/session`);
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie')!;
  return setCookie.split(';')[0];
}

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';

function putCookies(sid: string | null, cookies: unknown, userAgent = FIREFOX) {
  return fetch(`${baseUrl}/api/session/cookies`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent, ...(sid ? { Cookie: sid } : {}) },
    body: JSON.stringify({ cookies }),
  });
}

test('GET /api/session creates an HttpOnly, SameSite=Strict session cookie', async () => {
  const res = await fetch(`${baseUrl}/api/session`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^yt2mp3_sid=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.hasCookies, false);
});

test('an existing session is reused, an unknown one is replaced', async () => {
  const sid = await newSession();
  const again = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: sid } });
  assert.equal(again.headers.get('set-cookie'), null);
  const forged = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: 'yt2mp3_sid=forged' } });
  assert.match(forged.headers.get('set-cookie') ?? '', /^yt2mp3_sid=/);
  assert.notEqual(forged.headers.get('set-cookie')!.split(';')[0], 'yt2mp3_sid=forged');
});

test('uploading cookies requires a session', async () => {
  const res = await putCookies(null, COOKIES);
  assert.equal(res.status, 401);
});

test('upload, status and forget cookies, never echoing their values', async () => {
  const sid = await newSession();

  const put = await putCookies(sid, COOKIES);
  assert.equal(put.status, 200);
  const text = await put.text();
  assert.ok(!text.includes('super-secret-value'));
  assert.ok(!text.includes('__Secure-3PSID'));
  const body = JSON.parse(text);
  assert.equal(body.hasCookies, true);
  assert.equal(body.cookieCount, 2);
  assert.equal(body.cookiesExpireAt, 1893456000 * 1000);
  assert.equal(body.cookiesUserAgent, FIREFOX);

  const status = await (await fetch(`${baseUrl}/api/session`, { headers: { Cookie: sid } })).json();
  assert.equal(status.hasCookies, true);

  // Another session does not see them.
  const other = await (await fetch(`${baseUrl}/api/session`)).json();
  assert.equal(other.hasCookies, false);

  const del = await fetch(`${baseUrl}/api/session/cookies`, { method: 'DELETE', headers: { Cookie: sid } });
  assert.equal(del.status, 200);
  const cleared = await del.json();
  assert.equal(cleared.hasCookies, false);
  assert.equal(cleared.cookiesUserAgent, null);
});

test('invalid cookie files are refused with a clear error', async () => {
  const sid = await newSession();
  const res = await putCookies(sid, 'SID=abc; HSID=def');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Netscape/);
});

test('cookie upload accepts files above the global 10 kB limit', async () => {
  const sid = await newSession();
  const padding = Array.from({ length: 200 }, (_, i) => `.youtube.com\tTRUE\t/\tTRUE\t0\tC${i}\t${'v'.repeat(60)}`);
  const res = await putCookies(sid, `${COOKIES}\n${padding.join('\n')}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cookieCount, 202);
});

test('cross-site cookie upload is refused', async () => {
  const sid = await newSession();
  const res = await fetch(`${baseUrl}/api/session/cookies`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: sid, Origin: 'https://evil.example' },
    body: JSON.stringify({ cookies: COOKIES }),
  });
  assert.equal(res.status, 403);
});

test('jobs are only visible to the session that created them', async () => {
  const owner = await newSession();
  const create = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: owner },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=VCuS3enPwKI' }),
  });
  assert.equal(create.status, 201);
  const { id } = await create.json();

  const stranger = await newSession();
  for (const path of [`/api/jobs/${id}/file`, `/api/jobs/${id}/files/0`, `/api/jobs/${id}/progress`]) {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Cookie: stranger } });
    assert.equal(res.status, 404, path);
    const anonymous = await fetch(`${baseUrl}${path}`);
    assert.equal(anonymous.status, 404, path);
  }

  const mine = await fetch(`${baseUrl}/api/jobs/${id}/file`, { headers: { Cookie: owner } });
  assert.notEqual(mine.status, 404);

  // Progress stream: unbuffered behind Nginx, then closed by the client.
  const controller = new AbortController();
  const stream = await fetch(`${baseUrl}/api/jobs/${id}/progress`, { headers: { Cookie: owner }, signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  assert.equal(stream.headers.get('x-accel-buffering'), 'no');
  controller.abort();
});

test('automation UA at upload is not captured', async () => {
  const sid = await newSession();
  const res = await putCookies(sid, COOKIES, 'curl/8.10.1');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cookiesUserAgent, null);
});
