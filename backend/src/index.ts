import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`App listening on port ${config.port}`);
});

// Node runs as PID 1 in the container: without handlers, SIGTERM is ignored and `docker stop` waits 10s.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
