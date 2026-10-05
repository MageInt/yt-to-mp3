import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { currentSession, session } from '../middleware/session.js';
import { createJob, getJob, subscribe, TooManyJobsError, type Job } from '../services/downloadManager.js';
import { AUDIO_FORMATS, DEFAULT_FORMAT, getAudioFormat } from '../services/audioFormats.js';
import { validateYoutubeUrl } from '../services/urlValidator.js';
import { chooseUserAgent } from '../services/userAgent.js';

export const jobsRouter = Router();

const createJobLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

jobsRouter.get('/config', (_req, res) => {
  res.json({
    playlistsEnabled: config.enablePlaylists,
    defaultFormat: DEFAULT_FORMAT,
    jobTtlMinutes: config.jobTtlMs / 60000,
    formats: AUDIO_FORMATS.map(({ id, label, description }) => ({ id, label, description })),
  });
});

// Jobs are only visible to the session that created them; anything else is a plain 404.
function ownedJob(id: string, res: Response): Job | undefined {
  const job = getJob(id);
  const owner = currentSession(res);
  if (!job || !owner || job.sessionId !== owner.id) {
    res.status(404).json({ error: 'Job not found' });
    return undefined;
  }
  return job;
}

jobsRouter.post('/jobs', createJobLimiter, session({ create: true }), (req, res) => {
  const result = validateYoutubeUrl(req.body?.url, { allowPlaylists: config.enablePlaylists });
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  const format = getAudioFormat(req.body?.format);
  if (!format) {
    res.status(400).json({ error: 'Unsupported audio format' });
    return;
  }

  try {
    const owner = currentSession(res)!;
    const job = createJob({
      url: result.url,
      format,
      isPlaylist: result.isPlaylist,
      sessionId: owner.id,
      sessionCookies: owner.cookies,
      userAgent: config.forwardUserAgent ? chooseUserAgent(owner, req.get('user-agent')) : null,
    });
    res.status(201).json({ id: job.id, status: job.status });
  } catch (err) {
    if (err instanceof TooManyJobsError) {
      res.status(429).json({ error: err.message });
      return;
    }
    throw err;
  }
});

jobsRouter.get('/jobs/:id/progress', session({ create: false }), (req, res) => {
  const { id } = req.params as { id: string };

  const job = ownedJob(id, res);
  if (!job) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const unsubscribe = subscribe(id, (data) => {
    res.write(`data: ${data}\n\n`);
  });

  req.on('close', () => {
    unsubscribe();
  });
});

jobsRouter.get('/jobs/:id/file', session({ create: false }), (req, res) => {
  const { id } = req.params as { id: string };

  const job = ownedJob(id, res);
  if (!job) return;

  if (job.status !== 'completed' || !job.filePath) {
    res.status(400).json({ error: 'File not ready', status: job.status });
    return;
  }

  console.log(`[jobs] File requested: job=${id}, filename=${job.filename}`);
  res.download(job.filePath, job.filename!, (err) => {
    if (err) {
      console.error('Download error:', err);
    }
  });
});

jobsRouter.get('/jobs/:id/files/:fileIndex', session({ create: false }), (req, res) => {
  const { id, fileIndex } = req.params as { id: string; fileIndex: string };

  const job = ownedJob(id, res);
  if (!job) return;

  if (job.status !== 'completed') {
    res.status(400).json({ error: 'File not ready', status: job.status });
    return;
  }

  const index = parseInt(fileIndex, 10);
  if (isNaN(index) || index < 0 || index >= job.files.length) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const file = job.files[index];
  res.download(file.path, file.filename, (err) => {
    if (err) {
      console.error('Download error:', err);
    }
  });
});
