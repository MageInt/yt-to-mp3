import { Router, json } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { currentSession, requireSession, session } from '../middleware/session.js';
import { MAX_COOKIES_TEXT_LENGTH, parseNetscapeCookies } from '../services/cookieJar.js';
import { describeSession, setSessionCookies } from '../services/sessionStore.js';
import { sanitizeUserAgent } from '../services/userAgent.js';

export const sessionRouter = Router();

const cookiesLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

sessionRouter.use('/session', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Starts a session if needed. Never returns cookie names or values.
sessionRouter.get('/session', session({ create: true }), (_req, res) => {
  res.json(describeSession(currentSession(res)!));
});

sessionRouter.put(
  '/session/cookies',
  cookiesLimiter,
  // Larger body limit than the global 10 kB parser, for this route only.
  json({ limit: MAX_COOKIES_TEXT_LENGTH * 2 }),
  session({ create: false }),
  requireSession,
  (req, res) => {
    const result = parseNetscapeCookies(req.body?.cookies);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const current = currentSession(res)!;
    const userAgent = config.forwardUserAgent ? sanitizeUserAgent(req.get('user-agent')) : null;
    setSessionCookies(current, result.cookies, userAgent);
    res.json(describeSession(current));
  },
);

sessionRouter.delete('/session/cookies', session({ create: false }), requireSession, (_req, res) => {
  const current = currentSession(res)!;
  setSessionCookies(current, null);
  res.json(describeSession(current));
});
