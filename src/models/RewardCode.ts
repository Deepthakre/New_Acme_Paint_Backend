import { Schema, model, type Types } from 'mongoose';

/**
 * ACTIVE   - printed, waiting to be redeemed
 * HELD     - redeemed by a painter but flagged (velocity/caps/...) - awaiting admin review, budget reserved, NOT yet paid into the wallet
 * REDEEMED - credited to the painter's wallet
 * VOID     - cancelled (returned/defective bucket, rejected claim, ...)
 */
export type RewardCodeStatus = 'ACTIVE' | 'HELD' | 'REDEEMED' | 'VOID';

export interface IRewardCode {
  _id: Types.ObjectId;
  /** HMAC of the code. The plain code is NEVER stored. */
  codeHash: string;
  /** The bucket (Product.qr) this code is sealed inside. */
  productQr: string;
  batchId: string;
  status: RewardCodeStatus;
  /** Only the current code for a bucket is isCurrent=true (a reissued/reprinted code retires the old one). */
  isCurrent: boolean;
  generatedAt: Date;
  painterId: string | null;
  redeemedAt: Date | null;
  amountPaise: number | null;
  campaignId: string | null;
  heldReason: string | null;
  deviceId: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IRewardCode>(
  {
    codeHash: { type: String, required: true, unique: true, index: true },
    productQr: { type: String, required: true, index: true },
    batchId: { type: String, required: true, index: true },
    status: { type: String, enum: ['ACTIVE', 'HELD', 'REDEEMED', 'VOID'], default: 'ACTIVE', index: true },
    isCurrent: { type: Boolean, default: true },
    generatedAt: { type: Date, default: () => new Date() },
    painterId: { type: String, default: null, index: true },
    redeemedAt: { type: Date, default: null },
    amountPaise: { type: Number, default: null },
    campaignId: { type: String, default: null },
    heldReason: { type: String, default: null },
    deviceId: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true }
);

// One CURRENT code per bucket, enforced by the database (partial unique index).
schema.index({ productQr: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
schema.index({ painterId: 1, redeemedAt: -1 });
schema.index({ deviceId: 1, redeemedAt: -1 }, { sparse: true });

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const RewardCode = model<IRewardCode>('RewardCode', schema);
