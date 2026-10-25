import type { ClientSession } from 'mongoose';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { runInTransaction } from '../utils/txn';
import { generateRewardCode, hashRewardCode, parseRewardCode } from '../utils/rewardCode';
import { Painter } from '../models/Painter';
import { Product } from '../models/Product';
import { Batch } from '../models/Batch';
import { RewardCode, type IRewardCode } from '../models/RewardCode';
import { Campaign, type ICampaign } from '../models/Campaign';
import { FraudFlag, type FraudFlagType } from '../models/FraudFlag';
import { logger } from '../utils/logger';
import { nowStr } from './invoice.service';
import { audit } from './audit.service';
import { notifyAdmins } from './notify.service';
import { autoPayoutForReward, isValidUpi } from './payout.service';
import { raiseFlag } from './fraud.service';
import { getBalancePaise, painterAccount, postTransaction, SYS_REWARD_EXPENSE } from './ledger.service';

const IST_MS = 5.5 * 60 * 60 * 1000;
function startOfDayIST(): Date {
  return new Date(Math.floor((Date.now() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);
}
function startOfMonthIST(): Date {
  const t = new Date(Date.now() + IST_MS);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) - IST_MS);
}

/** Counts a wrong/forged code against the painter; too many in a window -> temporary block + a flag for review. */
export async function registerFailedRedeem(painterId: string): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  const p = await Painter.findOne({ id: painterId }).select('failedRedeemWindowStart').lean();
  const fresh = !p?.failedRedeemWindowStart || p.failedRedeemWindowStart < windowStart;
  const updated = fresh
    ? await Painter.findOneAndUpdate({ id: painterId }, { $set: { failedRedeems: 1, failedRedeemWindowStart: now } }, { new: true }).lean()
    : await Painter.findOneAndUpdate({ id: painterId }, { $inc: { failedRedeems: 1 } }, { new: true }).lean();
  if (updated && updated.failedRedeems >= env.REDEEM_MAX_FAILED_ATTEMPTS) {
    await Painter.updateOne(
      { id: painterId },
      { $set: { redeemBlockedUntil: new Date(now.getTime() + env.REDEEM_BLOCK_MINUTES * 60 * 1000), failedRedeems: 0, failedRedeemWindowStart: null } }
    );
    await raiseFlag({
      type: 'EXCESS_INVALID_CODES',
      painterId,
      details: `${updated.failedRedeems} invalid reward codes within 15 minutes. Redeeming blocked for ${env.REDEEM_BLOCK_MINUTES} minutes.`,
    });
  }
}

interface Pick {
  campaign: ICampaign;
  amountPaise: number;
}

/** First ACTIVE, in-date campaign with budget left whose rules cover this product/size. Exact product+size beats size-only beats product-only beats catch-all. */
async function pickCampaign(product: string, size: string): Promise<Pick | null> {
  const now = new Date();
  const campaigns = await Campaign.find({
    status: 'ACTIVE',
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  })
    .sort({ createdAt: 1 })
    .lean();
  for (const c of campaigns) {
    const rule =
      c.rules.find((r) => r.product === product && r.size === size) ||
      c.rules.find((r) => !r.product && r.size === size) ||
      c.rules.find((r) => r.product === product && !r.size) ||
      c.rules.find((r) => !r.product && !r.size);
    if (rule && c.budgetPaise - c.spentPaise >= rule.amountPaise) return { campaign: c as ICampaign, amountPaise: rule.amountPaise };
  }
  return null;
}

/** Atomically reserves budget. The conditional $expr is the real guard - two simultaneous claims can never overspend the cap. */
async function reserveBudget(campaignId: string, amountPaise: number, session?: ClientSession): Promise<boolean> {
  const updated = await Campaign.findOneAndUpdate(
    { id: campaignId, status: 'ACTIVE', $expr: { $lte: [{ $add: ['$spentPaise', amountPaise] }, '$budgetPaise'] } },
    { $inc: { spentPaise: amountPaise } },
    { new: true, session }
  );
  if (!updated) return false;
  const smallest = updated.rules.length ? Math.min(...updated.rules.map((r) => r.amountPaise)) : 0;
  if (updated.budgetPaise - updated.spentPaise < smallest) {
    // Budget exhausted -> campaign auto-pauses.
    await Campaign.updateOne({ id: campaignId, status: 'ACTIVE' }, { $set: { status: 'EXHAUSTED' } }, { session });
  }
  return true;
}

