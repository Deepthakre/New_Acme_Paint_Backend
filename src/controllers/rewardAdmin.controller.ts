import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Painter } from '../models/Painter';
import { RewardBarcode } from '../models/RewardBarcode';
import { RewardClaim } from '../models/RewardClaim';
import { parsePagination, paginate } from '../utils/pagination';
import { audit } from '../services/audit.service';
import { barcodeSummary, generateBarcodes, listRates, upsertRate, voidBarcode } from '../services/reward.service';
import { adminRetryClaim, syncClaim } from '../services/rewardPayout.service';
import { gateway } from '../services/payoutGateway.service';

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const IST_MS = 5.5 * 3_600_000;
const startOfDayIST = (): Date => new Date(Math.floor((Date.now() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);

// ------------------------------------------------------------ rates
export const getRates = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listRates() });
});
export const setRate = asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as { size: string; amountRupees: number; active: boolean }; // amountRupees already converted to paise by the schema
  res.json({ success: true, data: await upsertRate({ size: b.size, amountPaise: b.amountRupees, active: b.active }, req.user!.id) });
});

// ------------------------------------------------------------ barcodes
/** Plain codes are in THIS response only. */
export const generate = asyncHandler(async (req: Request, res: Response) => {
  const result = await generateBarcodes({ size: req.body.size, count: req.body.count, label: req.body.label, adminId: req.user!.id });
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ success: true, data: result });
});
export const summary = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await barcodeSummary() });
});
export const voidSticker = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await voidBarcode(req.body.serial, req.body.reason, req.user!.id) });
});

// ------------------------------------------------------------ claims / payouts
export const listClaims = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as { page: number; limit: number; status: string; search: string };
  const filter: Record<string, unknown> = {};
  if (q.status !== 'ALL') filter.status = q.status;
  if (q.search) {
    const rx = { $regex: escapeRegex(q.search), $options: 'i' };
    filter.$or = [{ id: rx }, { painterName: rx }, { mobile: rx }, { upiId: rx }, { barcodeSerial: rx }, { city: rx }];
  }
  const params = parsePagination({ page: q.page, limit: q.limit, sort: '-createdAt' });
  const result = await paginate(RewardClaim.find(filter).select('-barcodeId -ip -deviceId'), RewardClaim.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

export const retryClaim = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await adminRetryClaim(req.params.id, req.user!.id) });
});
export const checkClaim = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await syncClaim(req.params.id, 'ADMIN', req.user!.id) });
});

// ------------------------------------------------------------ painters
export const listPainters = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as { page: number; limit: number; search: string };
  const filter: Record<string, unknown> = {};
  if (q.search) {
    const rx = { $regex: escapeRegex(q.search), $options: 'i' };
    filter.$or = [{ id: rx }, { name: rx }, { mobile: rx }, { city: rx }, { upiId: rx }];
  }
  const params = parsePagination({ page: q.page, limit: q.limit, sort: '-createdAt' });
  const result = await paginate(Painter.find(filter).select('-gatewayContactId -fundAccountId -fundAccountUpi'), Painter.countDocuments(filter), params);

  const ids = result.data.map((p) => p.id);
  const rows = ids.length
    ? await RewardClaim.aggregate<{ _id: { p: string; s: string }; count: number; total: number }>([
        { $match: { painterId: { $in: ids } } },
        { $group: { _id: { p: '$painterId', s: '$status' }, count: { $sum: 1 }, total: { $sum: '$amountPaise' } } },
      ])
    : [];
  const stat = new Map<string, { claims: number; paidPaise: number }>();
  for (const r of rows) {
    const cur = stat.get(r._id.p) ?? { claims: 0, paidPaise: 0 };
    cur.claims += r.count;
    if (r._id.s === 'PAID') cur.paidPaise += r.total;
    stat.set(r._id.p, cur);
  }
  const data = result.data.map((p) => ({ ...p, claims: stat.get(p.id)?.claims ?? 0, paidPaise: stat.get(p.id)?.paidPaise ?? 0 }));
  res.json({ success: true, data, pagination: result.pagination });
});

export const setPainterStatus = asyncHandler(async (req: Request, res: Response) => {
  const painter = await Painter.findOneAndUpdate({ id: req.params.id }, { $set: { status: req.body.status } }, { new: true }).lean();
  if (!painter) throw ApiError.notFound('Painter not found.');
  await audit({ action: 'PAINTER_STATUS_SET', actorType: 'ADMIN', actorId: req.user!.id, refType: 'PAINTER', refId: painter.id, meta: { status: req.body.status } });
  res.json({ success: true, data: { id: painter.id, status: painter.status } });
});

// ------------------------------------------------------------ dashboard numbers
export const stats = asyncHandler(async (_req: Request, res: Response) => {
  const [stickers, claims, painters, today] = await Promise.all([
    RewardBarcode.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    RewardClaim.aggregate<{ _id: string; count: number; total: number }>([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
    Painter.countDocuments({}),
    RewardClaim.aggregate<{ count: number; total: number }>([{ $match: { createdAt: { $gte: startOfDayIST() } } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
  ]);
  const st = { ACTIVE: 0, CLAIMED: 0, VOID: 0 } as Record<string, number>;
  for (const s of stickers) st[s._id] = s.count;
  const by = (s: string) => claims.find((c) => c._id === s);
  const needsReview = await RewardClaim.countDocuments({ status: 'QUEUED', needsReview: true });
  res.json({
    success: true,
    data: {
      provider: gateway.name,
      stickers: st,
      painters,
      claimsToday: today[0]?.count ?? 0,
      claimedTodayPaise: today[0]?.total ?? 0,
      paid: { count: by('PAID')?.count ?? 0, totalPaise: by('PAID')?.total ?? 0 },
      inProgress: {
        count: (by('QUEUED')?.count ?? 0) + (by('PROCESSING')?.count ?? 0),
        totalPaise: (by('QUEUED')?.total ?? 0) + (by('PROCESSING')?.total ?? 0),
      },
      failed: { count: by('FAILED')?.count ?? 0, totalPaise: by('FAILED')?.total ?? 0 },
      needsReview,
    },
  });
});
