import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/ApiError';
import { Painter } from '../models/Painter';
import { RewardClaim, type IRewardClaim } from '../models/RewardClaim';
import { audit } from './audit.service';
import { gateway, GatewayRejectedError, type GatewayPayout } from './payoutGateway.service';

/**
 * AUTOMATIC PAYOUT ENGINE
 *
 * A claim is created QUEUED. dispatchPayout() hands it to the payment gateway (RazorpayX) which sends the
 * money straight to the painter's UPI ID. The result comes back by webhook (and, as a safety net, by a
 * status check from the background job). Nobody has to press anything.
 *
 *  - "reference id"  = `<claimId>-<payoutSeq>`; it is also the gateway idempotency key, so retrying the
 *    same attempt can never pay twice. A new attempt (painter fixed the UPI ID) gets a new payoutSeq.
 *  - gateway said NO            -> FAILED (painter / admin can retry)
 *  - gateway state UNKNOWN      -> stays QUEUED, retried with back-off; after MAX_ATTEMPTS flagged needsReview
 */

const MAX_AUTO_ATTEMPTS = 8;
const LEASE_MS = 90_000; // while one worker hands over a claim, nobody else may
const MAX_PAINTER_RETRIES = 5; // how many times a painter may re-submit a failed claim

const refOf = (c: Pick<IRewardClaim, 'id' | 'payoutSeq'>): string => `${c.id}-${c.payoutSeq}`;
const backoffMs = (attempts: number): number => Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 30 * 60_000);

/** "RC-2026-000001-2" -> { claimId, payoutSeq } (null for anything else). */
export function parseRef(ref: string): { claimId: string; payoutSeq: number } | null {
  const m = /^(RC-\d{4}-\d{6})-(\d+)$/.exec(String(ref || ''));
  return m ? { claimId: m[1], payoutSeq: Number(m[2]) } : null;
}

// ------------------------------------------------------------------ hand over to the gateway

