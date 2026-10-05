import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { config } from '../config.js';
import type { AudioFormat } from './audioFormats.js';
import { parseNetscapeCookies, serializeNetscapeCookies, type Cookie } from './cookieJar.js';
import { peekSession, replaceSessionCookies } from './sessionStore.js';
import { chooseUserAgent } from './userAgent.js';

export interface JobFile {
  filename: string;
  path: string;
}

export interface Job {
  id: string;
  url: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  // Machine-readable failure reason for the UI ('bot_check': YouTube wants a signed-in session).
  errorCode?: 'bot_check' | 'cancelled' | 'queue_timeout';
  filePath?: string;
  filename?: string;
  files: JobFile[];
  format: AudioFormat;
  isPlaylist: boolean;
  tmpDir: string;
  createdAt: number;
  // When the job completed or failed; the files are kept JOB_TTL_MINUTES after that.
  finishedAt?: number;
  // Owner: only this session can read the job's progress and files.
  sessionId: string;
  cookieSource: CookieSource;
  // Sanitized browser User-Agent of the requester (see userAgent.ts).
  requestUserAgent: string | null;
  // User-Agent actually sent to yt-dlp, chosen when the job starts.
  userAgent: string | null;
  // RAM-only directory holding the cookie jar while yt-dlp runs.
  secretsDir?: string;
}

export type CookieSource = 'session' | 'server' | null;

export interface CreateJobParams {
  url: string;
  format: AudioFormat;
  isPlaylist: boolean;
  sessionId: string;
  requestUserAgent: string | null;
}

const jobs = new Map<string, Job>();
// FIFO of queued job ids. A job leaves it when it starts, is cancelled or waits too long.
const queue: string[] = [];
const processes = new Map<string, ReturnType<typeof spawn>>();
const sseClients = new Map<string, Set<(data: string) => void>>();

const CLEANUP_INTERVAL = 5 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;
const MAX_OUTPUT_BUFFER = 64 * 1024;

// Raised when a job cannot even be queued (queue full, too many jobs for this session).
export class JobLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobLimitError';
  }
}

export function sweepJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.status === 'queued' && now - job.createdAt > config.maxQueueWaitMs) {
      dequeue(id);
      finish(job, 'failed', { error: 'Waited too long in the queue. Please try again later.', errorCode: 'queue_timeout' });
    } else if (job.finishedAt && now - job.finishedAt > config.jobTtlMs) {
      cleanupJob(id);
    }
  }
}

setInterval(() => sweepJobs(), CLEANUP_INTERVAL).unref();

function dequeue(id: string) {
  const index = queue.indexOf(id);
  if (index !== -1) queue.splice(index, 1);
}

function runningCount(sessionId?: string): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === 'downloading' && (!sessionId || job.sessionId === sessionId)) count++;
  }
  return count;
}

function activeCount(sessionId: string): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.sessionId === sessionId && (job.status === 'queued' || job.status === 'downloading')) count++;
  }
  return count;
}

function broadcastQueuePositions() {
  queue.forEach((id, index) => emitEvent(id, { type: 'queued', position: index + 1 }));
}

// Starts queued jobs in arrival order while there are free slots. A job whose session already
// has MAX_PARALLEL_PER_SESSION downloads running is skipped (it keeps its place).
function pump() {
  let started = false;
  while (runningCount() < config.maxConcurrentJobs) {
    const index = queue.findIndex(id => runningCount(jobs.get(id)?.sessionId) < config.maxParallelPerSession);
    if (index === -1) break;
    const [id] = queue.splice(index, 1);
    const job = jobs.get(id);
    if (!job) continue;
    started = true;
    startDownload(job);
  }
  if (started) broadcastQueuePositions();
}

function finish(job: Job, status: 'completed' | 'failed', failure?: { error: string; errorCode?: Job['errorCode'] }) {
  job.status = status;
  job.finishedAt = Date.now();
  if (failure) {
    job.error = failure.error;
    job.errorCode = failure.errorCode;
    emitEvent(job.id, { type: 'failed', error: job.error, code: job.errorCode });
  }
  // Let the current handler finish before starting the next download.
  setImmediate(pump);
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || (job.status !== 'queued' && job.status !== 'downloading')) return false;
  const wasQueued = job.status === 'queued';
  dequeue(id);
  const proc = processes.get(id);
  if (proc) {
    proc.kill('SIGTERM');
    processes.delete(id);
  }
  removeSecrets(job);
  finish(job, 'failed', { error: 'Download cancelled.', errorCode: 'cancelled' });
  if (wasQueued) broadcastQueuePositions();
  return true;
}

