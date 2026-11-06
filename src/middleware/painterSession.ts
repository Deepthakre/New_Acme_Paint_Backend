import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyPainterToken } from '../utils/painterToken';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Mobile number the painter proved ownership of with an OTP. */
      painterMobile?: string;
    }
  }
}

export function requirePainterSession(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized('Please verify your mobile number first.'));
  try {
    req.painterMobile = verifyPainterToken(token).sub;
    next();
  } catch {
    next(ApiError.unauthorized('Your verification expired. Please verify your mobile number again.'));
  }
}