async function releaseBudget(campaignId: string | null, amountPaise: number | null, session?: ClientSession): Promise<void> {
  if (!campaignId || !amountPaise) return;
  await Campaign.updateOne({ id: campaignId }, { $inc: { spentPaise: -amountPaise } }, { session });
}

export interface RedeemInput {
  painter: { id: string; name: string; mobile: string; status: string; upiId: string; upiUpdatedAt: Date | null; redeemBlockedUntil: Date | null };
  rawCode: string;
  /** The "QR ID" printed on the OUTER label of the bucket, e.g. PRD-2026-000108. Must belong to the same bucket as the inner code. */
  bucketQrId: string;
  /** Where the reward is paid. Falls back to the painter's saved UPI ID. */
  upiId?: string | null;
  ip: string | null;
  deviceId: string | null;
}
export interface RedeemOutcome {
  status: 'CREDITED' | 'ON_HOLD';
  amountPaise: number;
  balancePaise: number;
  productName: string;
  size: string;
  message: string;
  payout: { id: string; status: string; upiId: string; amountPaise: number } | null;
}

export async function redeemRewardCode(input: RedeemInput): Promise<RedeemOutcome> {
  const { painter, rawCode, ip, deviceId } = input;
  const bucketQrId = String(input.bucketQrId || '').toUpperCase().replace(/\s+/g, '');
  const WRONG = 'The reward code or the bucket ID is not correct. Please check both and try again.';

  if (painter.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked. Please contact support.');
  if (painter.redeemBlockedUntil && painter.redeemBlockedUntil.getTime() > Date.now()) {
    throw ApiError.tooMany('Too many wrong codes. Redeeming is temporarily blocked - please try again later.');
  }

  // 1. Format + checksum - rejects random guesses WITHOUT a database hit.
  const code = parseRewardCode(rawCode);
  if (!code || !bucketQrId) {
    await registerFailedRedeem(painter.id);
    throw ApiError.badRequest(WRONG);
  }

  // 2. Lookup by HASH only. The inner code AND the outer-label bucket ID must point to the SAME bucket.
  //    Unknown code, wrong bucket ID and bad checksum all get the same message (no oracle for guessers).
  const rc = await RewardCode.findOne({ codeHash: hashRewardCode(code), isCurrent: true }).lean();
 if (!rc) {
    await registerFailedRedeem(painter.id);
    throw ApiError.badRequest(WRONG);
  }
  if (rc.status === 'REDEEMED') throw ApiError.conflict('This reward has already been claimed.');
  if (rc.status === 'HELD') {
    throw ApiError.conflict(rc.painterId === painter.id ? 'Your claim for this bucket is under review.' : 'This reward has already been claimed.');
  }
  if (rc.status === 'VOID') throw ApiError.badRequest('This reward code is no longer valid.');

  // 3. Bucket check. By default a reward does NOT depend on the dealer scanning the sale
  //    (REWARD_REQUIRE_SOLD=false). Returned buckets are always refused.
  const product = await Product.findOne({ qr: bucketQrId }).select('qr product size status active').lean();
if (!product) {
  await registerFailedRedeem(painter.id);
  throw ApiError.badRequest(WRONG);
}
// One reward per bucket: same PRD number cannot be claimed twice.
if (await RewardCode.exists({ productQr: bucketQrId, status: { $in: ['REDEEMED', 'HELD'] } })) {
  throw ApiError.conflict('A reward for this bucket has already been claimed.');
}
  if (product.status === 'RETURNED') throw ApiError.badRequest('This reward code is no longer valid.');
  if (env.REWARD_REQUIRE_SOLD && product.status !== 'SOLD') {
    throw ApiError.badRequest('This bucket has not been recorded as sold yet. Ask the dealer to complete the sale, then scan again.');
  }

  // UPI ID: given now, or the saved one. Needed so the money can be sent straight to the painter.
  const upi = (input.upiId || painter.upiId || '').trim().toLowerCase();
  if (env.PAYOUT_AUTO_ON_CLAIM && !isValidUpi(upi)) throw ApiError.badRequest('Enter your UPI ID so we can send the reward to it.');

  // 4. Campaign + amount.
  const picked = await pickCampaign(product.product, product.size);
  if (!picked) throw ApiError.badRequest('No reward is running for this product right now.');
  const { campaign, amountPaise } = picked;

  // 5. Fraud rules -> HOLD (not reject).
  const holds: { type: FraudFlagType; details: string }[] = [];
  if (painter.status === 'ON_HOLD') holds.push({ type: 'PAINTER_ON_HOLD', details: 'Painter account is on hold pending review.' });

  const todayCount = await RewardCode.countDocuments({
    painterId: painter.id,
    status: { $in: ['REDEEMED', 'HELD'] },
    redeemedAt: { $gte: startOfDayIST() },
  });
  if (todayCount >= env.REWARD_MAX_CLAIMS_PER_DAY) {
    holds.push({ type: 'VELOCITY', details: `${todayCount + 1} buckets claimed today (limit ${env.REWARD_MAX_CLAIMS_PER_DAY}).` });
  }

  const month = await RewardCode.aggregate<{ total: number }>([
    { $match: { painterId: painter.id, status: { $in: ['REDEEMED', 'HELD'] }, redeemedAt: { $gte: startOfMonthIST() } } },
    { $group: { _id: null, total: { $sum: '$amountPaise' } } },
  ]);
  const monthTotal = month[0]?.total ?? 0;
  if (monthTotal + amountPaise > env.REWARD_MONTHLY_CAP_PAISE) {
    holds.push({ type: 'MONTHLY_CAP', details: `Monthly reward would reach Rs ${(monthTotal + amountPaise) / 100} (cap Rs ${env.REWARD_MONTHLY_CAP_PAISE / 100}).` });
  }

  if (deviceId) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const others: (string | null)[] = await RewardCode.distinct('painterId', { deviceId, redeemedAt: { $gte: since } });
    const set = new Set(others.filter((x): x is string => Boolean(x)));
    set.add(painter.id);
    if (set.size > env.DEVICE_MAX_PAINTERS) holds.push({ type: 'DEVICE_MANY_PAINTERS', details: `${set.size} different painters redeemed from one device in 30 days.` });
  }

  const hold = holds.length > 0;
  const now = new Date();

  // 6. ATOMIC claim + budget + ledger in one transaction.
  const balancePaise = await runInTransaction(async (session) => {
      let claimed;
    try {
      claimed = await RewardCode.findOneAndUpdate(
        { _id: rc._id, status: 'ACTIVE' },
        {
          $set: {
            status: hold ? 'HELD' : 'REDEEMED',
            productQr: bucketQrId,
            painterId: painter.id,
            redeemedAt: now,
            amountPaise,
            campaignId: campaign.id,
            heldReason: hold ? holds.map((h) => h.type).join(',') : null,
            deviceId,
            ip,
          },
        },
        { new: true, session }
      );
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw ApiError.conflict('A reward for this bucket has already been claimed.');
      throw e;
    }
    if (!claimed) throw ApiError.conflict('This reward has already been claimed.');

    try {
      if (!(await reserveBudget(campaign.id, amountPaise, session))) {
        throw ApiError.badRequest('This reward campaign has run out of budget.');
      }
      await Painter.updateOne({ id: painter.id }, { $inc: { ledgerSeq: 1 }, $set: { failedRedeems: 0, failedRedeemWindowStart: null } }, { session });

      // The painter opened the bucket, so it has reached the end customer: mark it SOLD
      // (no matter whether the dealer scanned the sale). Already SOLD/RETURNED units are left untouched.
      await Product.updateOne(
        { qr: bucketQrId, status: { $in: ['FACTORY', 'TRANSIT', 'DEALER'] } },
        {
          $set: { status: 'SOLD', holder: `Painter ${painter.id}` },
          $push: { log: { event: 'SOLD - reward claimed by painter (inner QR scanned)', who: painter.id, time: nowStr(), ts: Date.now() } },
        },
        { session }
      );

      if (hold) {
        for (const h of holds) {
          await raiseFlag({ type: h.type, painterId: painter.id, rewardCodeId: String(rc._id), productQr: bucketQrId, details: h.details }, session);
        }
        await audit({ action: 'REWARD_HELD', actorType: 'PAINTER', actorId: painter.id, refType: 'REWARD_CODE', refId: String(rc._id), meta: { productQr: bucketQrId, amountPaise, reasons: holds.map((h) => h.type) }, ip }, session);
        return getBalancePaise(painter.id, session);
      }

      await postTransaction({
        key: `reward:${rc._id}`,
        type: 'REWARD',
        refType: 'REWARD_CODE',
        refId: String(rc._id),
        note: `Reward for ${product.product} ${product.size} (${bucketQrId})`,
        lines: [
          { account: SYS_REWARD_EXPENSE, direction: 'DEBIT', amountPaise },
          { account: painterAccount(painter.id), painterId: painter.id, direction: 'CREDIT', amountPaise },
        ],
        session,
      });
      await audit({ action: 'REWARD_REDEEMED', actorType: 'PAINTER', actorId: painter.id, refType: 'REWARD_CODE', refId: String(rc._id), meta: { productQr: bucketQrId, amountPaise, campaignId: campaign.id }, ip }, session);
      return getBalancePaise(painter.id, session);
    } catch (err) {
      // Inside a real transaction the whole thing rolls back by itself. Only the
      // dev no-transaction fallback needs the manual undo.
      if (!session) {
        await RewardCode.updateOne({ _id: rc._id }, { $set: { status: 'ACTIVE', painterId: null, redeemedAt: null, amountPaise: null, campaignId: null, heldReason: null } });
        logger.warn('Reverted reward claim after failure (no-transaction fallback).');
      }
      throw err;
    }
  });

  // The painter's UPI ID is remembered for next time (held claims are paid to it once approved).
  if (upi && isValidUpi(upi) && upi !== painter.upiId) {
    await Painter.updateOne({ id: painter.id }, { $set: { upiId: upi, ...(painter.upiId ? { upiUpdatedAt: new Date() } : {}) } });
  }
  const payerView = { id: painter.id, name: painter.name, mobile: painter.mobile, status: painter.status, upiId: upi, upiUpdatedAt: null };

  const rs = (n: number) => `₹${n / 100}`;
  let payout: RedeemOutcome['payout'] = null;
  let message: string;
  let finalBalance = balancePaise;

  if (hold) {
    message = 'Your claim was received and is under a quick review. The reward will be sent to your UPI ID once approved.';
    await notifyAdmins({
      type: 'REWARD_HELD',
      title: `Claim on hold: ${painter.name} · ${rs(amountPaise)}`,
      body: `Bucket ${bucketQrId} · ${holds.map((h) => h.type).join(', ')}. Review it in Fraud / holds.`,
      refType: 'REWARD_CODE',
      refId: String(rc._id),
    });
  } else {
    const auto = await autoPayoutForReward({ painter: payerView, amountPaise, rewardCodeId: String(rc._id), ip });
    if (auto.payout) {
      payout = { id: auto.payout.id, status: auto.payout.status, upiId: auto.payout.upiId, amountPaise: auto.payout.amountPaise };
      finalBalance = await getBalancePaise(painter.id);
      if (auto.payout.status === 'FAILED') {
        message = `${rs(amountPaise)} could not be sent to ${upi} (${auto.payout.failureReason ?? 'rejected'}). It is safe in your wallet - check your UPI ID and try again from your wallet.`;
      } else {
        message = `${rs(amountPaise)} is on its way to your UPI ID ${upi}.`;
      }
    } else if (auto.error) {
      message = `${rs(amountPaise)} was added to your wallet. Sending it to your UPI ID did not start (${auto.error}); you can withdraw it from your wallet.`;
    } else {
      message = `${rs(amountPaise)} has been added to your wallet.`;
    }
    await notifyAdmins({
      type: 'REWARD_CLAIMED',
      title: `${painter.name} claimed ${rs(amountPaise)}`,
      body: `Mobile ${painter.mobile} · bucket ${bucketQrId} (${product.product} ${product.size}) · UPI ${upi}${payout ? ` · payout ${payout.id} (${payout.status})` : ''}`,
      refType: 'REWARD_CODE',
      refId: String(rc._id),
      meta: { painterId: painter.id, productQr: bucketQrId, amountPaise },
    });
  }

  return {
    status: hold ? 'ON_HOLD' : 'CREDITED',
    amountPaise,
    balancePaise: finalBalance,
    productName: product.product,
    size: product.size,
    message,
    payout,
  };
}

