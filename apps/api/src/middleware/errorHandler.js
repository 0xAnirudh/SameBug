import { ZodError } from 'zod';
import { AppError } from '../lib/AppError.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(AppError.notFound(`No route for ${req.method} ${req.path}`));
}

/**
 * The single place in the codebase that shapes an error response. Route
 * handlers throw; they never format.
 */
export function errorHandler(err, req, res, _next) {
  const { status, code, message, details } = normalize(err);

  const log = logger.child({ reqId: req.id });
  if (status >= 500) {
    log.error({ err, code }, 'request failed');
  } else {
    log.warn({ code, status, msg: message }, 'request rejected');
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: req.id,
      // A stack in a production response is an information leak.
      ...(env.isProd || status < 500 ? {} : { stack: err.stack }),
    },
  });
}

function normalize(err) {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Some fields are invalid',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    };
  }

  // express.json() size rejection
  if (err.type === 'entity.too.large') {
    return {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'That paste is too large',
    };
  }

  if (err.type === 'entity.parse.failed') {
    return { status: 400, code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' };
  }

  if (err.name === 'CastError') {
    return { status: 400, code: 'BAD_IDENTIFIER', message: 'That identifier is not valid' };
  }

  if (err.name === 'ValidationError') {
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Some fields are invalid',
      details: Object.values(err.errors ?? {}).map((e) => ({
        field: e.path,
        message: e.message,
      })),
    };
  }

  if (err.code === 11000) {
    return { status: 409, code: 'ALREADY_EXISTS', message: 'That already exists' };
  }

  return {
    status: 500,
    code: 'INTERNAL',
    message: 'Something went wrong on our end',
  };
}
