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
  // Netscape cookies.txt exported from a YouTube session, to get past the "not a bot" check.
  // Copied into each job's temp dir, so it can be mounted read-only.
  ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE?.trim() || '',
};
