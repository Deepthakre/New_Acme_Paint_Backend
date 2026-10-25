import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { RewardCode } from '../models/RewardCode';
import { generateCodesForBatch, redeemRewardCode, reissueCode } from '../services/reward.service';

function deviceIdFrom(req: Request): string | null {
  const raw = req.headers['x-device-id'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

/** POST /rewards/redeem - painter scans the INNER QR. */
export const redeemReward = asyncHandler(async (req: Request, res: Response) => {
  const outcome = await redeemRewardCode({
    painter: req.painter!,
    rawCode: req.body.code,
    bucketQrId: req.body.bucketQrId,
    upiId: req.body.upiId ?? null,
    ip: req.ip ?? null,
    deviceId: deviceIdFrom(req),
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ success: true, data: outcome });
});

// ---------------- admin ----------------

/** Mints inner codes for every bucket of a batch without one. Plain codes are in THIS response only. */
export const generateBatchCodes = asyncHandler(async (req: Request, res: Response) => {
  const result = await generateCodesForBatch(req.body.batchId, req.user!.id);
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ success: true, data: result });
});

export const reissueBucketCode = asyncHandler(async (req: Request, res: Response) => {
  const code = await reissueCode(req.params.productQr, req.user!.id);
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ success: true, data: code });
});

/** Per-batch counts so admin can see printed / claimed / voided at a glance (printing accountability). */
export const codeSummary = asyncHandler(async (req: Request, res: Response) => {
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId.trim() : '';
  if (!batchId) throw ApiError.badRequest('batchId is required.');
  const rows = await RewardCode.aggregate<{ _id: string; count: number }>([
    { $match: { batchId, isCurrent: true } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus: Record<string, number> = { ACTIVE: 0, HELD: 0, REDEEMED: 0, VOID: 0 };
  for (const r of rows) byStatus[r._id] = r.count;
  res.json({ success: true, data: { batchId, total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus } });
});
