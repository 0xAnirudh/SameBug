import { randomUUID } from 'node:crypto';

/**
 * One id per request, echoed to the client and attached to every log line it
 * produces. This is the difference between debugging a load test and guessing.
 */
export function requestId(req, res, next) {
  req.id = req.get('x-request-id') || randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}
