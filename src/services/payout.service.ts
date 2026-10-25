import https from 'https';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { runInTransaction } from '../utils/txn';
import { nextSeq } from '../models/Counter';
import { nextPayoutId } from '../utils/ids';
import { Painter } from '../models/Painter';
import { Payout, type IPayout } from '../models/Payout';
import { audit } from './audit.service';
import { raiseFlagOnce } from './fraud.service';
import { notifyAdmins } from './notify.service';
import { getBalancePaise, painterAccount, postTransaction, SYS_PAYOUT_CLEARING } from './ledger.service';

const rupees = (paise: number): string => `₹${paise / 100}`;

// ---------------------------------------------------------------- providers

export interface PayoutPayee {
  painterId: string;
  painterName: string;
  painterMobile: string;
}

export interface PayoutProvider {
  name: string;
  /** Hand the payout to the money-moving side. Safe to call again for the same payout (idempotent). */
  initiate(payout: IPayout, payee: PayoutPayee): Promise<{ providerRef: string | null; status: 'PENDING' | 'PROCESSING' }>;
}

/** The gateway clearly refused this payout (e.g. invalid UPI ID). Money was NOT sent -> safe to refund. */
export class GatewayRejectedError extends Error {}
/** We do not know if the gateway got it (timeout / 5xx). Never refund blindly - retry or check the dashboard. */
export class GatewayUnknownError extends Error {}

/** Admin pays out of band (bank app / UPI) and then marks the payout paid in the dashboard. */
class ManualProvider implements PayoutProvider {
  name = 'manual';
  async initiate(): Promise<{ providerRef: string | null; status: 'PENDING' }> {
    return { providerRef: null, status: 'PENDING' };
  }
}

interface HttpResult {
  status: number;
  json: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function postJson(path: string, body: unknown, headers: Record<string, string>): Promise<HttpResult> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.razorpay.com',
        path: `/v1${path}`,
        method: 'POST',
        timeout: 15000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // non-JSON body
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * RazorpayX payouts: money leaves YOUR RazorpayX account and lands directly in the painter's UPI ID.
 *   1. Contact (once per painter)  2. Fund account (the UPI ID)  3. Payout (mode UPI)
 * The final result arrives on the webhook (payout.processed / payout.failed / payout.reversed).
 *
 * NOTE: written against Razorpay's documented API but NOT tested against a live account from here -
 * test it in Razorpay TEST mode first (see README).
 */
class RazorpayProvider implements PayoutProvider {
  name = 'razorpay';

  private authHeader(): string {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_ACCOUNT_NUMBER) {
      throw ApiError.internal('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_ACCOUNT_NUMBER).');
    }
    return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
  }

  private async call(path: string, body: unknown, extra: Record<string, string> = {}): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    let res: HttpResult;
    try {
      res = await postJson(path, body, { Authorization: this.authHeader(), ...extra });
    } catch (err) {
      throw new GatewayUnknownError(`Could not reach the payout gateway (${(err as Error).message}).`);
    }
    if (res.status >= 500 || res.status === 429 || res.status === 0) throw new GatewayUnknownError(`Payout gateway error (${res.status}).`);
    if (res.status >= 400) {
      const desc = (res.json?.error as { description?: string } | undefined)?.description;
      throw new GatewayRejectedError(desc || `Payout gateway rejected the request (${res.status}).`);
    }
    return res.json;
  }

  async initiate(payout: IPayout, payee: PayoutPayee): Promise<{ providerRef: string | null; status: 'PROCESSING' }> {
    let contactId = (await Painter.findOne({ id: payee.painterId }).select('gatewayContactId').lean())?.gatewayContactId ?? null;
    if (!contactId) {
      const c = await this.call('/contacts', { name: payee.painterName, contact: payee.painterMobile, type: 'customer', reference_id: payee.painterId });
      contactId = String(c.id);
      await Painter.updateOne({ id: payee.painterId }, { $set: { gatewayContactId: contactId } });
    }
    const fa = await this.call('/fund_accounts', { contact_id: contactId, account_type: 'vpa', vpa: { address: payout.upiId } });
    const p = await this.call(
      '/payouts',
      {
        account_number: env.RAZORPAY_ACCOUNT_NUMBER,
        fund_account_id: String(fa.id),
        amount: payout.amountPaise, // paise
        currency: 'INR',
        mode: 'UPI',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: payout.id, // comes back on the webhook so we can match it
        narration: 'ACME Paints reward',
      },
      { 'X-Payout-Idempotency': payout.id } // a retry can never pay twice
    );
    return { providerRef: String(p.id), status: 'PROCESSING' };
  }
}

