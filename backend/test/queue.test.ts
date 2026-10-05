import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { getAudioFormat } from '../src/services/audioFormats.js';
import {
  cancelAllJobs,
  cancelJob,
  createJob,
  getJob,
  JobLimitError,
  queueStats,
  subscribe,
  sweepJobs,
  type Job,
} from '../src/services/downloadManager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const mp3 = getAudioFormat('mp3')!;
const defaults = { ...config };

config.ytdlpPath = path.join(here, 'fixtures', 'fake-yt-dlp.mjs');
process.env.FAKE_YTDLP_DELAY_MS = '300';

// Each test starts from an empty queue, so a failure cannot cascade into the next tests.
beforeEach(async () => {
  cancelAllJobs();
  await waitFor(() => queueStats().running === 0 && queueStats().queued === 0);
  process.env.FAKE_YTDLP_DELAY_MS = '300';
  delete process.env.FAKE_YTDLP_FAIL;
  Object.assign(config, defaults, { ytdlpPath: config.ytdlpPath });
  config.maxConcurrentJobs = 2;
  config.maxParallelPerSession = 1;
  config.maxJobsPerSession = 5;
  config.maxQueueSize = 50;
});

after(async () => {
  // Let pending fake processes finish so the test runner exits cleanly.
  await waitFor(() => queueStats().running === 0 && queueStats().queued === 0, 5000);
});

function newJob(sessionId: string) {
  return createJob({
    url: 'https://www.youtube.com/watch?v=abc',
    format: mp3,
    isPlaylist: false,
    sessionId,
    requestUserAgent: null,
  });
}

async function waitFor(check: () => boolean, timeoutMs = 15000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 20));
  }
}

const status = (job: Job) => getJob(job.id)?.status;
const done = (...list: Job[]) => () => list.every(j => ['completed', 'failed'].includes(status(j)!));

test('global limit: extra jobs wait in the queue, then run in order', async () => {
  const jobs = ['s1', 's2', 's3', 's4'].map(newJob);
  assert.deepEqual(jobs.map(status), ['downloading', 'downloading', 'queued', 'queued']);
  assert.deepEqual(queueStats(), { running: 2, queued: 2 });

  // Slots free up one at a time (the first two jobs do not end at the same instant).
  await waitFor(() => status(jobs[2]) !== 'queued');
  await waitFor(() => status(jobs[3]) !== 'queued');
  await waitFor(done(...jobs));
  assert.deepEqual(jobs.map(status), ['completed', 'completed', 'completed', 'completed']);
  assert.ok(getJob(jobs[0].id)!.finishedAt);
});

test('per-session limit: one download at a time per session, others are not blocked', async () => {
  const a1 = newJob('A');
  const a2 = newJob('A');
  const b1 = newJob('B');
  // A's second job waits even though a global slot is free; B is not held behind it.
  assert.deepEqual([a1, a2, b1].map(status), ['downloading', 'queued', 'downloading']);
  await waitFor(() => status(a2) === 'downloading');
  assert.equal(status(a1), 'completed');
  await waitFor(done(a1, a2, b1));
});

test('queued jobs receive their position and are told when it changes', async () => {
  newJob('p1');
  newJob('p2');
  const waiting = newJob('p3');
  const events: Array<{ type: string; position?: number }> = [];
  const unsubscribe = subscribe(waiting.id, data => events.push(JSON.parse(data)));
  assert.deepEqual(events[0], { type: 'queued', position: 1 });
  await waitFor(() => status(waiting) === 'completed');
  unsubscribe();
  assert.ok(events.some(e => e.type === 'completed'));
});

test('per-session job cap and queue size cap', () => {
  config.maxConcurrentJobs = 0;
  config.maxJobsPerSession = 2;
  const created = [newJob('cap'), newJob('cap')];
  assert.throws(() => newJob('cap'), /already have 2 downloads/);

  config.maxQueueSize = 3;
  created.push(newJob('q1'));
  assert.throws(() => newJob('q2'), JobLimitError);
  assert.throws(() => newJob('q2'), /queue is full/);

  for (const job of created) cancelJob(job.id);
  assert.equal(queueStats().queued, 0);
});

test('cancel a queued job and a running job', async () => {
  config.maxConcurrentJobs = 2;
  process.env.FAKE_YTDLP_DELAY_MS = '2000';
  const running = newJob('c1');
  const queued = newJob('c1');
  assert.equal(status(queued), 'queued');

  assert.equal(cancelJob(queued.id), true);
  assert.equal(getJob(queued.id)!.errorCode, 'cancelled');
  assert.equal(cancelJob(running.id), true);
  assert.equal(getJob(running.id)!.status, 'failed');
  assert.equal(cancelJob(running.id), false);
  process.env.FAKE_YTDLP_DELAY_MS = '300';
  await waitFor(() => queueStats().running === 0);
});

test('jobs waiting too long are failed with queue_timeout', () => {
  config.maxConcurrentJobs = 0;
  const job = newJob('slow');
  sweepJobs(Date.now() + config.maxQueueWaitMs + 1000);
  assert.equal(status(job), 'failed');
  assert.equal(getJob(job.id)!.errorCode, 'queue_timeout');
});

test('bot check failures carry the bot_check code', async () => {
  process.env.FAKE_YTDLP_FAIL = 'bot';
  const job = newJob('bot');
  await waitFor(done(job));
  delete process.env.FAKE_YTDLP_FAIL;
  assert.equal(getJob(job.id)!.errorCode, 'bot_check');
});
