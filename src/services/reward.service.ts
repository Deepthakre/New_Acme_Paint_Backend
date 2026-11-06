import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { runInTransaction } from '../utils/txn';
import { nextSeq, reserveSeqRange } from '../models/Counter';
import { nextPainterId, nextRewardClaimId, nextRewardSerial } from '../utils/ids';
import { generateRewardCode, hashRewardCode, parseRewardCode } from '../utils/rewardCode';
import { Painter } from '../models/Painter';
import { RewardRate, normalizeSize } from '../models/RewardRate';
import { RewardBarcode, type IRewardBarcode } from '../models/RewardBarcode';
import { RewardClaim, type IRewardClaim } from '../models/RewardClaim';
import { audit } from './audit.service';
import { gateway } from './payoutGateway.service';
import { dispatchPayout } from './rewardPayout.service';

const IST_MS = 5.5 * 60 * 60 * 1000;
const startOfDayIST = (): Date => new Date(Math.floor((Date.now() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);
const rs = (paise: number): string => `₹${paise % 100 === 0 ? paise / 100 : (paise / 100).toFixed(2)}`;

/** One message for "unknown code / bad checksum": never tells a guesser how close they were. */
const INVALID_CODE = 'This reward code is not valid. Please scan the QR sticker from inside the paint bucket again.';

// ==================================================================== admin: rates

export async function listRates() {
  return RewardRate.find({}).sort({ size: 1 }).lean();
}

export async function upsertRate(input: { size: string; amountPaise: number; active: boolean }, adminId: string) {
  const size = normalizeSize(input.size);
  if (!size) throw ApiError.badRequest('Enter the bucket size, e.g. 20L.');
  if (input.amountPaise > env.PAYOUT_MAX_PAISE) throw ApiError.badRequest(`A reward cannot be more than ₹${env.PAYOUT_MAX_PAISE / 100}.`);
  const rate = await RewardRate.findOneAndUpdate(
    { size },
    { $set: { amountPaise: input.amountPaise, active: input.active } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  await audit({ action: 'REWARD_RATE_SET', actorType: 'ADMIN', actorId: adminId, refType: 'REWARD_RATE', refId: size, meta: { amountPaise: input.amountPaise, active: input.active } });
  return rate;
}

// ==================================================================== admin: barcodes (stickers)

export interface PrintableBarcode {
  serial: string;
  size: string;
  /** The secret code that goes inside the QR. Shown ONCE - only its hash is stored. */
  code: string;
}

/** Makes `count` brand-new stickers for one bucket size. */
export async function generateBarcodes(input: { size: string; count: number; label: string; adminId: string }): Promise<{ generated: number; label: string; size: string; amountPaise: number; codes: PrintableBarcode[] }> {
  const size = normalizeSize(input.size);
  const rate = await RewardRate.findOne({ size, active: true }).lean();
  if (!rate) throw ApiError.badRequest(`Set an active reward amount for size ${size} first (Reward rates tab).`);

  const label = input.label || `${size}-${new Date().toISOString().slice(0, 10)}`;
  const { start } = await reserveSeqRange('rewardBarcode', input.count);

  const codes: PrintableBarcode[] = [];
  const docs: Pick<IRewardBarcode, 'serial' | 'codeHash' | 'size' | 'batchLabel' | 'createdBy'>[] = [];
  for (let i = 0; i < input.count; i++) {
    const code = generateRewardCode();
    const serial = nextRewardSerial(start + i);
    codes.push({ serial, size, code });
    docs.push({ serial, codeHash: hashRewardCode(code), size, batchLabel: label, createdBy: input.adminId });
  }
  await RewardBarcode.insertMany(docs, { ordered: true });
  await audit({ action: 'REWARD_BARCODES_GENERATED', actorType: 'ADMIN', actorId: input.adminId, refType: 'BARCODE_RUN', refId: label, meta: { size, count: input.count, firstSerial: codes[0].serial, lastSerial: codes[codes.length - 1].serial } });
  return { generated: input.count, label, size, amountPaise: rate.amountPaise, codes };
}

export async function barcodeSummary() {
  const rows = await RewardBarcode.aggregate<{ _id: { batchLabel: string; size: string; status: string }; count: number; first: string; last: string; createdAt: Date }>([
    { $group: { _id: { batchLabel: '$batchLabel', size: '$size', status: '$status' }, count: { $sum: 1 }, first: { $min: '$serial' }, last: { $max: '$serial' }, createdAt: { $min: '$createdAt' } } },
    { $sort: { createdAt: -1 } },
    { $limit: 300 },
  ]);
  const map = new Map<string, { batchLabel: string; size: string; firstSerial: string; lastSerial: string; createdAt: Date; ACTIVE: number; CLAIMED: number; VOID: number }>();
  for (const r of rows) {
    const key = `${r._id.batchLabel}|${r._id.size}`;
    const cur = map.get(key) ?? { batchLabel: r._id.batchLabel, size: r._id.size, firstSerial: r.first, lastSerial: r.last, createdAt: r.createdAt, ACTIVE: 0, CLAIMED: 0, VOID: 0 };
    cur[r._id.status as 'ACTIVE' | 'CLAIMED' | 'VOID'] += r.count;
    if (r.first < cur.firstSerial) cur.firstSerial = r.first;
    if (r.last > cur.lastSerial) cur.lastSerial = r.last;
    map.set(key, cur);
  }
  return [...map.values()].map((b) => ({ ...b, total: b.ACTIVE + b.CLAIMED + b.VOID }));
}

/** Cancels an unused sticker (lost / damaged / wrong sheet). A claimed one cannot be voided. */
export async function voidBarcode(serial: string, reason: string, adminId: string) {
  const b = await RewardBarcode.findOneAndUpdate({ serial, status: 'ACTIVE' }, { $set: { status: 'VOID', voidReason: reason } }, { new: true }).lean();
  if (!b) {
    const exists = await RewardBarcode.exists({ serial });
    throw exists ? ApiError.conflict('Only an unused sticker can be cancelled.') : ApiError.notFound('Sticker not found.');
  }
  await audit({ action: 'REWARD_BARCODE_VOIDED', actorType: 'ADMIN', actorId: adminId, refType: 'REWARD_BARCODE', refId: serial, meta: { reason } });
  return b;
}

// ==================================================================== painter: check + claim

async function findUsableBarcode(rawCode: string): Promise<IRewardBarcode> {
  const code = parseRewardCode(rawCode); // format + checksum: rejects random guesses without touching the database
  if (!code) throw ApiError.badRequest(INVALID_CODE);
  const barcode = await RewardBarcode.findOne({ codeHash: hashRewardCode(code) }).lean<IRewardBarcode | null>();
  if (!barcode) throw ApiError.badRequest(INVALID_CODE);
  if (barcode.status === 'CLAIMED') throw ApiError.conflict('This reward has already been claimed.');
  if (barcode.status === 'VOID') throw ApiError.badRequest('This reward sticker is no longer valid.');
  return barcode;
}

async function rateFor(size: string) {
  const rate = await RewardRate.findOne({ size, active: true }).lean();
  if (!rate) throw ApiError.badRequest('No reward is running for this bucket size right now. Please contact support.');
  return rate;
}

/** Shown to the painter right after OTP, before they type anything: "this sticker is worth ₹X". */
export async function checkCode(rawCode: string): Promise<{ size: string; amountPaise: number }> {
  const barcode = await findUsableBarcode(rawCode);
  const rate = await rateFor(barcode.size);
  return { size: barcode.size, amountPaise: rate.amountPaise };
}

export interface ClaimInput {
  mobile: string; // already OTP-verified
  rawCode: string;
  name: string;
  city: string;
  upiId: string;
  ip: string | null;
  deviceId: string | null;
}

export interface ClaimOutcome {
  claimId: string;
  status: IRewardClaim['status'];
  amountPaise: number;
  size: string;
  upiId: string;
  failureReason: string | null;
  message: string;
}

export function messageFor(c: Pick<IRewardClaim, 'status' | 'amountPaise' | 'upiId' | 'failureReason'>): string {
  switch (c.status) {
    case 'PAID':
      return `${rs(c.amountPaise)} has been sent to your UPI ID ${c.upiId}.`;
    case 'FAILED':
      return `We could not send ${rs(c.amountPaise)} to ${c.upiId}${c.failureReason ? ` (${c.failureReason})` : ''}. Please check your UPI ID and try again.`;
    default:
      return `${rs(c.amountPaise)} is being sent to your UPI ID ${c.upiId}. It will reach you in a few minutes - no further action is needed.`;
  }
}

const outcomeOf = (c: IRewardClaim): ClaimOutcome => ({
  claimId: c.id,
  status: c.status,
  amountPaise: c.amountPaise,
  size: c.size,
  upiId: c.upiId,
  failureReason: c.failureReason,
  message: messageFor(c),
});

export async function claimReward(input: ClaimInput): Promise<ClaimOutcome> {
  const { mobile, rawCode, name, city, upiId, ip, deviceId } = input;

  const existing = await Painter.findOne({ mobile }).select('id status').lean();
  if (existing?.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked. Please contact support.');

  const today = await RewardClaim.countDocuments({ mobile, createdAt: { $gte: startOfDayIST() } });
  if (today >= env.REWARD_MAX_CLAIMS_PER_DAY) throw ApiError.tooMany(`You can claim at most ${env.REWARD_MAX_CLAIMS_PER_DAY} rewards per day. Please try again tomorrow.`);

  const barcode = await findUsableBarcode(rawCode);
  const rate = await rateFor(barcode.size);

  // Painter record: created on the first claim, details refreshed on every claim.
  let painter = await Painter.findOne({ mobile }).lean();
  if (!painter) {
    for (let attempt = 0; attempt < 3 && !painter; attempt++) {
      try {
        painter = (await Painter.create({ id: nextPainterId(await nextSeq('painter')), name, mobile, city, upiId })).toObject();
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
        painter = await Painter.findOne({ mobile }).lean(); // another tab registered the same mobile a moment ago
      }
    }
  }
  if (!painter) throw ApiError.internal('Could not save your details. Please try again.');
  if (painter.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked. Please contact support.');
  await Painter.updateOne({ id: painter.id }, { $set: { name, city, upiId, lastClaimAt: new Date() } });

  // ATOMIC: the sticker flips ACTIVE -> CLAIMED and the claim record is created, or neither happens.
  // Two people scanning the same sticker at the same instant: exactly one gets through.
  const claimId = nextRewardClaimId(await nextSeq('rewardClaim'));
  const claim = await runInTransaction(async (session) => {
    const taken = await RewardBarcode.findOneAndUpdate(
      { _id: barcode._id, status: 'ACTIVE' },
      { $set: { status: 'CLAIMED', claimedAt: new Date(), claimedByMobile: mobile } },
      { new: true, session }
    );
    if (!taken) throw ApiError.conflict('This reward has already been claimed.');
    try {
      const [doc] = await RewardClaim.create(
        [
          {
            id: claimId,
            barcodeId: barcode._id,
            barcodeSerial: barcode.serial,
            size: barcode.size,
            amountPaise: rate.amountPaise, // amount frozen at claim time
            painterId: painter!.id,
            painterName: name,
            mobile,
            city,
            upiId,
            status: 'QUEUED',
            payoutSeq: 1,
            provider: gateway.name,
            ip,
            deviceId,
          },
        ],
        { session }
      );
      await audit({ action: 'REWARD_CLAIMED', actorType: 'PAINTER', actorId: painter!.id, refType: 'REWARD_CLAIM', refId: claimId, meta: { serial: barcode.serial, size: barcode.size, amountPaise: rate.amountPaise, upiId }, ip }, session);
      return doc.toObject() as IRewardClaim;
    } catch (err) {
      // Dev-only fallback (no transaction): put the sticker back so it is not lost.
      if (!session) await RewardBarcode.updateOne({ _id: barcode._id }, { $set: { status: 'ACTIVE', claimedAt: null, claimedByMobile: null } });
      if ((err as { code?: number }).code === 11000) throw ApiError.conflict('This reward has already been claimed.');
      throw err;
    }
  });

  // Money: handed to the gateway right now. If that cannot finish, the background job completes it.
  const after = (await dispatchPayout(claim.id)) ?? claim;
  return outcomeOf(after);
}

export async function listClaimsForMobile(mobile: string, page: number, limit: number) {
  const filter = { mobile };
  const [data, totalItems] = await Promise.all([
    RewardClaim.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-barcodeId -ip -deviceId -attempts -nextAttemptAt -needsReview -fundAccountId -gatewayPayoutId -provider').lean<IRewardClaim[]>(),
    RewardClaim.countDocuments(filter),
  ]);
  const paid = await RewardClaim.aggregate<{ total: number }>([{ $match: { mobile, status: 'PAID' } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]);
  return {
    data: data.map((c) => ({ ...c, message: messageFor(c) })),
    pagination: { page, limit, totalItems, totalPages: Math.max(Math.ceil(totalItems / limit), 1), hasNextPage: page * limit < totalItems },
    totalPaidPaise: paid[0]?.total ?? 0,
  };
}
