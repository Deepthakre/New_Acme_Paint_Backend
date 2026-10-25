import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { nextSeq } from '../models/Counter';
import { nextCampaignId } from '../utils/ids';
import { parsePagination, paginate } from '../utils/pagination';
import { Campaign, type ICampaignRule } from '../models/Campaign';
import { FraudFlag } from '../models/FraudFlag';
import { Payout } from '../models/Payout';
import { Painter } from '../models/Painter';
import { RewardCode } from '../models/RewardCode';
import { WalletLedger } from '../models/WalletLedger';
import { audit } from '../services/audit.service';
import { getSummariesFor } from '../services/ledger.service';
import { applyPayoutResult, retryPayout } from '../services/payout.service';
import { AdminNotification } from '../models/AdminNotification';
import { resolveFraudFlag } from '../services/reward.service';
import { reconcile } from '../services/reconcile.service';

const toPaise = (rupees: number): number => Math.round(rupees * 100);
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

interface RuleInput { product?: string; size?: string; amountRupees: number }
const toRules = (rules: RuleInput[]): ICampaignRule[] =>
  rules.map((r) => ({ product: r.product ?? '', size: r.size ?? '', amountPaise: toPaise(r.amountRupees) }));

// ------------------------------------------------------------ campaigns

export const listCampaigns = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const result = await paginate(Campaign.find({}), Campaign.countDocuments({}), { ...params, sort: '-_id' });
  res.json({ success: true, ...result });
});

export const createCampaign = asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as { name: string; startsAt: Date; endsAt?: Date | null; budgetRupees: number; rules: RuleInput[] };
  const campaign = await Campaign.create({
    id: nextCampaignId(await nextSeq('campaign')),
    name: b.name,
    status: 'ACTIVE',
    startsAt: b.startsAt,
    endsAt: b.endsAt ?? null,
    budgetPaise: toPaise(b.budgetRupees),
    spentPaise: 0,
    rules: toRules(b.rules),
  });
  await audit({ action: 'CAMPAIGN_CREATED', actorType: 'ADMIN', actorId: req.user!.id, refType: 'CAMPAIGN', refId: campaign.id, meta: { budgetPaise: campaign.budgetPaise } });
  res.status(201).json({ success: true, data: campaign.toJSON() });
});

/** Uses atomic operators only - never load-modify-save - so it can't clobber spentPaise while claims are being made. */
export const updateCampaign = asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as { name?: string; status?: 'ACTIVE' | 'PAUSED' | 'ENDED'; endsAt?: Date | null; addBudgetRupees?: number; rules?: RuleInput[] };
  const set: Record<string, unknown> = {};
  const inc: Record<string, number> = {};
  if (b.name !== undefined) set.name = b.name;
  if (b.endsAt !== undefined) set.endsAt = b.endsAt;
  if (b.rules) set.rules = toRules(b.rules);
  if (b.addBudgetRupees) inc.budgetPaise = toPaise(b.addBudgetRupees);
  if (b.status) set.status = b.status;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(inc).length) update.$inc = inc;
  if (!Object.keys(update).length) throw ApiError.badRequest('Nothing to update.');

  // Resuming/adding budget must not leave a campaign ACTIVE with no money, nor keep it EXHAUSTED when money was added.
  const current = await Campaign.findOne({ id: req.params.id }).lean();
  if (!current) throw ApiError.notFound('Campaign not found.');
  if (current.status === 'ENDED' && b.status && b.status !== 'ENDED') throw ApiError.badRequest('An ended campaign cannot be restarted - create a new one.');

  let updated = await Campaign.findOneAndUpdate({ id: req.params.id }, update, { new: true });
  if (!updated) throw ApiError.notFound('Campaign not found.');

  const smallest = updated.rules.length ? Math.min(...updated.rules.map((r) => r.amountPaise)) : 0;
  const remaining = updated.budgetPaise - updated.spentPaise;
  if (updated.status === 'EXHAUSTED' && remaining >= smallest) {
    updated = (await Campaign.findOneAndUpdate({ id: updated.id, status: 'EXHAUSTED' }, { $set: { status: 'ACTIVE' } }, { new: true })) ?? updated;
  } else if (updated.status === 'ACTIVE' && remaining < smallest) {
    updated = (await Campaign.findOneAndUpdate({ id: updated.id, status: 'ACTIVE' }, { $set: { status: 'EXHAUSTED' } }, { new: true })) ?? updated;
  }

  await audit({ action: 'CAMPAIGN_UPDATED', actorType: 'ADMIN', actorId: req.user!.id, refType: 'CAMPAIGN', refId: updated.id, meta: { ...b } });
  res.json({ success: true, data: updated.toJSON() });
});

// ------------------------------------------------------------ fraud flags

