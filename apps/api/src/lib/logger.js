import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'samebug-api' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password'],
    remove: true,
  },
  transport: env.isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
