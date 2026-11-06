import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Server-side, tamper-evident QR signing. The frontend's src/lib/qr.ts
 * ships a DEV-ONLY signer (secret embedded in the JS bundle — anyone can
 * extract it from devtools). This is the real replacement: the HMAC key
 * (QR_SIGNING_SECRET) never leaves the server, so a printed QR's signature
 * cannot be forged by a counterfeiter who only has access to the app.
 */
export function signPayload(id: string): { id: string; sig: string; qrString: string } {
  const sig = crypto.createHmac('sha256', env.QR_SIGNING_SECRET).update(id).digest('hex').slice(0, 12);
  return { id, sig, qrString: `${id}.${sig}` };
}

export function verifyQrString(qrString: string): { valid: boolean; id: string } {
  const [id, sig] = String(qrString || '').split('.');
  if (!id || !sig) return { valid: false, id: id || qrString };
  const expected = crypto.createHmac('sha256', env.QR_SIGNING_SECRET).update(id).digest('hex').slice(0, 12);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { valid, id };
}

/**
 * Same "id.sig" (or full verify URL) unwrapping the frontend does client
 * side, duplicated here because scan endpoints must never trust a raw
 * client-typed ID without stripping the URL/signature wrapper first.
 */
export function extractScannedId(raw: string | null | undefined): string {
  let value = String(raw || '').trim();
  if (!value) return value;
  try {
    const url = new URL(value);
    const qrParam = url.searchParams.get('qr');
    if (qrParam) value = qrParam;
  } catch {
    // not a URL — already a bare id/qrString
  }
  return value.split('.')[0];
}

export function nextProductId(counter: number): string {
  return `PRD-${new Date().getFullYear()}-${String(counter).padStart(6, '0')}`;
}
export function nextCartonId(counter: number): string {
  return `CTN-${new Date().getFullYear()}-${String(counter).padStart(5, '0')}`;
}
export function nextBatchId(counter: number): string {
  return `BATCH-${String(counter).padStart(4, '0')}`;
}
export function nextInvoiceId(counter: number): string {
  return `INV-${counter}`;
}
export function nextOrderId(counter: number): string {
  return `ORD-${counter}`;
}
export function nextVoucherId(counter: number): string {
  return `VCH-${counter}`;
}
export function nextPainterId(counter: number): string {
  return `PT-${new Date().getFullYear()}-${String(counter).padStart(6, '0')}`;
}
/** Printed on the sticker next to the QR, e.g. RB-000123. NOT secret - only the code inside the QR is. */
export function nextRewardSerial(counter: number): string {
  return `RB-${String(counter).padStart(6, '0')}`;
}
export function nextRewardClaimId(counter: number): string {
  return `RC-${new Date().getFullYear()}-${String(counter).padStart(6, '0')}`;
}
