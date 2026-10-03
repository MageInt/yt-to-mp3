const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const MAX_URL_LENGTH = 2048;

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export function validateYoutubeUrl(input: unknown): UrlValidationResult {
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'URL is required' };
  }

  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'URL is too long' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Invalid URL' };
  }

  if (parsed.username || parsed.password || parsed.port) {
    return { ok: false, error: 'Invalid URL' };
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, error: 'Only YouTube URLs are supported' };
  }

  return { ok: true, url: parsed.toString() };
}
