import crypto from 'crypto';
import type { ClientSession } from 'mongoose';
import { WalletLedger, type LedgerDirection, type LedgerEntryType } from '../models/WalletLedger';
import { Payout } from '../models/Payout';
import { ApiError } from '../utils/ApiError';

export const painterAccount = (painterId: string): string => `PAINTER:${painterId}`;
export const SYS_REWARD_EXPENSE = 'SYSTEM:REWARD_EXPENSE';
export const SYS_PAYOUT_CLEARING = 'SYSTEM:PAYOUT_CLEARING';

export interface LedgerLine {
  account: string;
  painterId?: string | null;
  direction: LedgerDirection;
  amountPaise: number;
}

interface PostInput {
  /** Idempotency key for the whole movement, e.g. `reward:<rewardCodeId>`. Posting it twice is a no-op. */
  key: string;
  type: LedgerEntryType;
  refType: string;
  refId: string;
  note?: string;
  lines: LedgerLine[];
  session?: ClientSession;
}

/**
 * Posts one balanced, idempotent movement (total CREDIT == total DEBIT).
 * Returns posted=false (and does nothing) if this key was already posted.
 */
export async function postTransaction(input: PostInput): Promise<{ posted: boolean; txnId: string }> {
  const { key, type, refType, refId, note = '', lines, session } = input;

  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.amountPaise) || l.amountPaise <= 0) throw ApiError.internal('Ledger amounts must be positive integers (paise).');
    if (l.direction === 'DEBIT') debit += l.amountPaise;
    else credit += l.amountPaise;
  }
  if (debit !== credit || lines.length < 2) throw ApiError.internal('Unbalanced ledger transaction.');

  const existing = await WalletLedger.findOne({ idempotencyKey: `${key}#0` }).session(session ?? null).lean();
  if (existing) return { posted: false, txnId: existing.txnId };

  const txnId = `TX-${crypto.randomUUID()}`;
  await WalletLedger.insertMany(
    lines.map((l, i) => ({
      txnId,
      account: l.account,
      painterId: l.painterId ?? null,
      direction: l.direction,
      amountPaise: l.amountPaise,
      type,
      refType,
      refId,
      note,
      idempotencyKey: `${key}#${i}`,
    })),
    { session, ordered: true }
  );
  return { posted: true, txnId };
}

/** Wallet balance = SUM(CREDIT) - SUM(DEBIT) over the painter's ledger lines. Never read from a stored field. */
export async function getBalancePaise(painterId: string, session?: ClientSession): Promise<number> {
  const rows = await WalletLedger.aggregate<{ _id: LedgerDirection; total: number }>([
    { $match: { account: painterAccount(painterId) } },
    { $group: { _id: '$direction', total: { $sum: '$amountPaise' } } },
  ]).session(session ?? null);
  let bal = 0;
  for (const r of rows) bal += r._id === 'CREDIT' ? r.total : -r.total;
  return bal;
}

export interface WalletSummary {
  balancePaise: number;
  totalEarnedPaise: number;
  totalWithdrawnPaise: number;
  pendingPayoutPaise: number;
}

export async function getWalletSummary(painterId: string): Promise<WalletSummary> {
  const [rows, pending] = await Promise.all([
    WalletLedger.aggregate<{ _id: { type: string; direction: LedgerDirection }; total: number }>([
      { $match: { account: painterAccount(painterId) } },
      { $group: { _id: { type: '$type', direction: '$direction' }, total: { $sum: '$amountPaise' } } },
    ]),
    Payout.aggregate<{ total: number }>([
      { $match: { painterId, status: { $in: ['PENDING', 'PROCESSING'] } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]),
  ]);
  let balance = 0;
  let earned = 0;
  let paidOut = 0;
  for (const r of rows) {
    balance += r._id.direction === 'CREDIT' ? r.total : -r.total;
    if (r._id.type === 'REWARD' && r._id.direction === 'CREDIT') earned += r.total;
    if (r._id.type === 'PAYOUT' && r._id.direction === 'DEBIT') paidOut += r.total;
    if (r._id.type === 'PAYOUT_REVERSAL' && r._id.direction === 'CREDIT') paidOut -= r.total;
  }
  return {
    balancePaise: balance,
    totalEarnedPaise: earned,
    totalWithdrawnPaise: paidOut,
    pendingPayoutPaise: pending[0]?.total ?? 0,
  };
}

/** Balances for many painters at once (admin lists) - one aggregate instead of N. */
export async function getSummariesFor(painterIds: string[]): Promise<Map<string, WalletSummary>> {
  const map = new Map<string, WalletSummary>();
  for (const id of painterIds) map.set(id, { balancePaise: 0, totalEarnedPaise: 0, totalWithdrawnPaise: 0, pendingPayoutPaise: 0 });
  if (!painterIds.length) return map;
  const rows = await WalletLedger.aggregate<{ _id: { p: string; type: string; direction: LedgerDirection }; total: number }>([
    { $match: { painterId: { $in: painterIds }, account: { $regex: '^PAINTER:' } } },
    { $group: { _id: { p: '$painterId', type: '$type', direction: '$direction' }, total: { $sum: '$amountPaise' } } },
  ]);
  for (const r of rows) {
    const s = map.get(r._id.p);
    if (!s) continue;
    s.balancePaise += r._id.direction === 'CREDIT' ? r.total : -r.total;
    if (r._id.type === 'REWARD' && r._id.direction === 'CREDIT') s.totalEarnedPaise += r.total;
    if (r._id.type === 'PAYOUT' && r._id.direction === 'DEBIT') s.totalWithdrawnPaise += r.total;
    if (r._id.type === 'PAYOUT_REVERSAL' && r._id.direction === 'CREDIT') s.totalWithdrawnPaise -= r.total;
  }
  return map;
}
