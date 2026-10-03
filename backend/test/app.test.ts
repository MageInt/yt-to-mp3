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

function postJob(body: string) {
  return fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body,
  });
}

test('GET /api/health returns ok', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('sets security headers and no CORS / x-powered-by', async () => {
  const res = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.ok(res.headers.get('content-security-policy'));
  assert.ok(!res.headers.get('content-security-policy')!.includes('upgrade-insecure-requests'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('POST /api/jobs rejects missing URL', async () => {
  const res = await postJob('{}');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'URL is required' });
});

test('POST /api/jobs rejects invalid URL', async () => {
  const res = await postJob(JSON.stringify({ url: 'not-a-valid-url' }));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Invalid URL' });
});

test('POST /api/jobs rejects non-YouTube URL', async () => {
  const res = await postJob(JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Only YouTube URLs are supported' });
});

test('POST /api/jobs returns JSON 400 on malformed body', async () => {
  const res = await postJob('{not json');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Bad request' });
});

test('POST /api/jobs rejects oversized body', async () => {
  const res = await postJob(JSON.stringify({ url: 'x'.repeat(20_000) }));
  assert.equal(res.status, 413);
});

test('unknown job returns 404', async () => {
  for (const path of ['/api/jobs/nope/progress', '/api/jobs/nope/file', '/api/jobs/nope/files/0']) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 404, path);
  }
});

test('unknown /api route returns JSON 404 instead of hanging', async () => {
  const res = await fetch(`${baseUrl}/api/does-not-exist`, { signal: AbortSignal.timeout(2000) });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});
