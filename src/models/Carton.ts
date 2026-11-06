import { Schema, model } from 'mongoose';

export interface ICarton {
  id: string; // CTN-xxxx business id
  qrString: string;
  batchId: string;
  product: string;
  size: string;
  unitsCount: number;
  qrList: string[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ICarton>(
  {
    id: { type: String, required: true, unique: true, index: true },
    qrString: { type: String, required: true },
    batchId: { type: String, required: true, index: true },
    product: { type: String, required: true },
    size: { type: String, required: true },
    unitsCount: { type: Number, required: true, min: 0 },
    qrList: { type: [String], default: [] },
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

export const Carton = model<ICarton>('Carton', schema);