// -------- admin: resolve flags / held rewards --------

export type FlagAction = 'approve' | 'reject' | 'dismiss' | 'block_painter';

export async function resolveFraudFlag(input: { flagId: string; action: FlagAction; note?: string; adminId: string }): Promise<void> {
  const { flagId, action, note, adminId } = input;
  const flag = await FraudFlag.findOne({ id: flagId });
  if (!flag) throw ApiError.notFound('Fraud flag not found.');
  if (flag.status !== 'OPEN') throw ApiError.conflict('This flag has already been resolved.');

  const rc = flag.rewardCodeId ? await RewardCode.findById(flag.rewardCodeId).lean() : null;
  const heldReward = rc && rc.status === 'HELD' ? rc : null;

  if ((action === 'approve' || action === 'reject') && !heldReward) {
    throw ApiError.badRequest('Only flags with a held reward can be approved or rejected. Use dismiss instead.');
  }
  if (action === 'dismiss' && heldReward) {
    throw ApiError.badRequest('This flag has a held reward - approve or reject it.');
  }

  await runInTransaction(async (session) => {
    if (action === 'approve' && heldReward) {
      const moved = await RewardCode.findOneAndUpdate({ _id: heldReward._id, status: 'HELD' }, { $set: { status: 'REDEEMED' } }, { new: true, session });
      if (!moved || !heldReward.painterId || !heldReward.amountPaise) throw ApiError.conflict('Held reward is no longer pending.');
      await Painter.updateOne({ id: heldReward.painterId }, { $inc: { ledgerSeq: 1 } }, { session });
      await postTransaction({
        key: `reward:${heldReward._id}`,
        type: 'REWARD',
        refType: 'REWARD_CODE',
        refId: String(heldReward._id),
        note: `Approved held reward (${heldReward.productQr})`,
        lines: [
          { account: SYS_REWARD_EXPENSE, direction: 'DEBIT', amountPaise: heldReward.amountPaise },
          { account: painterAccount(heldReward.painterId), painterId: heldReward.painterId, direction: 'CREDIT', amountPaise: heldReward.amountPaise },
        ],
        session,
      });
    }

    if ((action === 'reject' || action === 'block_painter') && heldReward) {
      const moved = await RewardCode.findOneAndUpdate({ _id: heldReward._id, status: 'HELD' }, { $set: { status: 'VOID', heldReason: 'REJECTED_BY_ADMIN' } }, { new: true, session });
      if (moved) await releaseBudget(heldReward.campaignId, heldReward.amountPaise, session);
    }

    if (action === 'block_painter' && flag.painterId) {
      await Painter.updateOne({ id: flag.painterId }, { $set: { status: 'BLOCKED' }, $inc: { tokenVersion: 1 } }, { session });
    }

    flag.status = action === 'approve' ? 'APPROVED' : action === 'dismiss' ? 'DISMISSED' : 'REJECTED';
    flag.resolvedBy = adminId;
    flag.resolvedAt = new Date();
    flag.resolutionNote = note ?? null;
    await flag.save({ session });

    await audit({ action: `FLAG_${action.toUpperCase()}`, actorType: 'ADMIN', actorId: adminId, refType: 'FRAUD_FLAG', refId: flag.id, meta: { rewardCodeId: flag.rewardCodeId, painterId: flag.painterId, note: note ?? null } }, session);
  });

  // An approved held reward is paid straight to the painter's UPI ID, like a normal claim.
  if (action === 'approve' && heldReward?.painterId && heldReward.amountPaise) {
    const p = await Painter.findOne({ id: heldReward.painterId }).lean();
    if (p) {
      const auto = await autoPayoutForReward({
        painter: { id: p.id, name: p.name, mobile: p.mobile, status: 'ACTIVE', upiId: p.upiId, upiUpdatedAt: null },
        amountPaise: heldReward.amountPaise,
        rewardCodeId: String(heldReward._id),
        ip: null,
      });
      if (!auto.payout) logger.warn('Approved held reward stays in wallet', { reason: auto.error });
    }
  }
}

