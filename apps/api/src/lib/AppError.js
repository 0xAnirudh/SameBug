/**
 * The only error type route handlers should throw on purpose. Anything else
 * reaching the error handler is a bug and gets logged at error level.
 */
export class AppError extends Error {
  /**
   * @param {number} status   HTTP status
   * @param {string} code     stable machine-readable code, e.g. 'PASTE_NOT_FOUND'
   * @param {string} message  human-readable, safe to show a client
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message, details) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Sign in to continue') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static payloadTooLarge(message) {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', message);
  }
  static tooManyRequests(message, details) {
    return new AppError(429, 'RATE_LIMITED', message, details);
  }
}
