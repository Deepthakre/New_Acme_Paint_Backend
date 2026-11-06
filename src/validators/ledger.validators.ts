import { z } from 'zod';

export const recordChargeSchema = z.object({
  dealer: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(300),
  subtotal: z.coerce.number().min(0).optional(),
  gst: z.coerce.number().min(0).optional(),
});

export const recordPaymentSchema = z.object({
  dealer: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(300).optional(),
});
