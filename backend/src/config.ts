function intFromEnv(name: string, fallback: number): number {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

export const config = {
  port: intFromEnv('PORT', 8080),
  maxConcurrentJobs: intFromEnv('MAX_CONCURRENT_JOBS', 3),
  maxPlaylistItems: intFromEnv('MAX_PLAYLIST_ITEMS', 50),
  jobTtlMs: intFromEnv('JOB_TTL_MINUTES', 30) * 60 * 1000,
  downloadTimeoutMs: intFromEnv('DOWNLOAD_TIMEOUT_MINUTES', 10) * 60 * 1000,
  rateLimitWindowMs: intFromEnv('RATE_LIMIT_WINDOW_MINUTES', 15) * 60 * 1000,
  rateLimitMax: intFromEnv('RATE_LIMIT_MAX', 20),
  trustProxy: boolFromEnv('TRUST_PROXY', false),
  // Playlist downloads (whole list from a `list=` URL). Off: only the video in the URL is downloaded.
  enablePlaylists: boolFromEnv('ENABLE_PLAYLISTS', false),
  // Proxy for all yt-dlp traffic, e.g. http://192.168.1.10:8890 (empty = direct connection).
  ytdlpProxy: process.env.YTDLP_PROXY?.trim() || '',
  // Server-wide fallback cookies.txt, used when the user's session has no cookies of its own.
  ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE?.trim() || '',
  // RAM-backed directory where cookie jars are written for the lifetime of a yt-dlp process only.
  secretsTmpDir: process.env.SECRETS_TMP_DIR?.trim() || '/dev/shm',
  // Per-browser sessions (memory only) holding user-uploaded YouTube cookies.
  sessionIdleMs: intFromEnv('SESSION_IDLE_MINUTES', 120) * 60 * 1000,
  sessionMaxMs: intFromEnv('SESSION_MAX_HOURS', 24) * 60 * 60 * 1000,
  maxSessions: intFromEnv('MAX_SESSIONS', 1000),
  // 'auto': Secure flag when the request came over HTTPS (needs TRUST_PROXY behind a TLS proxy).
  cookieSecure: (process.env.COOKIE_SECURE?.trim().toLowerCase() || 'auto') as 'auto' | 'true' | 'false',
};
