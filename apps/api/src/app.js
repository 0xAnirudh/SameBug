import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import metaRoutes from './routes/meta.routes.js';
import authRoutes from './routes/auth.routes.js';
import pasteRoutes from './routes/paste.routes.js';
import meRoutes from './routes/me.routes.js';

/**
 * Builds a fully configured Express app and never calls listen(). That split is
 * what lets Supertest mount the real app in-process — no port, no race, no
 * flaky teardown — and it costs four lines.
 */
export function buildApp() {
  const app = express();

  // Behind Render/Railway the client IP lives in X-Forwarded-For. Without this
  // every rate limit bucket would key on the load balancer and throttle everyone.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === '/health' },
    })
  );

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true, // the refresh token is an httpOnly cookie
    })
  );

  // Slightly above the paste cap so an oversized paste is rejected by our own
  // check with a useful message, rather than by the body parser.
  app.use(express.json({ limit: Math.ceil(env.MAX_PASTE_BYTES * 1.1) }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.use('/', metaRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/pastes', pasteRoutes);
  app.use('/api/me', meRoutes);

  // An unmatched /api route is always a JSON 404, whether or not a client
  // build exists. Without this the SPA fallback below would swallow API typos
  // and hand back an HTML shell with a 200.
  app.use('/api', notFound);

  serveClient(app);

  // Reached only when no client has been built — a fresh clone, or CI.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * In production the API also serves the built client, so the deploy is one
 * service on one origin — which is why the refresh cookie needs no cross-site
 * handling. In development Vite serves it and proxies /api here instead.
 */
function serveClient(app) {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (!existsSync(dist)) return;

  app.use(express.static(dist, { maxAge: '1h', index: false }));

  // Client-side routing: anything that is not an API route falls back to the
  // shell. Registered after the API routes so it can never shadow one.
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}
