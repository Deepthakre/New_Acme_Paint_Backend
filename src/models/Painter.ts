import { Schema, model } from 'mongoose';

export type PainterStatus = 'ACTIVE' | 'BLOCKED';

/**
 * A painter who has claimed (or tried to claim) a reward sticker. Created automatically on the first
 * claim - there is no separate registration and no password: the mobile number is verified by OTP.
 * No balance is kept here: the reward goes straight to the painter's UPI ID, and every payment is a
 * RewardClaim record.
 */
export interface IPainter {
  id: string; // PT-YYYY-xxxxxx
  name: string;
  mobile: string;
  city: string;
  upiId: string;
  status: PainterStatus;
  /** RazorpayX contact / fund account, created once and reused for later payouts. */
  gatewayContactId: string | null;
  fundAccountId: string | null;
  fundAccountUpi: string;
  lastClaimAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPainter>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    mobile: { type: String, required: true, unique: true, index: true, match: /^\d{10}$/ },
    city: { type: String, default: '', trim: true },
    upiId: { type: String, default: '', trim: true, lowercase: true },
    status: { type: String, enum: ['ACTIVE', 'BLOCKED'], default: 'ACTIVE', index: true },
    gatewayContactId: { type: String, default: null },
    fundAccountId: { type: String, default: null },
    fundAccountUpi: { type: String, default: '' },
    lastClaimAt: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Painter = model<IPainter>('Painter', schema);
