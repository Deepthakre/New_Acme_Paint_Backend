import { z } from 'zod';

export const catalogItemSchema = z.object({
  itemCode: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  unit: z.string().trim().min(1).max(20),
  sizes: z.array(z.string().trim().min(1)).default([]),
  usp: z.string().trim().max(500).default(''),
  manufacturedBy: z.string().trim().min(1).max(150),
  address: z.string().trim().min(1).max(300),
  email: z.string().trim().email(),
  website: z.string().trim().max(200).default(''),
  helpline: z.string().trim().max(30).default(''),
});

export const catalogItemUpdateSchema = catalogItemSchema.partial();

export const itemCodeParamSchema = z.object({ itemCode: z.string().trim().min(1).max(30) });
