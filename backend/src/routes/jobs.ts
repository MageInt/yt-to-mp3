import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { createJob, getJob, subscribe, TooManyJobsError } from '../services/downloadManager.js';
import { validateYoutubeUrl } from '../services/urlValidator.js';

export const jobsRouter = Router();

const createJobLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

jobsRouter.post('/jobs', createJobLimiter, (req, res) => {
  const result = validateYoutubeUrl(req.body?.url);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  try {
    const job = createJob(result.url);
    res.status(201).json({ id: job.id, status: job.status });
  } catch (err) {
    if (err instanceof TooManyJobsError) {
      res.status(429).json({ error: err.message });
      return;
    }
    throw err;
  }
});

jobsRouter.get('/jobs/:id/progress', (req, res) => {
  const { id } = req.params;

  const job = getJob(id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

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

jobsRouter.get('/jobs/:id/file', (req, res) => {
  const { id } = req.params;

  const job = getJob(id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

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

jobsRouter.get('/jobs/:id/files/:fileIndex', (req, res) => {
  const { id, fileIndex } = req.params;

  const job = getJob(id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

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
