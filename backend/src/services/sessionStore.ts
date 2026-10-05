import crypto from 'crypto';
import { config } from '../config.js';
import { earliestExpiry, type Cookie } from './cookieJar.js';

// Anonymous per-browser sessions, kept in memory only: a restart wipes everything.
export interface Session {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  cookies: Cookie[] | null;
  cookiesUpdatedAt: number | null;
  // Browser User-Agent captured when the cookies were uploaded (sanitized), sent with every download using them.
  cookiesUserAgent: string | null;
}

const sessions = new Map<string, Session>();
const SWEEP_INTERVAL = 5 * 60 * 1000;

function isExpired(session: Session, now: number): boolean {
  return now - session.lastSeenAt > config.sessionIdleMs || now - session.createdAt > config.sessionMaxMs;
}

function destroy(id: string) {
  const session = sessions.get(id);
  if (session) {
    session.cookies = null;
    session.cookiesUserAgent = null;
  }
  sessions.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (isExpired(session, now)) destroy(id);
  }
}, SWEEP_INTERVAL).unref();

export function createSession(): Session {
  // Map keeps insertion order: evict the oldest sessions when full.
  while (sessions.size >= config.maxSessions) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    destroy(oldest);
  }
  const now = Date.now();
  const session: Session = {
    id: crypto.randomBytes(32).toString('base64url'),
    createdAt: now,
    lastSeenAt: now,
    cookies: null,
    cookiesUpdatedAt: null,
    cookiesUserAgent: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string | undefined): Session | undefined {
  if (!id) return undefined;
  const session = sessions.get(id);
  if (!session) return undefined;
  const now = Date.now();
  if (isExpired(session, now)) {
    destroy(id);
    return undefined;
  }
  session.lastSeenAt = now;
  return session;
}

export function setSessionCookies(session: Session, cookies: Cookie[] | null, userAgent: string | null = null) {
  session.cookies = cookies;
  session.cookiesUpdatedAt = cookies ? Date.now() : null;
  session.cookiesUserAgent = cookies ? userAgent : null;
}

// Read access for background work (queued downloads): does not extend the session.
export function peekSession(id: string): Session | undefined {
  const session = sessions.get(id);
  if (!session || isExpired(session, Date.now())) return undefined;
  return session;
}

// Used after a download to store cookies rotated by YouTube. Does not extend the session.
export function replaceSessionCookies(id: string, cookies: Cookie[]) {
  const session = sessions.get(id);
  if (session && session.cookies) {
    session.cookies = cookies;
  }
}

export function describeSession(session: Session) {
  return {
    hasCookies: Boolean(session.cookies?.length),
    cookieCount: session.cookies?.length ?? 0,
    cookiesUpdatedAt: session.cookiesUpdatedAt,
    cookiesExpireAt: session.cookies ? earliestExpiry(session.cookies) : null,
    // The user's own browser UA, shown so they know which browser the cookies are paired with.
    cookiesUserAgent: session.cookiesUserAgent,
    expiresAt: Math.min(session.lastSeenAt + config.sessionIdleMs, session.createdAt + config.sessionMaxMs),
    idleTimeoutMinutes: config.sessionIdleMs / 60000,
  };
}

export function sessionCount(): number {
  return sessions.size;
}
