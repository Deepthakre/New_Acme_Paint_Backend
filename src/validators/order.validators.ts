import { z } from 'zod';

const orderItemSchema = z.object({
  product: z.string().trim().min(1),
  size: z.string().trim().min(1),
  qty: z.coerce.number().positive(),
  mrp: z.coerce.number().min(0).nullable().optional(),
});

export const placeOrderSchema = z.object({
  dealer: z.string().trim().min(1),
  items: z.array(orderItemSchema).min(1, 'Add at least one item to the order.'),
  bookedBy: z.string().trim().max(120).nullable().optional(),
});

export const decideOrderSchema = z.object({
  decision: z.enum(['approve', 'reject']),
});

export const orderIdParamSchema = z.object({ orderId: z.string().trim().min(1) });
