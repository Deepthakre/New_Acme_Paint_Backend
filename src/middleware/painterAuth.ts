import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyPainterAccessToken } from '../utils/painterJwt';
import { Painter } from '../models/Painter';
import { asyncHandler } from '../utils/asyncHandler';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      painter?: {
        id: string;
        name: string;
        mobile: string;
        status: string;
        upiId: string;
        upiUpdatedAt: Date | null;
        redeemBlockedUntil: Date | null;
      };
    }
  }
}

/** Painter-only auth (separate token type from staff). Short-lived access token; the account is re-checked on EVERY request, so blocking a painter takes effect immediately. */
export const requirePainter = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Missing bearer token.');

  let payload;
  try {
    payload = verifyPainterAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token.');
  }

  const painter = await Painter.findOne({ id: payload.sub })
    .select('id name mobile status upiId upiUpdatedAt redeemBlockedUntil tokenVersion')
    .lean();
  if (!painter || painter.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session expired. Please log in again.');
  if (painter.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked. Please contact support.');

  req.painter = {
    id: painter.id,
    name: painter.name,
    mobile: painter.mobile,
    status: painter.status,
    upiId: painter.upiId,
    upiUpdatedAt: painter.upiUpdatedAt,
    redeemBlockedUntil: painter.redeemBlockedUntil,
  };
  next();
});
