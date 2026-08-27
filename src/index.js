// Application entry point: Express server + static dashboard + API + scheduler.
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';
import { seed } from './db/seed.js';
import { router as apiRouter } from './routes/api.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ---- Security & hardening ---------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"], // Chart.js is vendored locally under /vendor
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(express.json({ limit: '64kb' }));
app.disable('x-powered-by');

// ---- API --------------------------------------------------------------------
app.use('/api', apiRouter);
app.get('/healthz', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ---- Static frontend --------------------------------------------------------
app.use(express.static(path.join(config.root, 'public'), { maxAge: '1h', index: 'index.html' }));

// ---- Boot -------------------------------------------------------------------
function boot() {
  seed(); // create tables + seed currencies (idempotent)
  startScheduler();
  app.listen(config.port, () => {
    logger.info(`Dashboard listening on http://localhost:${config.port}`);
    logger.info(`Primary provider: ${config.provider.primary} | fallback: ${config.provider.fallback}`);
    logger.info(`Daily update: "${config.schedule.cron}" (${config.schedule.timezone})`);
  });
}

boot();

export { app };
