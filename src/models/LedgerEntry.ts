import { Schema, model } from 'mongoose';

export type LedgerEntryType = 'CHARGE' | 'PAYMENT';

export interface IInvoiceLineItem {
  product: string;
  size: string;
  mrp: number;
  qty: number;
}

export interface ILedgerEntry {
  dealer: string;
  type: LedgerEntryType;
  amount: number;
  note: string;
  subtotal?: number | null;
  gst?: number | null;
  gstRate?: number;
  items?: IInvoiceLineItem[];
  invoiceId?: string;
  orderId?: string;
  date: string;
  createdAt: Date;
  updatedAt: Date;
}

const lineItemSchema = new Schema<IInvoiceLineItem>(
  { product: String, size: String, mrp: Number, qty: Number },
  { _id: false }
);

const schema = new Schema<ILedgerEntry>(
  {
    dealer: { type: String, required: true, index: true },
    type: { type: String, enum: ['CHARGE', 'PAYMENT'], required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: '' },
    subtotal: { type: Number, default: null },
    gst: { type: Number, default: null },
    gstRate: { type: Number },
    items: { type: [lineItemSchema], default: undefined },
    invoiceId: { type: String, index: true, sparse: true },
    orderId: { type: String, index: true, sparse: true },
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

export const LedgerEntry = model<ILedgerEntry>('LedgerEntry', schema);
