import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * Shared handler: rate-limit rejections go through the same error shape
 * as every other error in the API (see errorHandler.ts).
 */
function rateLimitHandler(_req: Request, _res: Response) {
  throw ApiError.tooMany('Too many attempts. Please wait before trying again.');
}

// NOTE ON SCALING: these use express-rate-limit's default in-memory store,
// which is per-process. That's correct and sufficient for a single-instance
// deployment. If you horizontally scale this API across multiple
// instances/containers behind a load balancer, swap `store` on each limiter
// below for a shared store (e.g. `rate-limit-redis` backed by a Redis
// instance you already run) so the limit is enforced across all instances,
// not per-instance.

/**
 * LOGIN RATE LIMITER — brute-force protection, the specific requirement
 * from the brief. Keyed by IP + attempted username, so a targeted brute
 * force against ONE account from ONE IP is capped tightly, while
 * `skipSuccessfulRequests` means a legitimate user who mistypes their
 * password once isn't punished repeatedly for later correct attempts.
 */
export const loginRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.toLowerCase().trim() : 'unknown';
    return `${req.ip}:${username}`;
  },
  handler: rateLimitHandler,
});

/** Registration abuse guard — looser than login, but still capped per IP. */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** OTP send guard — prevents SMS-bombing a phone number / burning SMS budget. */
export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${req.ip}:${req.user?.id ?? 'anon'}`,
  handler: rateLimitHandler,
});

/** General API-wide limiter applied to every request as a baseline defense. */
export const apiRateLimiter = rateLimit({
  windowMs: env.API_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: env.API_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// ---------------- painter reward programme ----------------

/** Painter OTP send: per IP + mobile, so one phone can't be SMS-bombed and one IP can't spray many numbers. */
export const painterOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${req.ip}:${String(req.body?.mobile ?? '').slice(0, 10)}`,
  handler: rateLimitHandler,
});

/** Painter OTP verify / refresh: brute-force guard on top of the per-OTP attempt counter. */
export const painterAuthLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Reward redeem: 5 scans / minute per painter (falls back to IP) - stops scripted code guessing. */
export const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `redeem:${req.painter?.id ?? req.ip}`,
  handler: rateLimitHandler,
});

/** Same limiter, keyed by IP, placed BEFORE auth so unauthenticated floods are cheap to reject. */
export const redeemIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

export const withdrawLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `withdraw:${req.painter?.id ?? req.ip}`,
  handler: rateLimitHandler,
});
