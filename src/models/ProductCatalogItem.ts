import { Schema, model } from 'mongoose';

export interface IProductCatalogItem {
  itemCode: string;
  name: string;
  unit: string;
  sizes: string[];
  usp: string;
  manufacturedBy: string;
  address: string;
  email: string;
  website: string;
  helpline: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IProductCatalogItem>(
  {
    itemCode: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    unit: { type: String, required: true, trim: true },
    sizes: { type: [String], default: [] },
    usp: { type: String, default: '', trim: true, maxlength: 500 },
    manufacturedBy: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    website: { type: String, default: '', trim: true },
    helpline: { type: String, default: '', trim: true },
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

export const ProductCatalogItem = model<IProductCatalogItem>('ProductCatalogItem', schema);
