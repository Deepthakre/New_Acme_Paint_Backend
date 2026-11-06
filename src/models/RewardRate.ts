import { Schema, model } from 'mongoose';

/** "20 l" / "20l" / "20 L" -> "20L". Bucket sizes are compared in this form everywhere. */
export function normalizeSize(raw: string): string {
  return String(raw || '').toUpperCase().replace(/\s+/g, '');
}

/** How much a painter earns for one bucket of a given size. Editable by the admin at any time. */
export interface IRewardRate {
  size: string; // normalised, e.g. "20L"
  amountPaise: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IRewardRate>(
  {
    size: { type: String, required: true, unique: true, index: true, trim: true },
    amountPaise: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => Number.isInteger(v) && v > 0, message: 'amountPaise must be a positive integer' },
    },
    active: { type: Boolean, default: true },
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

export const RewardRate = model<IRewardRate>('RewardRate', schema);
