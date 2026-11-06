import type { Request, Response } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { applyGatewayResult, parseRef } from '../services/rewardPayout.service';
import { mapRazorpayStatus } from '../services/payoutGateway.service';

function signatureMatches(raw: Buffer, provided: string | undefined, secret: string): boolean {
  if (!provided) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(provided.trim().toLowerCase(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/webhooks/payout - RazorpayX calls this when a payout is processed / failed / reversed.
 * The raw body is HMAC-verified (constant time) BEFORE anything is read. Re-delivered events are harmless.
 */
export const payoutWebhook = asyncHandler(async (req: Request, res: Response) => {
  if (!env.PAYOUT_WEBHOOK_SECRET) throw new ApiError(503, 'Payout webhook is not configured.');
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) throw ApiError.badRequest('Missing request body.');

  const header = req.headers['x-razorpay-signature'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!signatureMatches(raw, provided, env.PAYOUT_WEBHOOK_SECRET)) {
    logger.warn('Payout webhook rejected: bad signature', { ip: req.ip });
    throw ApiError.unauthorized('Invalid signature.');
  }

  const event = String(req.body?.event ?? '');
  const entity = req.body?.payload?.payout?.entity as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!event.startsWith('payout.') || !entity) return res.json({ success: true, data: { ignored: true } }); // acknowledge unknown events so the gateway stops retrying

  const ref = parseRef(String(entity.reference_id ?? ''));
  if (!ref) return res.json({ success: true, data: { ignored: true } }); // not one of ours

  // "payout.reversed" always means FAILED; everything else follows the payout's own status.
  const result = event === 'payout.reversed' ? 'FAILED' : mapRazorpayStatus(String(entity.status ?? ''));
  const reason =
    (typeof entity.failure_reason === 'string' && entity.failure_reason) ||
    (typeof entity.status_details?.description === 'string' && entity.status_details.description) ||
    (event === 'payout.reversed' ? 'Payout reversed by the bank' : `Payout ${entity.status ?? 'failed'}`);

  await applyGatewayResult({
    claimId: ref.claimId,
    payoutSeq: ref.payoutSeq,
    payout: { id: String(entity.id ?? ''), result, utr: typeof entity.utr === 'string' ? entity.utr : null, failureReason: result === 'FAILED' ? reason : null },
    actorType: 'WEBHOOK',
    actorId: 'razorpayx',
  });
  res.json({ success: true, data: { ok: true } });
});
