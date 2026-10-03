import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      // Served over plain HTTP on LAN setups: upgrading requests or pinning HSTS would break it.
      // TLS policy is left to the reverse proxy.
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: null },
      },
      strictTransportSecurity: false,
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', jobsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(express.static(publicDir));

  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err && !res.headersSent) {
        res.status(404).end();
      }
    });
  });

  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Bad request' });
  });

  return app;
}