export const provider: PayoutProvider = env.PAYOUT_PROVIDER === 'razorpay' ? new RazorpayProvider() : new ManualProvider();

// ---------------------------------------------------------------- request

const UPI_RE = /^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/;
export function isValidUpi(upi: string): boolean {
  return UPI_RE.test(upi);
}

interface PayerPainter {
  id: string;
  name: string;
  mobile: string;
  status: string;
  upiId: string;
  upiUpdatedAt: Date | null;
}

interface WithdrawInput {
  painter: PayerPainter;
  amountPaise: number;
  idempotencyKey: string;
  ip: string | null;
  /** Automatic payout of a just-claimed reward: skips the minimum amount and the UPI-change cooldown. */
  auto?: boolean;
}

export async function requestWithdrawal(input: WithdrawInput): Promise<{ payout: IPayout; replay: boolean }> {
  const { painter, amountPaise, idempotencyKey, ip, auto = false } = input;

  // Retried / double-tapped request -> hand back the SAME payout, never a second one.
  const prior = await Payout.findOne({ painterId: painter.id, idempotencyKey }).lean();
  if (prior) return { payout: prior as IPayout, replay: true };

  if (painter.status !== 'ACTIVE') throw ApiError.forbidden('Withdrawals are paused while your account is under review.');
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw ApiError.badRequest('Enter a valid amount.');
  if (!auto && amountPaise < env.PAYOUT_MIN_PAISE) throw ApiError.badRequest(`Minimum withdrawal is Rs ${env.PAYOUT_MIN_PAISE / 100}.`);
  if (amountPaise > env.PAYOUT_MAX_PAISE) throw ApiError.badRequest(`Maximum per withdrawal is Rs ${env.PAYOUT_MAX_PAISE / 100}.`);
  if (!painter.upiId || !isValidUpi(painter.upiId)) throw ApiError.badRequest('Add a valid UPI ID before withdrawing.');
  if (!auto && painter.upiUpdatedAt && env.UPI_CHANGE_COOLDOWN_HOURS > 0) {
    const unlockAt = painter.upiUpdatedAt.getTime() + env.UPI_CHANGE_COOLDOWN_HOURS * 3_600_000;
    if (unlockAt > Date.now()) {
      throw ApiError.badRequest(`For your safety, withdrawals are paused for ${env.UPI_CHANGE_COOLDOWN_HOURS} hours after changing your UPI ID.`);
    }
  }

  let created: IPayout;
  try {
    created = await runInTransaction(async (session) => {
      // Touch the painter first: two simultaneous withdrawals now conflict here, so the
      // balance check below can never be satisfied twice by the same money.
      await Painter.updateOne({ id: painter.id }, { $inc: { ledgerSeq: 1 } }, { session });
      const balance = await getBalancePaise(painter.id, session);
      if (balance < amountPaise) throw ApiError.badRequest('Insufficient wallet balance.');

      const seq = await nextSeq('payout');
      const [doc] = await Payout.create(
        [{ id: nextPayoutId(seq), painterId: painter.id, amountPaise, upiId: painter.upiId, status: 'PENDING', provider: provider.name, idempotencyKey }],
        { session }
      );
      await postTransaction({
        key: `payout:${doc.id}`,
        type: 'PAYOUT',
        refType: 'PAYOUT',
        refId: doc.id,
        note: `Payout to ${painter.upiId}`,
        lines: [
          { account: painterAccount(painter.id), painterId: painter.id, direction: 'DEBIT', amountPaise },
          { account: SYS_PAYOUT_CLEARING, direction: 'CREDIT', amountPaise },
        ],
        session,
      });
      await audit({ action: 'PAYOUT_REQUESTED', actorType: 'PAINTER', actorId: painter.id, refType: 'PAYOUT', refId: doc.id, meta: { amountPaise, upiId: painter.upiId, auto }, ip }, session);
      return doc.toJSON() as unknown as IPayout;
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const again = await Payout.findOne({ painterId: painter.id, idempotencyKey }).lean();
      if (again) return { payout: again as IPayout, replay: true };
    }
    throw err;
  }

  created = await handOverToProvider(created, { painterId: painter.id, painterName: painter.name, painterMobile: painter.mobile });

  // Several accounts cashing out to one UPI ID is a classic farming pattern -> flag for review (does not block).
  const sharing = await Painter.countDocuments({ upiId: painter.upiId, id: { $ne: painter.id } });
  if (sharing > 0) {
    await raiseFlagOnce({ type: 'SHARED_UPI', painterId: painter.id, details: `UPI ${painter.upiId} is also saved on ${sharing} other painter account(s).` });
  }

  return { payout: created, replay: false };
}

/**
 * After the money is safely reserved in the ledger: give the payout to the provider.
 *  - gateway clearly refused  -> mark FAILED, money returns to the wallet
 *  - gateway state unknown    -> leave PENDING (retry from the dashboard); the money stays reserved, nothing is lost
 */
async function handOverToProvider(payout: IPayout, payee: PayoutPayee): Promise<IPayout> {
  try {
    const r = await provider.initiate(payout, payee);
    if (r.status === 'PROCESSING' || r.providerRef) {
      await Payout.updateOne({ id: payout.id, status: 'PENDING' }, { $set: { status: r.status, providerRef: r.providerRef } });
      return { ...payout, status: r.status, providerRef: r.providerRef };
    }
    if (provider.name === 'manual') {
      await notifyAdmins({
        type: 'PAYOUT_PENDING',
        title: `Pay ${rupees(payout.amountPaise)} to ${payee.painterName}`,
        body: `UPI ${payout.upiId} · payout ${payout.id}. Send the money, then press "Mark paid".`,
        refType: 'PAYOUT',
        refId: payout.id,
      });
    }
    return payout;
  } catch (err) {
    if (err instanceof GatewayRejectedError) {
      logger.warn('Payout rejected by gateway', { payoutId: payout.id, reason: err.message });
      return applyPayoutResult({ payoutId: payout.id, result: 'FAILED', reason: err.message, actorType: 'WEBHOOK', actorId: 'gateway-sync' });
    }
    logger.error('Payout hand-over failed - left PENDING', { err, payoutId: payout.id });
    await notifyAdmins({
      type: 'PAYOUT_FAILED',
      title: `Payout ${payout.id} needs attention`,
      body: `${payee.painterName} (${payout.upiId}) ${rupees(payout.amountPaise)} could not be sent to the gateway yet. Use "Retry" in Payouts.`,
      refType: 'PAYOUT',
      refId: payout.id,
    });
    return payout;
  }
}

/** Dashboard "Retry" for a payout that is still PENDING (idempotent at the gateway, so it can never pay twice). */
export async function retryPayout(payoutId: string): Promise<IPayout> {
  const payout = await Payout.findOne({ id: payoutId }).lean();
  if (!payout) throw ApiError.notFound('Payout not found.');
  if (payout.status !== 'PENDING') throw ApiError.conflict(`Payout is ${payout.status}, nothing to retry.`);
  if (provider.name === 'manual') throw ApiError.badRequest('Payouts are in manual mode - pay from your bank/UPI app and press "Mark paid".');
  const painter = await Painter.findOne({ id: payout.painterId }).select('id name mobile').lean();
  if (!painter) throw ApiError.notFound('Painter not found.');
  return handOverToProvider(payout as IPayout, { painterId: painter.id, painterName: painter.name, painterMobile: painter.mobile });
}

/**
 * Sends the money for ONE reward straight to the painter's UPI ID (reward credited to the wallet and
 * immediately paid out). Never throws: if anything goes wrong the reward simply stays safe in the wallet.
 */
export async function autoPayoutForReward(input: {
  painter: PayerPainter;
  amountPaise: number;
  rewardCodeId: string;
  ip: string | null;
}): Promise<{ payout: IPayout | null; error: string | null }> {
  if (!env.PAYOUT_AUTO_ON_CLAIM) return { payout: null, error: null };
  try {
    const { payout } = await requestWithdrawal({
      painter: input.painter,
      amountPaise: input.amountPaise,
      idempotencyKey: `claim-${input.rewardCodeId}`,
      ip: input.ip,
      auto: true,
    });
    return { payout, error: null };
  } catch (err) {
    logger.error('autoPayoutForReward failed - reward stays in wallet', { err, rewardCodeId: input.rewardCodeId });
    return { payout: null, error: err instanceof Error ? err.message : 'Payout could not be started.' };
  }
}

// ---------------------------------------------------------------- settlement (admin or gateway webhook)

export type PayoutResult = 'SUCCESS' | 'FAILED' | 'REVERSED';

interface ApplyInput {
  payoutId: string;
  result: PayoutResult;
  utr?: string | null;
  reason?: string | null;
  providerRef?: string | null;
  actorType: 'ADMIN' | 'WEBHOOK';
  actorId: string;
}

/**
 * Moves a payout to SUCCESS / FAILED / REVERSED. Idempotent: replaying the same
 * result (a gateway retrying its webhook) changes nothing. FAILED and REVERSED
 * both put the money BACK into the painter's wallet through a ledger entry.
 */
export async function applyPayoutResult(input: ApplyInput): Promise<IPayout> {
  const { payoutId, result, utr, reason, providerRef, actorType, actorId } = input;

  const outcome = await runInTransaction(async (session) => {
    const payout = await Payout.findOne({ id: payoutId }).session(session ?? null);
    if (!payout) throw ApiError.notFound('Payout not found.');
    const from = payout.status;

    if (result === 'SUCCESS') {
      if (from === 'SUCCESS') return { doc: payout.toJSON() as unknown as IPayout, changed: false };
      if (from !== 'PENDING' && from !== 'PROCESSING') throw ApiError.conflict(`Payout is already ${from}.`);
      payout.status = 'SUCCESS';
      payout.utr = utr ?? payout.utr;
      payout.paidAt = new Date();
      if (providerRef) payout.providerRef = providerRef;
    } else if (result === 'FAILED') {
      if (from === 'FAILED' || from === 'REVERSED') return { doc: payout.toJSON() as unknown as IPayout, changed: false };
      if (from === 'SUCCESS') throw ApiError.conflict('Payout already succeeded - it can only be reversed, not failed.');
      payout.status = 'FAILED';
      payout.failureReason = reason ?? 'Payout failed';
      if (providerRef) payout.providerRef = providerRef;
    } else {
      if (from === 'REVERSED' || from === 'FAILED') return { doc: payout.toJSON() as unknown as IPayout, changed: false };
      payout.status = 'REVERSED';
      payout.failureReason = reason ?? 'Payout reversed by bank';
    }
    await payout.save({ session });

    if (result === 'FAILED' || result === 'REVERSED') {
      await Painter.updateOne({ id: payout.painterId }, { $inc: { ledgerSeq: 1 } }, { session });
      await postTransaction({
        key: `payout-reversal:${payout.id}`,
        type: 'PAYOUT_REVERSAL',
        refType: 'PAYOUT',
        refId: payout.id,
        note: `Refund of ${payout.id} (${result})`,
        lines: [
          { account: SYS_PAYOUT_CLEARING, direction: 'DEBIT', amountPaise: payout.amountPaise },
          { account: painterAccount(payout.painterId), painterId: payout.painterId, direction: 'CREDIT', amountPaise: payout.amountPaise },
        ],
        session,
      });
    }

    await audit({ action: `PAYOUT_${result}`, actorType, actorId, refType: 'PAYOUT', refId: payout.id, meta: { from, utr: utr ?? null, reason: reason ?? null } }, session);
    return { doc: payout.toJSON() as unknown as IPayout, changed: true };
  });

  if (outcome.changed) {
    const p = outcome.doc;
    const who = (await Painter.findOne({ id: p.painterId }).select('name').lean())?.name ?? p.painterId;
    if (result === 'SUCCESS') {
      await notifyAdmins({ type: 'PAYOUT_SUCCESS', title: `${rupees(p.amountPaise)} paid to ${who}`, body: `UPI ${p.upiId} · UTR ${p.utr ?? '—'} · ${p.id}`, refType: 'PAYOUT', refId: p.id });
    } else {
      await notifyAdmins({ type: 'PAYOUT_FAILED', title: `Payout ${p.id} ${result.toLowerCase()}`, body: `${who} · ${p.upiId} · ${rupees(p.amountPaise)} · ${p.failureReason ?? ''} (returned to the painter's wallet)`, refType: 'PAYOUT', refId: p.id });
    }
  }
  return outcome.doc;
}

// ---------------------------------------------------------------- webhook payload

export interface NormalisedPayoutEvent {
  payoutId: string;
  result: PayoutResult | 'PROCESSING';
  utr: string | null;
  reason: string | null;
  providerRef: string | null;
}

const EVENT_MAP: Record<string, NormalisedPayoutEvent['result']> = {
  'payout.processed': 'SUCCESS',
  'payout.failed': 'FAILED',
  'payout.rejected': 'FAILED',
  'payout.reversed': 'REVERSED',
  'payout.processing': 'PROCESSING',
  'payout.initiated': 'PROCESSING',
  'payout.pending': 'PROCESSING',
  'payout.queued': 'PROCESSING',
};

/**
 * Understands both:
 *  - Razorpay's shape: { event: 'payout.processed', payload: { payout: { entity: { id, reference_id, utr, failure_reason, ... } } } }
 *  - a simple generic shape for curl testing: { event, payoutId, utr, reason, providerRef }
 */
export function parsePayoutWebhook(body: unknown): NormalisedPayoutEvent | null {
  const b = (body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const result = EVENT_MAP[String(b.event ?? '')];
  if (!result) return null;

  const entity = b.payload?.payout?.entity as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (entity) {
    const payoutId = typeof entity.reference_id === 'string' ? entity.reference_id : '';
    if (!payoutId) return null;
    return {
      payoutId,
      result,
      utr: typeof entity.utr === 'string' ? entity.utr : null,
      reason: typeof entity.failure_reason === 'string' ? entity.failure_reason : typeof entity.status_details?.description === 'string' ? entity.status_details.description : null,
      providerRef: typeof entity.id === 'string' ? entity.id : null,
    };
  }

  const payoutId = typeof b.payoutId === 'string' ? b.payoutId : '';
  if (!payoutId) return null;
  return {
    payoutId,
    result,
    utr: typeof b.utr === 'string' ? b.utr : null,
    reason: typeof b.reason === 'string' ? b.reason : null,
    providerRef: typeof b.providerRef === 'string' ? b.providerRef : null,
  };
}
