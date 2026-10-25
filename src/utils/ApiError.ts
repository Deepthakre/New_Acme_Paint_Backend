/**
 * A known, expected error we deliberately throw (bad input, not found,
 * unauthorized, conflict, etc). The global error handler trusts `message`
 * on these to be safe to show the client. Anything that is NOT an
 * ApiError is treated as a programming/unknown error and its message is
 * hidden from the client in production.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'Authentication required.') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Resource not found.') {
    return new ApiError(404, message);
  }
  static conflict(message: string) {
    return new ApiError(409, message);
  }
  static tooMany(message = 'Too many requests. Please try again later.') {
    return new ApiError(429, message);
  }
  static internal(message = 'Something went wrong.') {
    return new ApiError(500, message);
  }
}
