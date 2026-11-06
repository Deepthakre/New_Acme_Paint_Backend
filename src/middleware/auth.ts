import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../utils/jwt';
import { User } from '../models/User';
import { asyncHandler } from '../utils/asyncHandler';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        username: string;
        /** Names this user may appear under as a dealer (account name + business name). */
        dealerNames: string[];
      };
    }
  }
}

function dealerNamesOf(user: { name?: string; businessName?: string }): string[] {
  return [user.name, user.businessName].filter((n): n is string => Boolean(n));
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Verifies the access token, and re-checks the user still exists and the token wasn't revoked (tokenVersion). */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Missing bearer token.');

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token.');
  }

  const user = await User.findById(payload.sub).select('tokenVersion role username name businessName').lean();
  if (!user) throw ApiError.unauthorized('User no longer exists.');
  if (user.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session has been invalidated. Please log in again.');

  req.user = { id: payload.sub, role: user.role, username: user.username, dealerNames: dealerNamesOf(user) };
  next();
});

/** Restricts a route to one or more roles. Always used AFTER requireAuth. */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden('Your role cannot access this resource.'));
    next();
  };
}

/** Optional auth: attaches req.user if a valid token is present, but never rejects the request. Used by public/verify endpoints that behave slightly differently when logged in. */
export const optionalAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('tokenVersion role username name businessName').lean();
    if (user && user.tokenVersion === payload.tv) {
      req.user = { id: payload.sub, role: user.role, username: user.username, dealerNames: dealerNamesOf(user) };
    }
  } catch {
    // ignore invalid token for optional auth
  }
  next();
});

/**
 * Stops a dealer from reading or acting on ANOTHER dealer's data. The API
 * identifies dealers by name, so without this any logged-in dealer could
 * pass someone else's name in the URL/body. Other roles are unaffected.
 *
 * - 'params' / 'body': the value must be one of the caller's own names.
 * - 'query': a missing value is forced to the caller's own name (so list
 *   endpoints are scoped automatically); a different value is rejected.
 */
export function enforceOwnDealer(source: 'params' | 'body' | 'query' = 'params', key = 'dealer') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role !== 'dealer') return next();

    const bag = req[source] as Record<string, unknown>;
    const value = bag?.[key];

    if (source === 'query' && (value === undefined || value === '')) {
      (req.query as Record<string, unknown>)[key] = req.user.dealerNames[0];
      return next();
    }
    if (typeof value !== 'string' || !req.user.dealerNames.includes(value)) {
      return next(ApiError.forbidden('You can only access your own dealer account.'));
    }
    next();
  };
}
