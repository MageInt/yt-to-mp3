const MAX_LENGTH = 512;
// Automation UAs would only make YouTube's bot detection worse: let yt-dlp use its own instead.
const AUTOMATION = /headless|bot\b|crawler|spider|curl|wget|python|httpclient|okhttp|go-http|java\//i;

// Returns the caller's User-Agent if it is safe and useful to forward to yt-dlp, else null.
export function sanitizeUserAgent(ua: unknown): string | null {
  if (typeof ua !== 'string') return null;
  const value = ua.trim();
  if (value.length < 20 || value.length > MAX_LENGTH) return null;
  // Printable ASCII only: no CR/LF or other control characters that could break the HTTP header.
  if (!/^[\x20-\x7E]+$/.test(value)) return null;
  if (!value.startsWith('Mozilla/5.0 (')) return null;
  if (AUTOMATION.test(value)) return null;
  return value;
}

// With cookies, YouTube should see the browser they were exported from: use the UA captured at
// upload time. Without cookies (or if none was captured), use the current request's UA.
export function chooseUserAgent(
  session: { cookies: unknown[] | null; cookiesUserAgent: string | null } | undefined,
  requestUserAgent: unknown,
): string | null {
  if (session?.cookies?.length && session.cookiesUserAgent) return session.cookiesUserAgent;
  return sanitizeUserAgent(requestUserAgent);
}
