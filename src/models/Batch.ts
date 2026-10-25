import { Schema, model } from 'mongoose';

export type QrMode = 'single' | 'multi';

export interface IBatch {
  id: string; // BATCH-xxxx business id
  product: string;
  size: string;
  unit: string;
  qty: number;
  qrMode: QrMode;
  unitsPerCarton: number | null;
  range: string;
  date: string;
  manufacturingDate: string;
  batchNo: string;
  uspCode: string;
  mrp: number;
  cartonRefs: string[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IBatch>(
  {
    id: { type: String, required: true, unique: true, index: true },
    product: { type: String, required: true, index: true },
    size: { type: String, required: true },
    unit: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    qrMode: { type: String, enum: ['single', 'multi'], required: true },
    unitsPerCarton: { type: Number, default: null },
    range: { type: String, default: '' },
    date: { type: String, required: true },
    manufacturingDate: { type: String, required: true },
    batchNo: { type: String, default: '' },
    uspCode: { type: String, default: '' },
    mrp: { type: Number, required: true, min: 0.01 },
    cartonRefs: { type: [String], default: [] },
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

export const Batch = model<IBatch>('Batch', schema);
