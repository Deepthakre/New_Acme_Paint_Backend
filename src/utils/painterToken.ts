import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Short-lived token handed out after a painter verifies their mobile by OTP. It proves "this request comes
 * from the owner of <mobile>" for a few minutes - nothing more (no account, no password, no refresh cookie).
 * Signed with a key DERIVED from the staff secret, so a staff token can never pass as a painter token or vice versa.
 */
const KEY = `${env.JWT_ACCESS_SECRET}:painter-session`;

export interface PainterTokenPayload {
  sub: string; // verified mobile number
  typ: 'painter-session';
}

export const PAINTER_SESSION_SECONDS = env.REWARD_SESSION_MINUTES * 60;

export function signPainterToken(mobile: string): string {
  return jwt.sign({ sub: mobile, typ: 'painter-session' } satisfies PainterTokenPayload, KEY, { expiresIn: PAINTER_SESSION_SECONDS } as SignOptions);
}

export function verifyPainterToken(token: string): PainterTokenPayload {
  const p = jwt.verify(token, KEY) as PainterTokenPayload;
  if (p.typ !== 'painter-session' || !/^\d{10}$/.test(p.sub)) throw new Error('bad token');
  return p;
}
