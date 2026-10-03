import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { config } from '../config.js';

export interface JobFile {
  filename: string;
  path: string;
}

export interface Job {
  id: string;
  url: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  filePath?: string;
  filename?: string;
  files: JobFile[];
  isPlaylist: boolean;
  tmpDir: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();
const processes = new Map<string, ReturnType<typeof spawn>>();
const sseClients = new Map<string, Set<(data: string) => void>>();

const CLEANUP_INTERVAL = 5 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;
const MAX_OUTPUT_BUFFER = 64 * 1024;

export class TooManyJobsError extends Error {
  constructor() {
    super('Server is busy. Please try again in a few minutes.');
    this.name = 'TooManyJobsError';
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > config.jobTtlMs) {
      cleanupJob(id);
    }
  }
}, CLEANUP_INTERVAL).unref();

function cleanupJob(id: string) {
  const job = jobs.get(id);
  if (job) {
    const proc = processes.get(id);
    if (proc) {
      proc.kill();
      processes.delete(id);
    }
    try {
      if (job.tmpDir) fs.rmSync(job.tmpDir, { recursive: true, force: true });
    } catch {}
    jobs.delete(id);
  }
  sseClients.delete(id);
}

function hasPlaylistParam(url: string): boolean {
  return /[?&]list=/.test(url);
}

function summarizeError(output: string): string {
  const errorLines = output.split('\n').filter(line => line.startsWith('ERROR:'));
  const summary = (errorLines.length > 0 ? errorLines.join('\n') : output).trim();
  return summary.length > MAX_ERROR_LENGTH ? `${summary.slice(0, MAX_ERROR_LENGTH)}…` : summary;
}

export function createJob(url: string): Job {
  if (processes.size >= config.maxConcurrentJobs) {
    throw new TooManyJobsError();
  }

  const id = crypto.randomUUID();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dlp-'));
  const isPlaylist = hasPlaylistParam(url);
  const job: Job = { id, url, status: 'pending', progress: 0, files: [], isPlaylist, tmpDir, createdAt: Date.now() };
  jobs.set(id, job);
  startDownload(job);
  return { ...job };
}

function startDownload(job: Job) {
  job.status = 'downloading';

  const args: string[] = [
    '--socket-timeout', '30',
    '--retries', '3',
    '--retry-sleep', '5',
    '--ignore-errors',
    '-x',
    '--audio-format', 'mp3',
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

  // `--` stops option parsing so the URL can never be read as a yt-dlp flag.
  args.push('--', job.url);

  const ytProcess = spawn('yt-dlp', args);

  processes.set(job.id, ytProcess);

  const processTimeout = setTimeout(() => {
    if (processes.has(job.id)) {
      ytProcess.kill('SIGTERM');
      job.status = 'failed';
      job.error = `Download timed out after ${config.downloadTimeoutMs / 60000} minutes. Try again later.`;
      emitEvent(job.id, { type: 'failed', error: job.error });
      processes.delete(job.id);
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

    // Already failed (timeout) or cleaned up: don't overwrite the reported state.
    if (job.status === 'failed' || !jobs.has(job.id)) {
      return;
    }

    let allFiles: string[] = [];
    try {
      allFiles = fs.readdirSync(job.tmpDir);
    } catch {}
    const mp3Files = allFiles.filter(f => f.endsWith('.mp3'));
    if (mp3Files.length === 0) {
      job.status = 'failed';
      job.error = summarizeError(processOutput) || (code !== 0 ? `Process exited with code ${code}` : 'Output file not found');
      emitEvent(job.id, { type: 'failed', error: job.error });
      return;
    }

    job.files = mp3Files.map(f => ({
      filename: f,
      path: path.join(job.tmpDir, f),
    }));

    job.filePath = job.files[0].path;
    job.filename = job.files[0].filename;

    job.status = 'completed';
    job.progress = 100;
    console.log(`[downloadManager] Job ${job.id} completed. files[0]=${job.filename}, total files=${job.files.length}`);
    emitEvent(job.id, {
      type: 'completed',
      progress: 100,
      filename: job.filename,
      files: job.files.map(f => ({ filename: f.filename })),
      isPlaylist: job.isPlaylist,
    });
  });

  ytProcess.on('error', (err) => {
    clearInterval(progressTimer);
    processes.delete(job.id);
    clearTimeout(processTimeout);
    job.status = 'failed';
    job.error = err.message;
    emitEvent(job.id, { type: 'failed', error: err.message });
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
      }));
    } else if (job.status === 'failed') {
      onEvent(JSON.stringify({ type: 'failed', error: job.error }));
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