// -------- returns --------

/**
 * Called by the dealer return flow. A defective/non-resellable return cancels a
 * not-yet-claimed reward automatically. If the reward was ALREADY paid out we do
 * not claw back automatically - an admin reviews it (RETURN_AFTER_REWARD flag).
 */
export async function handleBucketReturned(productQr: string, resellable: boolean): Promise<void> {
  try {
    const rc = await RewardCode.findOne({ productQr, isCurrent: true }).lean();
    if (!rc) return;
    if (rc.status === 'REDEEMED' || rc.status === 'HELD') {
      await raiseFlag({
        type: 'RETURN_AFTER_REWARD',
        painterId: rc.painterId,
        rewardCodeId: String(rc._id),
        productQr,
        details: `Bucket ${productQr} was returned after its reward was ${rc.status === 'HELD' ? 'claimed (on hold)' : 'paid'}. Review for clawback.`,
      });
      return;
    }
    if (rc.status === 'ACTIVE' && !resellable) {
      await RewardCode.updateOne({ _id: rc._id, status: 'ACTIVE' }, { $set: { status: 'VOID', heldReason: 'BUCKET_RETURNED' } });
      await audit({ action: 'REWARD_VOIDED_ON_RETURN', actorType: 'SYSTEM', actorId: 'system', refType: 'REWARD_CODE', refId: String(rc._id), meta: { productQr } });
    }
  } catch (err) {
    // A reward-side problem must never break the dealer's return itself.
    logger.error('handleBucketReturned failed', { err, productQr });
  }
}

