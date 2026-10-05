import { config } from './config.js';
import { createApp } from './app.js';
import { cancelAllJobs, checkCookiesSetup } from './services/downloadManager.js';

checkCookiesSetup();
if (process.env.CONVERT_TOKEN && !config.convertToken) {
  console.error('[convert] CONVERT_TOKEN is shorter than 24 characters: the conversion API stays disabled');
} else if (config.convertToken) {
  console.log('[convert] Conversion API enabled for the browser extension');
}

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`App listening on port ${config.port}`);
});

// Node runs as PID 1 in the container: without handlers, SIGTERM is ignored and `docker stop` waits 10s.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    // Kill running yt-dlp processes instead of leaving them orphaned.
    cancelAllJobs();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
