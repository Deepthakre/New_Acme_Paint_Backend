import { Schema, model } from 'mongoose';

export interface IVoucher {
  id: string; // VCH-x business id
  dealer: string;
  mobile: string;
  code: string;
  discount: number;
  status: 'REDEEMED';
  date: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IVoucher>(
  {
    id: { type: String, required: true, unique: true, index: true },
    dealer: { type: String, required: true, index: true },
    mobile: { type: String, required: true, match: /^\d{10}$/ },
    code: { type: String, required: true },
    discount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['REDEEMED'], default: 'REDEEMED' },
    date: { type: String, required: true },
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

export const Voucher = model<IVoucher>('Voucher', schema);
