import { Schema, model } from 'mongoose';

export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED';

export interface IPayout {
  id: string; // PO-YYYY-xxxxxx
  painterId: string;
  amountPaise: number;
  upiId: string; // snapshot at request time
  status: PayoutStatus;
  provider: string;
  providerRef: string | null;
  utr: string | null;
  failureReason: string | null;
  /** Client-supplied Idempotency-Key - a double-tap / retry returns the SAME payout. */
  idempotencyKey: string;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPayout>(
  {
    id: { type: String, required: true, unique: true, index: true },
    painterId: { type: String, required: true, index: true },
    amountPaise: { type: Number, required: true, min: 1 },
    upiId: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED'], default: 'PENDING', index: true },
    provider: { type: String, required: true },
    providerRef: { type: String, default: null, index: true, sparse: true },
    utr: { type: String, default: null },
    failureReason: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ painterId: 1, idempotencyKey: 1 }, { unique: true });

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Payout = model<IPayout>('Payout', schema);