// -------- printing: generate / reissue --------

export interface PrintableCode {
  productQr: string;
  product: string;
  size: string;
  code: string;
}

/**
 * Mints one inner reward code per bucket of a batch that has none yet. The
 * plain codes are returned ONCE (to print) and never stored - only their hash.
 */
export async function generateStickerCodes(count: number, label: string, adminId: string): Promise<{ generated: number; label: string; codes: PrintableCode[] }> {
  const batchLabel = label || `STICKERS-${new Date().toISOString().slice(0, 10)}`;
  const out: PrintableCode[] = [];
  const docs = [];
  for (let i = 0; i < count; i++) {
    const code = generateRewardCode();
    out.push({ productQr: '', product: '', size: '', code });
    docs.push({ codeHash: hashRewardCode(code), batchId: batchLabel });
  }
  await RewardCode.insertMany(docs, { ordered: true });
  await audit({ action: 'REWARD_CODES_GENERATED', actorType: 'ADMIN', actorId: adminId, refType: 'STICKER_RUN', refId: batchLabel, meta: { generated: count } });
  return { generated: count, label: batchLabel, codes: out };
}

/** Wasted / damaged sticker: retire the old code and mint a fresh one for the same bucket. */
export async function reissueCode(productQr: string, adminId: string): Promise<PrintableCode> {
  const product = await Product.findOne({ qr: productQr }).select('qr batchId product size').lean();
  if (!product) throw ApiError.notFound('Bucket not found.');
  const current = await RewardCode.findOne({ productQr, isCurrent: true }).lean();
  if (current && (current.status === 'REDEEMED' || current.status === 'HELD')) {
    throw ApiError.conflict('This bucket reward is already claimed - it cannot be reissued.');
  }
  const code = generateRewardCode();
  await runInTransaction(async (session) => {
    if (current) await RewardCode.updateOne({ _id: current._id }, { $set: { isCurrent: false, status: 'VOID', heldReason: 'REISSUED' } }, { session });
    await RewardCode.create([{ codeHash: hashRewardCode(code), productQr, batchId: product.batchId }], { session });
    await audit({ action: 'REWARD_CODE_REISSUED', actorType: 'ADMIN', actorId: adminId, refType: 'PRODUCT', refId: productQr }, session);
  });
  return { productQr, product: product.product, size: product.size, code };
}

export type { IRewardCode };