export const listFraudFlags = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const status = str(req.query.status) || 'OPEN';
  const filter: Record<string, unknown> = status === 'ALL' ? {} : { status };
  const result = await paginate(FraudFlag.find(filter), FraudFlag.countDocuments(filter), { ...params, sort: '-_id' });

  const ids = [...new Set(result.data.map((f) => f.painterId).filter((x): x is string => Boolean(x)))];
  const painters = ids.length ? await Painter.find({ id: { $in: ids } }).select('id name mobile status').lean() : [];
  const byId = new Map(painters.map((p) => [p.id, p]));
  const data = result.data.map((f) => ({ ...f, painterName: f.painterId ? byId.get(f.painterId)?.name ?? null : null, painterMobile: f.painterId ? byId.get(f.painterId)?.mobile ?? null : null }));
  res.json({ success: true, data, pagination: result.pagination });
});

export const resolveFlag = asyncHandler(async (req: Request, res: Response) => {
  await resolveFraudFlag({ flagId: req.params.id, action: req.body.action, note: req.body.note, adminId: req.user!.id });
  res.json({ success: true, data: { resolved: true } });
});

// ------------------------------------------------------------ payouts

export const listPayoutsAdmin = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const status = str(req.query.status);
  const filter: Record<string, unknown> = status && status !== 'ALL' ? { status } : {};
  const result = await paginate(Payout.find(filter), Payout.countDocuments(filter), { ...params, sort: '-_id' });
  const ids = [...new Set(result.data.map((p) => p.painterId))];
  const painters = ids.length ? await Painter.find({ id: { $in: ids } }).select('id name mobile').lean() : [];
  const byId = new Map(painters.map((p) => [p.id, p]));
  const data = result.data.map((p) => ({ ...p, painterName: byId.get(p.painterId)?.name ?? null, painterMobile: byId.get(p.painterId)?.mobile ?? null }));
  res.json({ success: true, data, pagination: result.pagination });
});

export const markPayoutPaid = asyncHandler(async (req: Request, res: Response) => {
  const payout = await applyPayoutResult({ payoutId: req.params.id, result: 'SUCCESS', utr: req.body.utr, actorType: 'ADMIN', actorId: req.user!.id });
  res.json({ success: true, data: payout });
});

export const markPayoutFailed = asyncHandler(async (req: Request, res: Response) => {
  const payout = await applyPayoutResult({ payoutId: req.params.id, result: 'FAILED', reason: req.body.reason, actorType: 'ADMIN', actorId: req.user!.id });
  res.json({ success: true, data: payout });
});

// ------------------------------------------------------------ painters / redemptions

export const listPaintersAdmin = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = {};
  const search = str(req.query.search).slice(0, 60);
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ id: rx }, { name: rx }, { mobile: rx }, { city: rx }, { upiId: rx }];
  }
  const result = await paginate(
    Painter.find(filter).select('-tokenVersion -ledgerSeq -failedRedeemWindowStart'),
    Painter.countDocuments(filter),
    { ...params, sort: '-_id' }
  );
  const ids = result.data.map((p) => p.id);
  const [summaries, claimRows] = await Promise.all([
    getSummariesFor(ids),
    ids.length
      ? RewardCode.aggregate<{ _id: string; claims: number; last: Date }>([
          { $match: { painterId: { $in: ids }, status: 'REDEEMED' } },
          { $group: { _id: '$painterId', claims: { $sum: 1 }, last: { $max: '$redeemedAt' } } },
        ])
      : Promise.resolve([]),
  ]);
  const claims = new Map(claimRows.map((c) => [c._id, c]));
  const data = result.data.map((p) => ({
    ...p,
    ...summaries.get(p.id),
    claims: claims.get(p.id)?.claims ?? 0,
    lastClaimedAt: claims.get(p.id)?.last ?? null,
  }));
  res.json({ success: true, data, pagination: result.pagination });
});

export const setPainterStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = req.body.status as 'ACTIVE' | 'ON_HOLD' | 'BLOCKED';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { $set: { status } };
  if (status === 'BLOCKED') update.$inc = { tokenVersion: 1 }; // kills every live session immediately
  const painter = await Painter.findOneAndUpdate({ id: req.params.id }, update, { new: true }).lean();
  if (!painter) throw ApiError.notFound('Painter not found.');
  await audit({ action: 'PAINTER_STATUS_SET', actorType: 'ADMIN', actorId: req.user!.id, refType: 'PAINTER', refId: painter.id, meta: { status } });
  res.json({ success: true, data: { id: painter.id, status: painter.status } });
});

