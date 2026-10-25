import { Schema, model } from 'mongoose';

export type ProductStatus = 'FACTORY' | 'TRANSIT' | 'DEALER' | 'SOLD' | 'RETURNED';

export interface ILogEntry {
  event: string;
  who: string;
  time: string;
  ts?: number;
}

export interface IProduct {
  qr: string; // PRD-xxxx business id
  qrString: string;
  batchId: string;
  product: string;
  size: string;
  status: ProductStatus;
  active: boolean;
  holder: string;
  cartonId: string | null;
  log: ILogEntry[];
  invoiceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const logEntrySchema = new Schema<ILogEntry>(
  {
    event: { type: String, required: true },
    who: { type: String, required: true },
    time: { type: String, required: true },
    ts: { type: Number },
  },
  { _id: false }
);

const schema = new Schema<IProduct>(
  {
    qr: { type: String, required: true, unique: true, index: true },
    qrString: { type: String, required: true },
    batchId: { type: String, required: true, index: true },
    product: { type: String, required: true, index: true },
    size: { type: String, required: true },
    status: { type: String, enum: ['FACTORY', 'TRANSIT', 'DEALER', 'SOLD', 'RETURNED'], default: 'FACTORY', index: true },
    active: { type: Boolean, default: false, index: true },
    holder: { type: String, required: true, index: true },
    cartonId: { type: String, default: null, index: true },
    log: { type: [logEntrySchema], default: [] },
    invoiceId: { type: String },
  },
  { timestamps: true }
);

// Compound indexes for the query shapes this API actually runs: batch
// dispatch overview, dealer stock pages, and warehouse pending-delivery
// sorting by dispatch time.
schema.index({ batchId: 1, status: 1, active: 1 });
schema.index({ status: 1, holder: 1 });

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Product = model<IProduct>('Product', schema);