// Cancels every queued or running job (server shutdown, tests).
export function cancelAllJobs() {
  for (const [id, job] of jobs) {
    if (job.status === 'queued' || job.status === 'downloading') cancelJob(id);
  }
}

export function queueStats() {
  return { running: runningCount(), queued: queue.length };
}

function removeSecrets(job: Job) {
  if (!job.secretsDir) return;
  try {
    fs.rmSync(job.secretsDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[downloadManager] Could not remove cookie jar for job ${job.id}:`, err);
  }
  job.secretsDir = undefined;
}

function cleanupJob(id: string) {
  const job = jobs.get(id);
  if (job) {
    const proc = processes.get(id);
    if (proc) {
      proc.kill();
      processes.delete(id);
    }
    removeSecrets(job);
    dequeue(id);
    try {
      if (job.tmpDir) fs.rmSync(job.tmpDir, { recursive: true, force: true });
    } catch {}
    jobs.delete(id);
  }
  sseClients.delete(id);
}

const COOKIES_FILENAME = 'cookies.txt';

export const BOT_CHECK_ERRORS: Record<'none' | 'session' | 'server', string> = {
  none: 'YouTube is asking to confirm this is not a bot (common on VPN or datacenter IPs). '
    + 'Add your YouTube cookies in the "YouTube cookies" section, then try again.',
  session: 'YouTube is asking to confirm this is not a bot, even with your cookies. '
    + 'They may have expired or been revoked: export fresh ones and upload them again.',
  server: 'YouTube is asking to confirm this is not a bot, even with the server cookies. '
    + 'Add your own YouTube cookies in the "YouTube cookies" section, then try again.',
};

function isBotCheck(output: string): boolean {
  return /Sign in to confirm you.re not a bot/i.test(output);
}

export function summarizeError(output: string, cookieSource: CookieSource = null): string {
  if (isBotCheck(output)) {
    return BOT_CHECK_ERRORS[cookieSource ?? 'none'];
  }
  const errorLines = output.split('\n').filter(line => line.startsWith('ERROR:'));
  const summary = (errorLines.length > 0 ? errorLines.join('\n') : output).trim();
  return summary.length > MAX_ERROR_LENGTH ? `${summary.slice(0, MAX_ERROR_LENGTH)}…` : summary;
}

function loadServerCookies(): Cookie[] | null {
  if (!config.ytdlpCookiesFile) return null;
  const result = parseNetscapeCookies(fs.readFileSync(config.ytdlpCookiesFile, 'utf8'));
  if (!result.ok) throw new Error(`YTDLP_COOKIES_FILE: ${result.error}`);
  return result.cookies;
}

// Writes the jar to a fresh 0700 directory on a RAM-backed filesystem; never to the job's disk dir.
function writeCookieJar(job: Job, cookies: Cookie[]): string {
  job.secretsDir = fs.mkdtempSync(path.join(config.secretsTmpDir, 'yt2mp3-'));
  fs.chmodSync(job.secretsDir, 0o700);
  const jarPath = path.join(job.secretsDir, COOKIES_FILENAME);
  fs.writeFileSync(jarPath, serializeNetscapeCookies(cookies), { mode: 0o600, flag: 'wx' });
  return jarPath;
}

// yt-dlp saves the jar on exit, including cookies YouTube rotated: keep the session fresh.
function refreshSessionCookies(job: Job) {
  if (job.cookieSource !== 'session' || !job.secretsDir) return;
  try {
    const result = parseNetscapeCookies(fs.readFileSync(path.join(job.secretsDir, COOKIES_FILENAME), 'utf8'));
    if (result.ok) replaceSessionCookies(job.sessionId, result.cookies);
  } catch {}
}

export function createJob(params: CreateJobParams): Job {
  if (activeCount(params.sessionId) >= config.maxJobsPerSession) {
    throw new JobLimitError(`You already have ${config.maxJobsPerSession} downloads waiting or in progress. Wait for one to finish.`);
  }
  if (queue.length >= config.maxQueueSize) {
    throw new JobLimitError('The download queue is full. Please try again in a few minutes.');
  }

  const id = crypto.randomUUID();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dlp-'));
  const job: Job = {
    id,
    url: params.url,
    status: 'queued',
    progress: 0,
    files: [],
    format: params.format,
    isPlaylist: params.isPlaylist,
    tmpDir,
    createdAt: Date.now(),
    sessionId: params.sessionId,
    cookieSource: null,
    requestUserAgent: params.requestUserAgent,
    userAgent: null,
  };
  jobs.set(id, job);
  queue.push(id);
  pump();
  // Still waiting: tell anyone already subscribed where it stands (others get it on subscribe).
  if (job.status === 'queued') broadcastQueuePositions();
  return { ...job };
}

export function checkCookiesSetup(): void {
  try {
    fs.accessSync(config.secretsTmpDir, fs.constants.W_OK);
  } catch {
    console.error(`[downloadManager] SECRETS_TMP_DIR=${config.secretsTmpDir} is not writable: downloads with cookies will fail`);
  }
  if (!config.ytdlpCookiesFile) return;
  try {
    fs.accessSync(config.ytdlpCookiesFile, fs.constants.R_OK);
    console.log(`[downloadManager] Using server cookies file ${config.ytdlpCookiesFile} as fallback`);
  } catch {
    console.error(`[downloadManager] YTDLP_COOKIES_FILE=${config.ytdlpCookiesFile} is not readable by this user (uid ${process.getuid?.()})`);
  }
}

export function buildYtDlpArgs(
  job: Pick<Job, 'url' | 'tmpDir' | 'isPlaylist' | 'format'> & Partial<Pick<Job, 'userAgent'>>,
  cookieJarPath?: string,
): string[] {
  const args: string[] = [
    '--socket-timeout', '30',
    '--retries', '3',
    '--retry-sleep', '5',
    '--ignore-errors',
    '-x',
    '--audio-format', job.format.ytdlp,
    '--audio-quality', '0',
    '--no-warnings',
    '--newline',
  ];

  const outputTemplate = job.isPlaylist
    ? path.join(job.tmpDir, '%(playlist_index)s - %(title)s.%(ext)s')
    : path.join(job.tmpDir, '%(title)s.%(ext)s');

  args.push('-o', outputTemplate);

  if (job.isPlaylist) {
    args.push('--playlist-end', String(config.maxPlaylistItems));
  } else {
    args.push('--no-playlist');
  }

  if (config.ytdlpProxy) {
    args.push('--proxy', config.ytdlpProxy);
  }

  if (cookieJarPath) {
    args.push('--cookies', cookieJarPath);
  }

  if (job.userAgent) {
    args.push('--user-agent', job.userAgent);
  }

  // `--` stops option parsing so the URL can never be read as a yt-dlp flag.
  args.push('--', job.url);

  return args;
}

function startDownload(job: Job) {
  job.status = 'downloading';

  // Cookies and User-Agent are read when the download actually starts, so cookies uploaded
  // while the job was queued are used.
  const owner = peekSession(job.sessionId);
  const sessionCookies = owner?.cookies ?? null;
  job.userAgent = config.forwardUserAgent ? chooseUserAgent(owner, job.requestUserAgent) : null;

  let cookieJarPath: string | undefined;
  try {
    const serverCookies = sessionCookies?.length ? null : loadServerCookies();
    const cookies = sessionCookies?.length ? sessionCookies : serverCookies;
    if (cookies) {
      job.cookieSource = sessionCookies?.length ? 'session' : 'server';
      cookieJarPath = writeCookieJar(job, cookies);
    }
  } catch (err) {
    // Never log the error object itself in a way that could include cookie contents.
    console.error(`[downloadManager] Cannot prepare cookies for job ${job.id}: ${(err as Error).message}`);
    removeSecrets(job);
    finish(job, 'failed', {
      error: job.cookieSource === 'session'
        ? 'Server misconfiguration: cookies cannot be kept in memory (SECRETS_TMP_DIR).'
        : 'Server misconfiguration: the YouTube cookies file cannot be used.',
    });
    return;
  }

  const args = buildYtDlpArgs(job, cookieJarPath);

  const ytProcess = spawn(config.ytdlpPath, args);

  processes.set(job.id, ytProcess);

  const processTimeout = setTimeout(() => {
    if (processes.has(job.id)) {
      ytProcess.kill('SIGTERM');
      removeSecrets(job);
      processes.delete(job.id);
      finish(job, 'failed', { error: `Download timed out after ${config.downloadTimeoutMs / 60000} minutes. Try again later.` });
    }
  }, config.downloadTimeoutMs);

  let processOutput = '';
  const appendOutput = (text: string) => {
    processOutput = (processOutput + text).slice(-MAX_OUTPUT_BUFFER);
  };
  let lastEmittedProgress = -1;
  const pendingProgress: number[] = [];
  let seqIndex = 0;

  const progressTimer = setInterval(() => {
    if (seqIndex < pendingProgress.length) {
      const next = pendingProgress[seqIndex];
      seqIndex++;
      if (next !== lastEmittedProgress) {
        lastEmittedProgress = next;
        job.progress = next;
        emitEvent(job.id, { type: 'progress', progress: next });
      }
    }
  }, 250);

  ytProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    appendOutput(text);
    const lines = text.split('\n');
    for (const line of lines) {
      for (const part of line.split('\r')) {
        const match = part.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (match) {
          const pct = parseFloat(match[1]);
          if (pendingProgress.length === 0 || pct !== pendingProgress[pendingProgress.length - 1]) {
            pendingProgress.push(pct);
          }
        }
      }
    }
  });

  ytProcess.stderr?.on('data', (data: Buffer) => {
    appendOutput(data.toString());
  });

  ytProcess.on('close', (code) => {
    console.log(`[downloadManager] yt-dlp closed for job ${job.id} with code ${code}`);
    clearInterval(progressTimer);
    processes.delete(job.id);
    clearTimeout(processTimeout);
    refreshSessionCookies(job);
    removeSecrets(job);

    // Already failed (timeout) or cleaned up: don't overwrite the reported state.
    if (job.status === 'failed' || !jobs.has(job.id)) {
      return;
    }

    let allFiles: string[] = [];
    try {
      allFiles = fs.readdirSync(job.tmpDir);
    } catch {}
    const audioFiles = allFiles.filter(f => f.endsWith(`.${job.format.ext}`)).sort();
    if (audioFiles.length === 0) {
      finish(job, 'failed', {
        error: summarizeError(processOutput, job.cookieSource) || (code !== 0 ? `Process exited with code ${code}` : 'Output file not found'),
        errorCode: isBotCheck(processOutput) ? 'bot_check' : undefined,
      });
      return;
    }

    job.files = audioFiles.map(f => ({
      filename: f,
      path: path.join(job.tmpDir, f),
    }));

    job.filePath = job.files[0].path;
    job.filename = job.files[0].filename;

    job.progress = 100;
    finish(job, 'completed');
    console.log(`[downloadManager] Job ${job.id} completed. files[0]=${job.filename}, total files=${job.files.length}`);
    emitEvent(job.id, {
      type: 'completed',
      progress: 100,
      filename: job.filename,
      files: job.files.map(f => ({ filename: f.filename })),
      isPlaylist: job.isPlaylist,
      format: job.format.id,
    });
  });

  ytProcess.on('error', (err) => {
    clearInterval(progressTimer);
    processes.delete(job.id);
    clearTimeout(processTimeout);
    removeSecrets(job);
    if (job.status !== 'downloading') return;
    finish(job, 'failed', { error: `Could not start yt-dlp: ${err.message}` });
  });
}

export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  return { ...job };
}

export function subscribe(jobId: string, onEvent: (data: string) => void): () => void {
  if (!sseClients.has(jobId)) {
    sseClients.set(jobId, new Set());
  }
  sseClients.get(jobId)!.add(onEvent);

  const job = jobs.get(jobId);
  if (job) {
    if (job.status === 'completed') {
      onEvent(JSON.stringify({
        type: 'completed',
        progress: 100,
        filename: job.filename,
        files: job.files.map(f => ({ filename: f.filename })),
        isPlaylist: job.isPlaylist,
        format: job.format.id,
      }));
    } else if (job.status === 'failed') {
      onEvent(JSON.stringify({ type: 'failed', error: job.error, code: job.errorCode }));
    } else if (job.status === 'queued') {
      onEvent(JSON.stringify({ type: 'queued', position: queue.indexOf(jobId) + 1 }));
    } else if (job.status === 'downloading' && job.progress > 0) {
      onEvent(JSON.stringify({ type: 'progress', progress: job.progress }));
    }
  }

  return () => {
    const clients = sseClients.get(jobId);
    if (clients) {
      clients.delete(onEvent);
      if (clients.size === 0) {
        sseClients.delete(jobId);
      }
    }
  };
}

function emitEvent(jobId: string, data: Record<string, unknown>) {
  const clients = sseClients.get(jobId);
  if (clients) {
    const message = JSON.stringify(data);
    for (const cb of clients) {
      cb(message);
    }
  }
}