/** Safe to call any number of times and from several servers at once: an atomic lease lets only one proceed. */
export async function dispatchPayout(claimId: string): Promise<IRewardClaim | null> {
  const now = new Date();
  const claim = await RewardClaim.findOneAndUpdate(
    { id: claimId, status: 'QUEUED', $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
    { $set: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  ).lean<IRewardClaim | null>();
  if (!claim) return RewardClaim.findOne({ id: claimId }).lean<IRewardClaim | null>(); // someone else has it, or it is not QUEUED

  try {
    const painter = await Painter.findOne({ id: claim.painterId }).lean();
    if (!painter) throw new GatewayRejectedError('Painter record not found.');

    // 1. contact (once per painter)
    let contactId = painter.gatewayContactId;
    if (!contactId) {
      contactId = await gateway.createContact({ name: claim.painterName, mobile: claim.mobile, referenceId: claim.painterId });
      await Painter.updateOne({ id: painter.id }, { $set: { gatewayContactId: contactId } });
    }

    // 2. fund account = this UPI ID (reused while the UPI ID is unchanged)
    let fundAccountId = claim.fundAccountId;
    if (!fundAccountId && painter.fundAccountId && painter.fundAccountUpi === claim.upiId) fundAccountId = painter.fundAccountId;
    if (!fundAccountId) {
      fundAccountId = await gateway.createFundAccount({ contactId, upiId: claim.upiId });
      await Painter.updateOne({ id: painter.id }, { $set: { fundAccountId, fundAccountUpi: claim.upiId } });
    }
    if (fundAccountId !== claim.fundAccountId) await RewardClaim.updateOne({ id: claim.id }, { $set: { fundAccountId } });

    // 3. the payout itself
    const payout = await gateway.createPayout({
      fundAccountId,
      amountPaise: claim.amountPaise,
      referenceId: refOf(claim),
      narration: 'ACME Paints reward',
    });
    await applyGatewayResult({ claimId: claim.id, payoutSeq: claim.payoutSeq, payout, actorType: 'SYSTEM', actorId: 'payout-engine' });
  } catch (err) {
    if (err instanceof GatewayRejectedError) {
      logger.warn('Payout rejected by gateway', { claimId: claim.id, reason: err.message });
      await applyGatewayResult({
        claimId: claim.id,
        payoutSeq: claim.payoutSeq,
        payout: { id: '', result: 'FAILED', utr: null, failureReason: err.message },
        actorType: 'SYSTEM',
        actorId: 'payout-engine',
      });
    } else {
      // Unknown state: do NOT fail it - the money may or may not have left. Retry later with the same idempotency key.
      const needsReview = claim.attempts >= MAX_AUTO_ATTEMPTS;
      logger.error('Payout hand-over failed - will retry', { err, claimId: claim.id, attempts: claim.attempts, needsReview });
      await RewardClaim.updateOne(
        { id: claim.id, status: 'QUEUED', payoutSeq: claim.payoutSeq },
        { $set: { nextAttemptAt: new Date(Date.now() + backoffMs(claim.attempts)), needsReview } }
      );
    }
  }
  return RewardClaim.findOne({ id: claimId }).lean<IRewardClaim | null>();
}

// ------------------------------------------------------------------ apply a result (gateway reply, webhook, status check)

interface ApplyInput {
  claimId: string;
  /** Results for an older attempt (a late webhook for a payout that was already retried) are ignored. */
  payoutSeq: number;
  payout: GatewayPayout;
  actorType: 'SYSTEM' | 'WEBHOOK' | 'ADMIN';
  actorId: string;
}

/** Idempotent: replaying the same result changes nothing. Returns true when something changed. */
export async function applyGatewayResult(input: ApplyInput): Promise<boolean> {
  const { claimId, payoutSeq, payout, actorType, actorId } = input;
  const base = { id: claimId, payoutSeq };
  let changed = false;

  if (payout.result === 'PAID') {
    const r = await RewardClaim.updateOne(
      { ...base, status: { $in: ['QUEUED', 'PROCESSING'] } },
      { $set: { status: 'PAID', utr: payout.utr, gatewayPayoutId: payout.id || null, paidAt: new Date(), failureReason: null, nextAttemptAt: null, needsReview: false } }
    );
    changed = r.modifiedCount > 0;
    if (changed) await audit({ action: 'REWARD_PAID', actorType, actorId, refType: 'REWARD_CLAIM', refId: claimId, meta: { utr: payout.utr, gatewayPayoutId: payout.id } });
  } else if (payout.result === 'PROCESSING') {
    const r = await RewardClaim.updateOne(
      { ...base, status: 'QUEUED' },
      { $set: { status: 'PROCESSING', gatewayPayoutId: payout.id || null, nextAttemptAt: null, needsReview: false } }
    );
    changed = r.modifiedCount > 0;
  } else {
    // FAILED / REVERSED. A reversal can arrive AFTER "processed" (the bank sent the money back), so PAID is allowed here too.
    const r = await RewardClaim.updateOne(
      { ...base, status: { $in: ['QUEUED', 'PROCESSING', 'PAID'] } },
      { $set: { status: 'FAILED', failureReason: payout.failureReason ?? 'Payout failed', nextAttemptAt: null, needsReview: false } }
    );
    changed = r.modifiedCount > 0;
    if (changed) await audit({ action: 'REWARD_PAYOUT_FAILED', actorType, actorId, refType: 'REWARD_CLAIM', refId: claimId, meta: { reason: payout.failureReason } });
  }
  return changed;
}

// ------------------------------------------------------------------ retries

/** Painter fixed the UPI ID (or just wants to try again) after a FAILED payout. */
export async function retryFailedClaim(input: { claimId: string; mobile: string; upiId: string; ip: string | null }): Promise<IRewardClaim> {
  const { claimId, mobile, upiId, ip } = input;
  const claim = await RewardClaim.findOne({ id: claimId, mobile }).lean<IRewardClaim | null>();
  if (!claim) throw ApiError.notFound('Reward not found.');
  if (claim.status !== 'FAILED') throw ApiError.conflict(claim.status === 'PAID' ? 'This reward has already been paid.' : 'This reward is already being processed.');
  if (claim.payoutSeq >= MAX_PAINTER_RETRIES) throw ApiError.badRequest('Too many attempts. Please contact support.');

  const moved = await RewardClaim.findOneAndUpdate(
    { id: claimId, mobile, status: 'FAILED', payoutSeq: claim.payoutSeq },
    {
      $set: { status: 'QUEUED', upiId, fundAccountId: null, gatewayPayoutId: null, utr: null, failureReason: null, nextAttemptAt: null, attempts: 0, needsReview: false },
      $inc: { payoutSeq: 1 },
    },
    { new: true }
  ).lean<IRewardClaim | null>();
  if (!moved) throw ApiError.conflict('This reward is already being processed.');

  await Painter.updateOne({ id: claim.painterId }, { $set: { upiId } });
  await audit({ action: 'REWARD_PAYOUT_RETRIED', actorType: 'PAINTER', actorId: claim.painterId, refType: 'REWARD_CLAIM', refId: claimId, meta: { upiId, payoutSeq: moved.payoutSeq }, ip });
  return (await dispatchPayout(claimId)) ?? moved;
}

/** Admin "Retry": a FAILED claim (same UPI ID) or a QUEUED one the engine gave up on. */
export async function adminRetryClaim(claimId: string, adminId: string): Promise<IRewardClaim> {
  const claim = await RewardClaim.findOne({ id: claimId }).lean<IRewardClaim | null>();
  if (!claim) throw ApiError.notFound('Claim not found.');

  if (claim.status === 'FAILED') {
    await RewardClaim.updateOne(
      { id: claimId, status: 'FAILED', payoutSeq: claim.payoutSeq },
      { $set: { status: 'QUEUED', fundAccountId: null, gatewayPayoutId: null, utr: null, failureReason: null, nextAttemptAt: null, attempts: 0, needsReview: false }, $inc: { payoutSeq: 1 } }
    );
  } else if (claim.status === 'QUEUED') {
    await RewardClaim.updateOne({ id: claimId, status: 'QUEUED' }, { $set: { nextAttemptAt: null, attempts: 0, needsReview: false } });
  } else {
    throw ApiError.conflict(`Claim is ${claim.status}; nothing to retry.`);
  }
  await audit({ action: 'REWARD_PAYOUT_RETRIED', actorType: 'ADMIN', actorId: adminId, refType: 'REWARD_CLAIM', refId: claimId });
  return (await dispatchPayout(claimId)) as IRewardClaim;
}

/** Asks the gateway what really happened to a PROCESSING payout (used when a webhook was missed). */
export async function syncClaim(claimId: string, actorType: 'ADMIN' | 'SYSTEM', actorId: string): Promise<IRewardClaim> {
  const claim = await RewardClaim.findOne({ id: claimId }).lean<IRewardClaim | null>();
  if (!claim) throw ApiError.notFound('Claim not found.');
  if (claim.status !== 'PROCESSING' || !claim.gatewayPayoutId) throw ApiError.conflict('Only a payout that is being processed can be checked.');
  const payout = await gateway.fetchPayout(claim.gatewayPayoutId);
  await applyGatewayResult({ claimId, payoutSeq: claim.payoutSeq, payout, actorType, actorId });
  return (await RewardClaim.findOne({ id: claimId }).lean<IRewardClaim | null>()) as IRewardClaim;
}

// ------------------------------------------------------------------ background job

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    // 1. claims that were accepted but never reached the gateway (server restart, gateway timeout ...)
    const due = await RewardClaim.find({ status: 'QUEUED', needsReview: false, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] })
      .select('id')
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();
    for (const c of due) await dispatchPayout(c.id);

    // 2. payouts the gateway has had for a while without telling us the result (missed webhook)
    const stale = await RewardClaim.find({ status: 'PROCESSING', gatewayPayoutId: { $ne: null }, updatedAt: { $lt: new Date(now.getTime() - 15 * 60_000) } })
      .select('id')
      .limit(20)
      .lean();
    for (const c of stale) {
      try {
        await syncClaim(c.id, 'SYSTEM', 'payout-job');
        // Still PROCESSING? touch it so we look again in 15 minutes instead of every tick.
        await RewardClaim.updateOne({ id: c.id, status: 'PROCESSING' }, { $set: { updatedAt: new Date() } }, { timestamps: false });
      } catch (err) {
        logger.warn('Payout status check failed', { claimId: c.id, err: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error('Payout job tick failed', { err });
  } finally {
    running = false;
  }
}

export function startPayoutJob(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  logger.info(`Reward payout job started (provider: ${gateway.name}, max reward Rs ${env.PAYOUT_MAX_PAISE / 100}).`);
}
export function stopPayoutJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
