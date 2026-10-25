import { Schema, model } from 'mongoose';

export type PainterStatus = 'ACTIVE' | 'ON_HOLD' | 'BLOCKED';

/**
 * A painter account (mobile + OTP login). NOTE: there is deliberately NO
 * balance field here — the wallet balance is always the sum of the
 * append-only WalletLedger (see services/ledger.service.ts).
 */
export interface IPainter {
  id: string; // PT-YYYY-xxxxxx business id
  name: string;
  mobile: string;
  city: string;
  state: string;
  experience: string;
  painterType: string;
  upiId: string; // '' until the painter adds one (needed only for withdrawals)
  upiUpdatedAt: Date | null;
  status: PainterStatus;
  tokenVersion: number;
  /** Payout gateway contact id (created on the first payout, then reused). */
  gatewayContactId: string | null;
  /** Bumped inside every money transaction so concurrent ones on the same painter serialise (write conflict -> retry). */
  ledgerSeq: number;
  failedRedeems: number;
  failedRedeemWindowStart: Date | null;
  redeemBlockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPainter>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    mobile: { type: String, required: true, unique: true, index: true, match: /^\d{10}$/ },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    experience: { type: String, default: '', trim: true },
    painterType: { type: String, default: 'Painter', trim: true },
    upiId: { type: String, default: '', trim: true, lowercase: true },
    upiUpdatedAt: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'ON_HOLD', 'BLOCKED'], default: 'ACTIVE', index: true },
    tokenVersion: { type: Number, default: 0 },
    gatewayContactId: { type: String, default: null },
    ledgerSeq: { type: Number, default: 0 },
    failedRedeems: { type: Number, default: 0 },
    failedRedeemWindowStart: { type: Date, default: null },
    redeemBlockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ upiId: 1 }, { sparse: true });

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Painter = model<IPainter>('Painter', schema);
