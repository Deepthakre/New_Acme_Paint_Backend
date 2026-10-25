import { z } from 'zod';
import { upiSchemaValue } from './painter.validators';

export const redeemRewardSchema = z.object({
  code: z.string().trim().min(8, 'Enter the reward code.').max(300),
  bucketQrId: z.string().trim().min(4, 'Enter the QR ID printed on the bucket label.').max(60),
  upiId: upiSchemaValue.optional(),
});

export const withdrawSchema = z.object({
  amountPaise: z.coerce.number().int('Amount must be a whole number of paise.').positive(),
});

export const batchIdBodySchema = z.object({ batchId: z.string().trim().min(1).max(40) });
export const generateStickersSchema = z.object({
  count: z.coerce.number().int().min(1).max(1000),
  label: z.string().trim().max(40).optional().default(''),
});
export const productQrParamSchema = z.object({ productQr: z.string().trim().min(1).max(60) });
export const idParamSchema = z.object({ id: z.string().trim().min(1).max(60) });

const rupees = z.coerce.number().positive().max(10_000_000);

export const campaignRuleSchema = z.object({
  product: z.string().trim().max(120).optional().default(''),
  size: z.string().trim().max(40).optional().default(''),
  amountRupees: z.coerce.number().positive().max(5000),
});

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable().optional(),
    budgetRupees: rupees,
    rules: z.array(campaignRuleSchema).min(1, 'Add at least one reward rule.').max(100),
  })
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, { message: 'End date must be after the start date.', path: ['endsAt'] });

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).optional(),
  endsAt: z.coerce.date().nullable().optional(),
  addBudgetRupees: rupees.optional(),
  rules: z.array(campaignRuleSchema).min(1).max(100).optional(),
});

export const resolveFlagSchema = z.object({
  action: z.enum(['approve', 'reject', 'dismiss', 'block_painter']),
  note: z.string().trim().max(500).optional(),
});

export const markPaidSchema = z.object({ utr: z.string().trim().min(6, 'Enter the UTR / transaction reference.').max(60) });
export const markFailedSchema = z.object({ reason: z.string().trim().min(3).max(200) });
export const painterStatusSchema = z.object({ status: z.enum(['ACTIVE', 'ON_HOLD', 'BLOCKED']) });
