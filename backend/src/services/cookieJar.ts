// Parsing and sanitizing of user-supplied Netscape cookies.txt files.
// Only YouTube / Google cookies are kept; the jar is rebuilt from parsed fields so nothing
// else from the upload ever reaches yt-dlp.

export const MAX_COOKIES_TEXT_LENGTH = 100_000;
const MAX_COOKIES = 300;
const MAX_FIELD_LENGTH = 4096;

const ALLOWED_DOMAINS = ['youtube.com', 'google.com'];
const HTTPONLY_PREFIX = '#HttpOnly_';
// RFC 6265 cookie-name token and a conservative value charset (no control chars, spaces, quotes, ; or ,).
const NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const VALUE_RE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

export interface Cookie {
  domain: string;
  includeSubdomains: boolean;
  path: string;
  secure: boolean;
  expires: number;
  name: string;
  value: string;
  httpOnly: boolean;
}

export type CookieParseResult =
  | { ok: true; cookies: Cookie[] }
  | { ok: false; error: string };

function isAllowedDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\./, '');
  return ALLOWED_DOMAINS.some(allowed => d === allowed || d.endsWith(`.${allowed}`));
}

export function parseNetscapeCookies(text: unknown): CookieParseResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'Cookies file is empty' };
  }
  if (text.length > MAX_COOKIES_TEXT_LENGTH) {
    return { ok: false, error: 'Cookies file is too large' };
  }

  const cookies: Cookie[] = [];
  let sawCookieLine = false;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    let httpOnly = false;
    if (line.startsWith(HTTPONLY_PREFIX)) {
      httpOnly = true;
      line = line.slice(HTTPONLY_PREFIX.length);
    } else if (line.startsWith('#') || line.trim() === '') {
      continue;
    }

    const fields = line.split('\t');
    if (fields.length !== 7) {
      return { ok: false, error: 'Not a Netscape cookies.txt file (expected 7 tab-separated fields per line)' };
    }
    sawCookieLine = true;

    const [domain, includeSubdomains, cookiePath, secure, expires, name, value] = fields;
    if (fields.some(f => f.length > MAX_FIELD_LENGTH)) {
      return { ok: false, error: 'Cookie line is too long' };
    }
    if (!/^\.?[a-z0-9.-]+$/i.test(domain) || !cookiePath.startsWith('/') || /\s/.test(cookiePath)) {
      return { ok: false, error: 'Malformed cookie line' };
    }
    if (!NAME_RE.test(name) || !VALUE_RE.test(value) || !/^\d+$/.test(expires)) {
      return { ok: false, error: 'Malformed cookie line' };
    }
    if (!['TRUE', 'FALSE'].includes(includeSubdomains.toUpperCase()) || !['TRUE', 'FALSE'].includes(secure.toUpperCase())) {
      return { ok: false, error: 'Malformed cookie line' };
    }

    if (!isAllowedDomain(domain)) continue;

    cookies.push({
      domain: domain.toLowerCase(),
      includeSubdomains: includeSubdomains.toUpperCase() === 'TRUE',
      path: cookiePath,
      secure: secure.toUpperCase() === 'TRUE',
      expires: Number(expires),
      name,
      value,
      httpOnly,
    });
    if (cookies.length > MAX_COOKIES) {
      return { ok: false, error: 'Too many cookies' };
    }
  }

  if (!sawCookieLine) {
    return { ok: false, error: 'Not a Netscape cookies.txt file' };
  }
  if (cookies.length === 0) {
    return { ok: false, error: 'No YouTube or Google cookies found in this file' };
  }
  return { ok: true, cookies };
}

export function serializeNetscapeCookies(cookies: Cookie[]): string {
  const lines = cookies.map(c => [
    `${c.httpOnly ? HTTPONLY_PREFIX : ''}${c.domain}`,
    c.includeSubdomains ? 'TRUE' : 'FALSE',
    c.path,
    c.secure ? 'TRUE' : 'FALSE',
    String(c.expires),
    c.name,
    c.value,
  ].join('\t'));
  return `# Netscape HTTP Cookie File\n${lines.join('\n')}\n`;
}

// Google sign-in cookies (SID, HSID, __Secure-3PSID, LOGIN_INFO…). Short-lived tracking cookies
// YouTube adds during downloads (GPS, YSC…) are ignored, they say nothing about the session.
const AUTH_COOKIE = /SID$|^LOGIN_INFO$/;

// Earliest expiry among persistent sign-in cookies, in ms since epoch (null: none found).
export function earliestExpiry(cookies: Cookie[]): number | null {
  const times = cookies.filter(c => c.expires > 0 && AUTH_COOKIE.test(c.name)).map(c => c.expires * 1000);
  return times.length ? Math.min(...times) : null;
}
