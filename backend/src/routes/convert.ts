import { Router, raw, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { config } from '../config.js';
import { AUDIO_FORMATS, getAudioFormatStrict } from '../services/audioFormats.js';
import {
  cleanMetadata,
  ConversionError,
  ConverterBusyError,
  convertAudio,
  INPUT_TYPES,
  safeFilename,
} from '../services/converter.js';

// Conversion API for the Firefox extension. Authenticated by a shared bearer token (CONVERT_TOKEN):
// the session cookie is SameSite=Strict and never sent by an extension. Not an ambient credential,
// so no CSRF exposure; mounted before the same-origin check.
export const convertRouter = Router();

const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

function tokenMatches(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireToken(req: Request, res: Response, next: NextFunction) {
  if (!config.convertToken) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
  if (!match || !tokenMatches(match[1], config.convertToken)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  next();
}

convertRouter.use('/convert', limiter, requireToken, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

convertRouter.get('/convert/ping', (_req, res) => {
  res.json({
    ok: true,
    formats: AUDIO_FORMATS.map(({ id, label }) => ({ id, label })),
    maxUploadMb: Math.floor(config.maxUploadBytes / 1024 / 1024),
  });
});

convertRouter.post(
  '/convert',
  // Limit read per request so it follows the current config.
  (req, res, next) => raw({ type: () => true, limit: config.maxUploadBytes })(req, res, next),
  async (req, res) => {
    const input = INPUT_TYPES[(req.get('content-type') ?? '').split(';')[0].trim().toLowerCase()];
    if (!input) {
      res.status(415).json({ error: 'Send audio/webm or audio/mp4' });
      return;
    }
    const format = getAudioFormatStrict(req.query.format ?? 'mp3');
    if (!format) {
      res.status(400).json({ error: 'Unsupported audio format' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Empty body' });
      return;
    }

    const metadata = { title: cleanMetadata(req.query.title), artist: cleanMetadata(req.query.artist) };
    try {
      const { outputPath, cleanup } = await convertAudio(req.body, input, format, metadata);
      res.download(outputPath, safeFilename(metadata.title, format.ext), (err) => {
        cleanup();
        if (err && !res.headersSent) res.status(500).json({ error: 'Could not send the file' });
      });
    } catch (err) {
      if (err instanceof ConverterBusyError) {
        res.status(429).json({ error: 'The server is busy converting other files. Try again in a moment.' });
      } else if (err instanceof ConversionError) {
        res.status(422).json({ error: err.message });
      } else {
        throw err;
      }
    }
  },
);
