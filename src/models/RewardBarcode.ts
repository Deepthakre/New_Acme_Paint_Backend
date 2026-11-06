import { Schema, model, type Types } from 'mongoose';

/**
 * ACTIVE  - printed, sitting inside a bucket, waiting to be scanned
 * CLAIMED - a painter scanned it (the money side lives in RewardClaim)
 * VOID    - cancelled by the admin (lost / damaged / wrong sheet)
 */
export type RewardBarcodeStatus = 'ACTIVE' | 'CLAIMED' | 'VOID';

export interface IRewardBarcode {
  _id: Types.ObjectId;
  /** Printed next to the QR. Not secret. Lets the admin find / void one specific sticker. */
  serial: string;
  /** HMAC of the secret code inside the QR. The plain code is NEVER stored. */
  codeHash: string;
  /** Bucket size this sticker goes into - decides the reward amount. */
  size: string;
  /** Free-text name of the print run, e.g. "Oct-2026 run 1". */
  batchLabel: string;
  status: RewardBarcodeStatus;
  claimedAt: Date | null;
  claimedByMobile: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IRewardBarcode>(
  {
    serial: { type: String, required: true, unique: true, index: true },
    codeHash: { type: String, required: true, unique: true, index: true },
    size: { type: String, required: true, index: true },
    batchLabel: { type: String, default: '', index: true },
    status: { type: String, enum: ['ACTIVE', 'CLAIMED', 'VOID'], default: 'ACTIVE', index: true },
    claimedAt: { type: Date, default: null },
    claimedByMobile: { type: String, default: null },
    voidReason: { type: String, default: null },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    delete ret.codeHash;
    return ret;
  },
});

export const RewardBarcode = model<IRewardBarcode>('RewardBarcode', schema);
