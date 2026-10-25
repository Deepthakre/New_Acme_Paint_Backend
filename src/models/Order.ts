import { Schema, model } from 'mongoose';

export type OrderStatus = 'PENDING' | 'DISPATCHED' | 'REJECTED';

export interface IOrderItem {
  product: string;
  size: string;
  qty: number;
  mrp: number | null;
}

export interface IOrder {
  id: string; // ORD-xxx business id
  dealer: string;
  items: IOrderItem[];
  subtotal: number | null;
  gst: number | null;
  total: number | null;
  status: OrderStatus;
  bookedBy: string | null;
  invoiceId: string | null;
  date: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: String, required: true },
    size: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    mrp: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const schema = new Schema<IOrder>(
  {
    id: { type: String, required: true, unique: true, index: true },
    dealer: { type: String, required: true, index: true },
    items: { type: [orderItemSchema], validate: [(v: unknown[]) => v.length > 0, 'Order must have at least one item'] },
    subtotal: { type: Number, default: null },
    gst: { type: Number, default: null },
    total: { type: Number, default: null },
    status: { type: String, enum: ['PENDING', 'DISPATCHED', 'REJECTED'], default: 'PENDING', index: true },
    bookedBy: { type: String, default: null },
    invoiceId: { type: String, default: null },
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

export const Order = model<IOrder>('Order', schema);
