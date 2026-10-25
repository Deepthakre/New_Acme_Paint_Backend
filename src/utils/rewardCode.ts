import crypto from 'crypto';
import { env } from '../config/env';

/**
 * INNER reward QR codes.
 *
 * Shape:  <12 random chars><2 checksum chars>   e.g.  K7QH2M9XPD4T7A
 *  - 12 chars of Crockford base32 = 60 bits of CSPRNG randomness. No serial
 *    number, no product id, nothing guessable or enumerable.
 *  - 2 checksum chars = first 10 bits of HMAC(secret, payload). A random
 *    guess passes with probability 1/1024, so >99.9% of brute-force
 *    attempts are rejected without touching the database (and without
 *    revealing whether a code "almost" exists).
 *  - The database stores ONLY hmac(secret, code). A DB leak does not leak
 *    usable codes.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
const PAYLOAD_LEN = 12;
const CHECK_LEN = 2;
export const REWARD_CODE_LEN = PAYLOAD_LEN + CHECK_LEN;

function encodeBase32(bytes: Buffer, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length >= chars) break;
  }
  return out;
}

function checksumOf(payload: string): string {
  const mac = crypto.createHmac('sha256', env.REWARD_CODE_SECRET).update(`chk:${payload}`).digest();
  return encodeBase32(mac.subarray(0, 4), CHECK_LEN);
}

/** Generates a brand-new random code (plain text — shown ONCE for printing, never stored). */
export function generateRewardCode(): string {
  const payload = encodeBase32(crypto.randomBytes(9), PAYLOAD_LEN);
  return payload + checksumOf(payload);
}

/** HMAC of the normalised code — this (and only this) is what gets stored. */
export function hashRewardCode(code: string): string {
  return crypto.createHmac('sha256', env.REWARD_CODE_SECRET).update(`hash:${code}`).digest('hex');
}

/** "K7QH2M9XPD4T7A" -> "K7QH-2M9X-PD4T-7A" (for the human-readable line under the QR). */
export function formatRewardCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * Accepts whatever the scanner/typing produced: a full link
 * ("https://host/r/K7QH2M9XPD4T7A"), a dashed code, lowercase, with
 * look-alike characters (O/0, I/L/1) — and returns the canonical code, or
 * null when it cannot possibly be one of ours (wrong length / bad checksum).
 */
export function parseRewardCode(raw: string): string | null {
  let value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const segs = url.pathname.split('/').filter(Boolean);
    value = segs[segs.length - 1] || '';
  } catch {
    // not a URL — treat as typed/scanned code
  }
  value = value.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (value.length !== REWARD_CODE_LEN) return null;
  if ([...value].some((c) => !ALPHABET.includes(c))) return null;
  const payload = value.slice(0, PAYLOAD_LEN);
  const check = value.slice(PAYLOAD_LEN);
  const expected = checksumOf(payload);
  const a = Buffer.from(check);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
