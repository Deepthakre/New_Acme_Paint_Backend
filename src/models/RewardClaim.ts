import { Schema, model, type Types } from 'mongoose';

/**
 * QUEUED     - claim accepted, money not yet handed to the payment gateway (retried automatically)
 * PROCESSING - gateway accepted the payout, waiting for the bank result (webhook / status check)
 * PAID       - money reached the painter's UPI ID
 * FAILED     - gateway / bank refused it (e.g. wrong UPI ID). The painter can fix the UPI ID and retry.
 */
export type RewardClaimStatus = 'QUEUED' | 'PROCESSING' | 'PAID' | 'FAILED';

export interface IRewardClaim {
  _id: Types.ObjectId;
  id: string; // RC-YYYY-xxxxxx
  barcodeId: Types.ObjectId;
  barcodeSerial: string;
  size: string;
  amountPaise: number;

  // Painter details as given at claim time (snapshot - the painter may change them later).
  painterId: string;
  painterName: string;
  mobile: string;
  city: string;
  upiId: string;

  status: RewardClaimStatus;
  failureReason: string | null;

  /** Bumped every time a NEW payout attempt is made (after a definitive failure). Part of the gateway idempotency key. */
  payoutSeq: number;
  provider: string;
  fundAccountId: string | null;
  gatewayPayoutId: string | null;
  utr: string | null;
  paidAt: Date | null;

  /** Hand-over bookkeeping for the automatic retry job. */
  attempts: number;
  nextAttemptAt: Date | null;
  needsReview: boolean;

  ip: string | null;
  deviceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IRewardClaim>(
  {
    id: { type: String, required: true, unique: true, index: true },
    // unique => one sticker can only ever produce ONE claim, enforced by the database itself.
    barcodeId: { type: Schema.Types.ObjectId, required: true, unique: true },
    barcodeSerial: { type: String, required: true, index: true },
    size: { type: String, required: true },
    amountPaise: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => Number.isInteger(v) && v > 0, message: 'amountPaise must be a positive integer' },
    },
    painterId: { type: String, required: true, index: true },
    painterName: { type: String, required: true },
    mobile: { type: String, required: true, index: true },
    city: { type: String, default: '' },
    upiId: { type: String, required: true },
    status: { type: String, enum: ['QUEUED', 'PROCESSING', 'PAID', 'FAILED'], default: 'QUEUED', index: true },
    failureReason: { type: String, default: null },
    payoutSeq: { type: Number, default: 1 },
    provider: { type: String, required: true },
    fundAccountId: { type: String, default: null },
    gatewayPayoutId: { type: String, default: null },
    utr: { type: String, default: null },
    paidAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    needsReview: { type: Boolean, default: false },
    ip: { type: String, default: null },
    deviceId: { type: String, default: null },
  },
  { timestamps: true }
);
schema.index({ mobile: 1, createdAt: -1 });
schema.index({ status: 1, nextAttemptAt: 1 });

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const RewardClaim = model<IRewardClaim>('RewardClaim', schema);
