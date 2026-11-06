import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { User, hashPassword } from '../models/User';
import { signAccessToken, signRefreshToken, verifyRefreshToken, REFRESH_COOKIE_NAME } from '../utils/jwt';
import { isProd, env } from '../config/env';

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  // SameSite=None is only accepted by browsers on secure (HTTPS) cookies.
  secure: isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function issueTokens(res: Response, user: { id: string; role: 'admin' | 'warehouse' | 'dealer' | 'salesrep' | 'customer'; username: string; tokenVersion: number }) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, username: user.username, tv: user.tokenVersion });
  const refreshToken = signRefreshToken({ sub: user.id, tv: user.tokenVersion });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTS);
  return accessToken;
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { role, username, password, businessName, owner, fullName, mobile, address } = req.body;

  const existing = await User.findOne({ username }).lean();
  if (existing) throw ApiError.conflict('That username is already taken.');

  const passwordHash = await hashPassword(password);
  const name = role === 'dealer' ? businessName || '' : fullName || '';

  const user = await User.create({
    username,
    passwordHash,
    role,
    name,
    mobile,
    businessName: role === 'dealer' ? businessName : undefined,
    owner: role === 'dealer' ? owner : undefined,
    address: role === 'dealer' ? address : undefined,
    target: role === 'salesrep' ? 0 : undefined,
    dealers: role === 'salesrep' ? [] : undefined,
  });

  const accessToken = issueTokens(res, { id: String(user._id), role: user.role, username: user.username, tokenVersion: user.tokenVersion });
  res.status(201).json({ success: true, data: { user: user.toJSON(), accessToken } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password, role } = req.body;

  const user = await User.findOne({ username: username.toLowerCase().trim(), role }).select(
    '+passwordHash +failedLoginAttempts +lockUntil'
  );

  // Always run a bcrypt compare, even when no user was found, against a
  // fixed dummy hash — so response timing doesn't leak whether a username
  // exists (a basic timing-attack mitigation on the login endpoint).
  const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8i6C7jZ4ruSw0X8k5kR8Wz1YbXqf3S';
  const isLocked = user?.isLocked() ?? false;
  const passwordOk = user ? await user.comparePassword(password) : await bcrypt.compare(password, DUMMY_HASH);

  if (!user || isLocked || !passwordOk) {
    if (user && !isLocked) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 8) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15-minute account lock on top of the rate limiter
        user.failedLoginAttempts = 0;
      }
      await user.save();
    }
    throw ApiError.unauthorized(
      isLocked ? 'Account temporarily locked due to repeated failed attempts. Try again later.' : 'Invalid username/password, or this account does not match that role.'
    );
  }

  if (user.failedLoginAttempts) {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();
  }

  const accessToken = issueTokens(res, { id: String(user._id), role: user.role, username: user.username, tokenVersion: user.tokenVersion });
  res.json({ success: true, data: { user: user.toJSON(), accessToken } });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) throw ApiError.unauthorized('No refresh token provided.');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token.');
  }

  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session no longer valid.');

  const accessToken = issueTokens(res, { id: String(user._id), role: user.role, username: user.username, tokenVersion: user.tokenVersion });
  res.json({ success: true, data: { accessToken } });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // Works even when the short-lived access token has already expired: the
  // httpOnly refresh cookie identifies the session. Bumping tokenVersion
  // revokes every outstanding token for this user (all devices).
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await User.updateOne({ _id: payload.sub, tokenVersion: payload.tv }, { $inc: { tokenVersion: 1 } });
    } catch {
      // Invalid/expired cookie: nothing to revoke — still clear it below.
    }
  }
  const { maxAge: _maxAge, ...clearOpts } = REFRESH_COOKIE_OPTS;
  res.clearCookie(REFRESH_COOKIE_NAME, clearOpts);
  res.json({ success: true, data: null });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found.');
  res.json({ success: true, data: user.toJSON() });
});

export const listKnownDealerNames = asyncHandler(async (_req: Request, res: Response) => {
  const { Order } = await import('../models/Order');
  const dealerUsers = await User.find({ role: 'dealer' }).select('businessName').lean();
  const dealerOrders = await Order.distinct('dealer');
  const names = new Set<string>();
  dealerUsers.forEach((u) => u.businessName && names.add(u.businessName));
  dealerOrders.forEach((d) => names.add(d));
  res.json({ success: true, data: [...names] });
});

export const getDealerProfile = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const user = await User.findOne({ role: 'dealer', $or: [{ businessName: name }, { name }] }).lean();
  if (!user) return res.json({ success: true, data: null });
  res.json({
    success: true,
    data: { businessName: user.businessName || user.name, owner: user.owner, mobile: user.mobile, address: user.address },
  });
});

export const getSalesRep = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOne({ role: 'salesrep', name: req.params.name });
  res.json({ success: true, data: user ? user.toJSON() : null });
});
