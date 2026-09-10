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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
