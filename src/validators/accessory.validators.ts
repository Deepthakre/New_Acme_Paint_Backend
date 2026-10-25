import { z } from 'zod';

export const addAccessorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  category: z.string().trim().min(1).max(80),
  sizes: z.array(z.string().trim().min(1)).default([]),
  price: z.coerce.number().min(0),
  stock: z.coerce.number().min(0).default(0),
  reorder: z.coerce.number().min(0).default(0),
});

export const updateAccessorySchema = addAccessorySchema.partial();

export const skuParamSchema = z.object({ sku: z.string().trim().min(1) });

export const stockQtySchema = z.object({
  qty: z.coerce.number().int().positive(),
  source: z.string().trim().max(150).optional(),
  customer: z.string().trim().max(150).optional(),
});
