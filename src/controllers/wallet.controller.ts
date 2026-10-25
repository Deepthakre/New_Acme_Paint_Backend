import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { WalletLedger } from '../models/WalletLedger';
import { Payout } from '../models/Payout';
import { parsePagination, paginate } from '../utils/pagination';
import { getWalletSummary, painterAccount } from '../services/ledger.service';
import { requestWithdrawal } from '../services/payout.service';

/** GET /wallet - balance is computed from the ledger, never read from a stored field. */
export const getWallet = asyncHandler(async (req: Request, res: Response) => {
  const summary = await getWalletSummary(req.painter!.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: { ...summary, minWithdrawPaise: env.PAYOUT_MIN_PAISE, maxWithdrawPaise: env.PAYOUT_MAX_PAISE, upiId: req.painter!.upiId },
  });
});

export const listMyLedger = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { account: painterAccount(req.painter!.id) };
  const result = await paginate(WalletLedger.find(filter).select('-txnId -idempotencyKey -account -painterId'), WalletLedger.countDocuments(filter), { ...params, sort: '-_id' });
  res.json({ success: true, ...result });
});

export const listMyPayouts = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { painterId: req.painter!.id };
  const result = await paginate(Payout.find(filter).select('-idempotencyKey -painterId'), Payout.countDocuments(filter), { ...params, sort: '-_id' });
  res.json({ success: true, ...result });
});

/** POST /wallet/withdraw - requires an Idempotency-Key header so a retry/double-tap can never pay twice. */
export const withdraw = asyncHandler(async (req: Request, res: Response) => {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw ApiError.badRequest('A valid Idempotency-Key header is required.');

  const { payout, replay } = await requestWithdrawal({
    painter: req.painter!,
    amountPaise: req.body.amountPaise,
    idempotencyKey: key,
    ip: req.ip ?? null,
  });
  const { idempotencyKey: _k, ...safe } = payout as typeof payout & { idempotencyKey?: string };
  res.status(replay ? 200 : 201).json({ success: true, data: { payout: safe, replay } });
});
