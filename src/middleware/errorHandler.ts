import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { isProd } from '../config/env';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = 500;
  let message = 'Internal server error.';
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err && typeof err === 'object' && 'name' in err) {
    const e = err as { name: string; code?: number; message?: string; errors?: unknown };
    if (e.name === 'ValidationError') {
      statusCode = 400;
      message = 'Validation failed.';
      details = e.errors;
    } else if (e.name === 'CastError') {
      statusCode = 400;
      const ce = e as unknown as { path?: string; value?: unknown; kind?: string };
      message = 'Invalid identifier format.';
      details = { path: ce.path, value: ce.value, expectedType: ce.kind };
    } else if (e.code === 11000) {
      statusCode = 409;
      message = 'A record with this unique value already exists.';
    } else if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
      statusCode = 401;
      message = 'Invalid or expired token.';
    }
  }

  if (statusCode >= 500) {
    logger.error('Unhandled error', { err, path: req.originalUrl, method: req.method });
  } else if (!isProd) {
    logger.warn(message, { path: req.originalUrl, method: req.method, statusCode, details, err });
  } else {
    logger.warn(message, { path: req.originalUrl, method: req.method, statusCode });
  }

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 && isProd ? 'Internal server error.' : message,
    ...(details ? { errors: details } : {}),
  });
}