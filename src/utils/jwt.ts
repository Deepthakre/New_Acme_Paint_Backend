import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '../models/User';

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
  username: string;
  tv: number; // token version — bumped to invalidate all outstanding tokens (e.g. password change)
}

export interface RefreshTokenPayload {
  sub: string;
  tv: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export const REFRESH_COOKIE_NAME = 'tp_refresh';
