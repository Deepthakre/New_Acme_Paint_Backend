import type { Request, Response } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { Payout } from '../models/Payout';
import { applyPayoutResult, parsePayoutWebhook } from '../services/payout.service';

function signatureMatches(raw: Buffer, provided: string | undefined, secret: string): boolean {
  if (!provided) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(provided.trim().toLowerCase(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /webhooks/payout - payout gateway callback.
 * The raw request body is HMAC-verified (constant-time) BEFORE anything is parsed or acted on.
 * Re-delivered events are harmless: applyPayoutResult is idempotent.
 */
export const payoutWebhook = asyncHandler(async (req: Request, res: Response) => {
  if (!env.PAYOUT_WEBHOOK_SECRET) throw new ApiError(503, 'Payout webhook is not configured.');
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) throw ApiError.badRequest('Missing request body.');

  const header = req.headers[env.PAYOUT_WEBHOOK_SIGNATURE_HEADER.toLowerCase()] ?? req.headers['x-razorpay-signature'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!signatureMatches(raw, provided, env.PAYOUT_WEBHOOK_SECRET)) {
    logger.warn('Payout webhook rejected: bad signature', { ip: req.ip });
    throw ApiError.unauthorized('Invalid signature.');
  }

  const event = parsePayoutWebhook(req.body);
  if (!event) return res.json({ success: true, data: { ignored: true } }); // acknowledge unknown events so the gateway stops retrying

  if (event.result === 'PROCESSING') {
    await Payout.updateOne({ id: event.payoutId, status: 'PENDING' }, { $set: { status: 'PROCESSING', providerRef: event.providerRef } });
    return res.json({ success: true, data: { ok: true } });
  }

  try {
    await applyPayoutResult({
      payoutId: event.payoutId,
      result: event.result,
      utr: event.utr,
      reason: event.reason,
      providerRef: event.providerRef,
      actorType: 'WEBHOOK',
      actorId: 'gateway',
    });
  } catch (err) {
    // Already in a final, different state: nothing more to do, and a 4xx would just make the gateway retry forever.
    if (err instanceof ApiError && err.statusCode === 409) return res.json({ success: true, data: { ignored: true, note: err.message } });
    throw err;
  }
  res.json({ success: true, data: { ok: true } });
});
