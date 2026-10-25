import type { NextFunction, Request, Response } from 'express';
import mongoSanitize from 'express-mongo-sanitize';

/**
 * Strips any key starting with `$` or containing `.` from req.body /
 * req.params (NoSQL operator injection guard, e.g. `{ "username": { "$ne": null } }`).
 * req.query is deliberately left alone here — express 4 still allows
 * writing to req.query in-place, but we avoid depending on that; query
 * values are additionally validated per-route via zod schemas.
 */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = mongoSanitize.sanitize(req.body);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = mongoSanitize.sanitize(req.params) as typeof req.params;
  }
  next();
}
