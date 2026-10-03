function intFromEnv(name: string, fallback: number): number {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  port: intFromEnv('PORT', 8080),
  maxConcurrentJobs: intFromEnv('MAX_CONCURRENT_JOBS', 3),
  maxPlaylistItems: intFromEnv('MAX_PLAYLIST_ITEMS', 50),
  jobTtlMs: intFromEnv('JOB_TTL_MINUTES', 30) * 60 * 1000,
  downloadTimeoutMs: intFromEnv('DOWNLOAD_TIMEOUT_MINUTES', 10) * 60 * 1000,
  rateLimitWindowMs: intFromEnv('RATE_LIMIT_WINDOW_MINUTES', 15) * 60 * 1000,
  rateLimitMax: intFromEnv('RATE_LIMIT_MAX', 20),
  trustProxy: process.env.TRUST_PROXY === 'true',
  // Proxy for all yt-dlp traffic, e.g. http://192.168.1.10:8890 (empty = direct connection).
  ytdlpProxy: process.env.YTDLP_PROXY?.trim() || '',
};
