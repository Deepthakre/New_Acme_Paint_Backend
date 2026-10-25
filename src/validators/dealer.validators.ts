import { z } from 'zod';
import { returnConditionEnum } from './common.validators';

export const sellToCustomerSchema = z.object({
  qr: z.string().trim().min(1),
  dealer: z.string().trim().min(1),
  customerName: z.string().trim().max(150).optional(),
});

export const processReturnSchema = z.object({
  qr: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(300),
  condition: returnConditionEnum,
  dealer: z.string().trim().min(1),
});

export const dealerNameParamSchema = z.object({ dealer: z.string().trim().min(1) });
