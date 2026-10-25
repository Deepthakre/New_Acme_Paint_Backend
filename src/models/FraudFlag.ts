import { Schema, model } from 'mongoose';

export type FraudFlagType =
  | 'VELOCITY'
  | 'MONTHLY_CAP'
  | 'PAINTER_ON_HOLD'
  | 'DEVICE_MANY_PAINTERS'
  | 'SHARED_UPI'
  | 'EXCESS_INVALID_CODES'
  | 'RETURN_AFTER_REWARD';
export type FraudFlagStatus = 'OPEN' | 'APPROVED' | 'REJECTED' | 'DISMISSED';

export interface IFraudFlag {
  id: string; // FF-xxxxxx
  type: FraudFlagType;
  status: FraudFlagStatus;
  painterId: string | null;
  rewardCodeId: string | null;
  productQr: string | null;
  details: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IFraudFlag>(
  {
    id: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      enum: ['VELOCITY', 'MONTHLY_CAP', 'PAINTER_ON_HOLD', 'DEVICE_MANY_PAINTERS', 'SHARED_UPI', 'EXCESS_INVALID_CODES', 'RETURN_AFTER_REWARD'],
      required: true,
      index: true,
    },
    status: { type: String, enum: ['OPEN', 'APPROVED', 'REJECTED', 'DISMISSED'], default: 'OPEN', index: true },
    painterId: { type: String, default: null, index: true },
    rewardCodeId: { type: String, default: null },
    productQr: { type: String, default: null },
    details: { type: String, default: '' },
    resolvedBy: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null },
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

export const FraudFlag = model<IFraudFlag>('FraudFlag', schema);
