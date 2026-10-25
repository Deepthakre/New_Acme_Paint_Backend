import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError';

interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Generic zod-based request validator. Parses body/query/params against
 * the given schemas, replaces req.<part> with the PARSED (and therefore
 * coerced + defaulted) value, and turns any failure into a 400 with a
 * field-level error map — never lets unvalidated input reach a controller.
 */
export function validate({ body, query, params }: ValidateSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (body) req.body = body.parse(req.body);
      if (query) req.query = query.parse(req.query) as typeof req.query;
      if (params) req.params = params.parse(req.params) as typeof req.params;
      next();
    } catch (err: any) {
      const details = err?.errors ?? err?.issues ?? undefined;
      next(ApiError.badRequest('Validation failed.', details));
    }
  };
}
