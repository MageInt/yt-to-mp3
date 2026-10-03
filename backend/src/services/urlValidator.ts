const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const MAX_URL_LENGTH = 2048;

const VIDEO_PATH = /^\/(shorts|live|embed|v)\/[\w-]+/;

export type UrlValidationResult =
  | { ok: true; url: string; isPlaylist: boolean }
  | { ok: false; error: string };

export interface UrlValidationOptions {
  allowPlaylists?: boolean;
}

function hasVideo(url: URL): boolean {
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    return /^\/[\w-]+/.test(url.pathname);
  }
  return Boolean(url.searchParams.get('v')) || VIDEO_PATH.test(url.pathname);
}

export function validateYoutubeUrl(input: unknown, options: UrlValidationOptions = {}): UrlValidationResult {
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

  const hasList = Boolean(parsed.searchParams.get('list'));
  if (options.allowPlaylists && hasList) {
    return { ok: true, url: parsed.toString(), isPlaylist: true };
  }

  // Single-video mode: a video must be identifiable, otherwise yt-dlp would fetch a whole
  // playlist or channel (`--no-playlist` only applies to watch URLs carrying a `list=`).
  if (!hasVideo(parsed)) {
    return {
      ok: false,
      error: hasList ? 'Playlist downloads are disabled. Paste a link to a single video.' : 'No video found in this URL',
    };
  }

  return { ok: true, url: parsed.toString(), isPlaylist: false };
}
