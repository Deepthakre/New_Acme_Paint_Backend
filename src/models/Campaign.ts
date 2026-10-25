import { Schema, model } from 'mongoose';

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ENDED' | 'EXHAUSTED';

export interface ICampaignRule {
  /** Empty = any product. */
  product: string;
  /** Bucket size, e.g. "20L". Empty = any size. */
  size: string;
  amountPaise: number;
}

export interface ICampaign {
  id: string; // CMP-xxxx
  name: string;
  status: CampaignStatus;
  startsAt: Date;
  endsAt: Date | null;
  budgetPaise: number;
  /** Reserved/spent so far (includes HELD claims). Only ever changed with an atomic conditional $inc. */
  spentPaise: number;
  rules: ICampaignRule[];
  createdAt: Date;
  updatedAt: Date;
}

const ruleSchema = new Schema<ICampaignRule>(
  {
    product: { type: String, default: '', trim: true },
    size: { type: String, default: '', trim: true },
    amountPaise: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const schema = new Schema<ICampaign>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: ['ACTIVE', 'PAUSED', 'ENDED', 'EXHAUSTED'], default: 'ACTIVE', index: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    budgetPaise: { type: Number, required: true, min: 1 },
    spentPaise: { type: Number, default: 0, min: 0 },
    rules: { type: [ruleSchema], default: [] },
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

export const Campaign = model<ICampaign>('Campaign', schema);
