import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { createSession, getSession, type Session } from '../services/sessionStore.js';

export const SESSION_COOKIE = 'yt2mp3_sid';

function readSessionId(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

function setSessionCookie(req: Request, res: Response, session: Session) {
  const secure = config.cookieSecure === 'true' || (config.cookieSecure === 'auto' && req.secure);
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: config.sessionMaxMs,
  });
}

export function currentSession(res: Response): Session | undefined {
  return res.locals.session as Session | undefined;
}

// Attaches the caller's session to res.locals.session. With `create`, a new session is started
// (and the cookie set) when the caller has none; otherwise the request goes on without one.
export function session(options: { create: boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    let current = getSession(readSessionId(req));
    if (!current && options.create) {
      current = createSession();
      setSessionCookie(req, res, current);
    }
    res.locals.session = current;
    next();
  };
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!currentSession(res)) {
    res.status(401).json({ error: 'Session expired. Reload the page.' });
    return;
  }
  next();
}

// CSRF defence for state-changing requests: refuse anything a browser flags as coming from
// another site, and any Origin that does not match the host the request was sent to.
export function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  if (req.headers['sec-fetch-site'] === 'cross-site') {
    res.status(403).json({ error: 'Cross-site request refused' });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      res.status(403).json({ error: 'Cross-site request refused' });
      return;
    }
    const forwarded = config.trustProxy ? req.headers['x-forwarded-host'] : undefined;
    const host = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || req.headers.host || '';
    if (!originMatchesHost(originUrl, host)) {
      res.status(403).json({ error: 'Cross-site request refused' });
      return;
    }
  }
  next();
}

// Reverse proxies often forward `Host: $host`, i.e. without the port, while the browser's Origin
// keeps a non-default port (https://example.home:8094). When the forwarded host has no port,
// compare host names only.
export function originMatchesHost(origin: URL, rawHost: string): boolean {
  const host = rawHost.toLowerCase();
  if (!host) return false;
  if (origin.host.toLowerCase() === host) return true;
  const hostHasPort = /:\d+$/.test(host);
  return !hostHasPort && origin.hostname.toLowerCase() === host.replace(/^\[|\]$/g, '');
}
