import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Painter tokens are signed with keys DERIVED from the staff secrets, so a
 * staff token can never validate as a painter token (and vice versa), even
 * though both are standard JWTs.
 */
const ACCESS_KEY = `${env.JWT_ACCESS_SECRET}:painter`;
const REFRESH_KEY = `${env.JWT_REFRESH_SECRET}:painter`;

export interface PainterTokenPayload {
  sub: string; // painter business id (PT-YYYY-xxxxxx)
  tv: number; // tokenVersion - bump to revoke every session
}

export function signPainterAccessToken(p: PainterTokenPayload): string {
  return jwt.sign(p, ACCESS_KEY, { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as SignOptions);
}
export function signPainterRefreshToken(p: PainterTokenPayload): string {
  return jwt.sign(p, REFRESH_KEY, { expiresIn: env.JWT_REFRESH_EXPIRES_IN } as SignOptions);
}
export function verifyPainterAccessToken(token: string): PainterTokenPayload {
  return jwt.verify(token, ACCESS_KEY) as PainterTokenPayload;
}
export function verifyPainterRefreshToken(token: string): PainterTokenPayload {
  return jwt.verify(token, REFRESH_KEY) as PainterTokenPayload;
}

export const PAINTER_REFRESH_COOKIE = 'pt_refresh';
