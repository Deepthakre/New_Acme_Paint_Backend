import { Schema, model } from 'mongoose';

export interface IAccessoryItem {
  sku: string;
  name: string;
  category: string;
  sizes: string[];
  price: number;
  stock: number;
  reorder: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IAccessoryItem>(
  {
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    category: { type: String, required: true, trim: true, index: true },
    sizes: { type: [String], default: [] },
    price: { type: Number, required: true, min: 0, default: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    reorder: { type: Number, required: true, min: 0, default: 0 },
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

export const AccessoryItem = model<IAccessoryItem>('AccessoryItem', schema);