/** Every claimed reward (credited or on hold), newest first - feeds the Excel report. */
export const listRedemptions = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { status: { $in: ['REDEEMED', 'HELD'] } };
  const result = await paginate(
    RewardCode.find(filter).select('productQr batchId status painterId redeemedAt amountPaise campaignId heldReason'),
    RewardCode.countDocuments(filter),
    { ...params, sort: '-redeemedAt' }
  );
  const ids = [...new Set(result.data.map((r) => r.painterId).filter((x): x is string => Boolean(x)))];
  const painters = ids.length ? await Painter.find({ id: { $in: ids } }).select('id name mobile upiId').lean() : [];
  const byId = new Map(painters.map((p) => [p.id, p]));
  const data = result.data.map((r) => ({
    ...r,
    painterName: r.painterId ? byId.get(r.painterId)?.name ?? null : null,
    painterMobile: r.painterId ? byId.get(r.painterId)?.mobile ?? null : null,
    painterUpi: r.painterId ? byId.get(r.painterId)?.upiId ?? null : null,
  }));
  res.json({ success: true, data, pagination: result.pagination });
});

// ------------------------------------------------------------ dashboard numbers + reconciliation

export const rewardStats = asyncHandler(async (_req: Request, res: Response) => {
  const dayStart = new Date(Math.floor((Date.now() + 5.5 * 3_600_000) / 86_400_000) * 86_400_000 - 5.5 * 3_600_000);
  const [codes, painters, openFlags, payoutAgg, scansToday, campaigns, paid, liability] = await Promise.all([
    RewardCode.aggregate<{ _id: string; count: number }>([{ $match: { isCurrent: true } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Painter.countDocuments({}),
    FraudFlag.countDocuments({ status: 'OPEN' }),
    Payout.aggregate<{ _id: string; count: number; total: number }>([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
    RewardCode.countDocuments({ status: { $in: ['REDEEMED', 'HELD'] }, redeemedAt: { $gte: dayStart } }),
    Campaign.find({ status: 'ACTIVE' }).select('budgetPaise spentPaise').lean(),
    WalletLedger.aggregate<{ _id: null; total: number }>([{ $match: { type: 'REWARD', direction: 'CREDIT' } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
    WalletLedger.aggregate<{ _id: string; total: number }>([{ $match: { account: { $regex: '^PAINTER:' } } }, { $group: { _id: '$direction', total: { $sum: '$amountPaise' } } }]),
  ]);
  const codeBy: Record<string, number> = { ACTIVE: 0, HELD: 0, REDEEMED: 0, VOID: 0 };
  for (const c of codes) codeBy[c._id] = c.count;
  const payBy = (s: string) => payoutAgg.find((p) => p._id === s);
  const liab = (liability.find((l) => l._id === 'CREDIT')?.total ?? 0) - (liability.find((l) => l._id === 'DEBIT')?.total ?? 0);
  res.json({
    success: true,
    data: {
      codes: codeBy,
      painters,
      openFlags,
      scansToday,
      rewardsCreditedPaise: paid[0]?.total ?? 0,
      walletLiabilityPaise: liab,
      payouts: {
        pending: { count: (payBy('PENDING')?.count ?? 0) + (payBy('PROCESSING')?.count ?? 0), totalPaise: (payBy('PENDING')?.total ?? 0) + (payBy('PROCESSING')?.total ?? 0) },
        success: { count: payBy('SUCCESS')?.count ?? 0, totalPaise: payBy('SUCCESS')?.total ?? 0 },
        failed: { count: (payBy('FAILED')?.count ?? 0) + (payBy('REVERSED')?.count ?? 0), totalPaise: (payBy('FAILED')?.total ?? 0) + (payBy('REVERSED')?.total ?? 0) },
      },
      activeCampaignBudgetPaise: campaigns.reduce((a, c) => a + c.budgetPaise, 0),
      activeCampaignSpentPaise: campaigns.reduce((a, c) => a + c.spentPaise, 0),
    },
  });
});

export const runReconcile = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await reconcile() });
});

// ------------------------------------------------------------ payout retry + notifications

export const retryPayoutAdmin = asyncHandler(async (req: Request, res: Response) => {
  const payout = await retryPayout(req.params.id);
  res.json({ success: true, data: payout });
});

/** Newest first. The dashboard polls this (and `unread`) to show "this painter just took money". */
export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = str(req.query.unread) === '1' ? { read: false } : {};
  const result = await paginate(AdminNotification.find(filter), AdminNotification.countDocuments(filter), { ...params, sort: '-_id' });
  const unread = await AdminNotification.countDocuments({ read: false });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: result.data, pagination: result.pagination, unread });
});

export const markNotificationsRead = asyncHandler(async (_req: Request, res: Response) => {
  await AdminNotification.updateMany({ read: false }, { $set: { read: true } });
  res.json({ success: true, data: { ok: true } });
});
