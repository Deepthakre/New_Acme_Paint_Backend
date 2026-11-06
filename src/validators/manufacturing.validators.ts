import { z } from 'zod';
import { qrModeEnum } from './common.validators';

export const startBatchSchema = z
  .object({
    product: z.string().trim().min(1),
    size: z.string().trim().min(1),
    qty: z.coerce.number().int().positive().max(1_000_000),
    qrMode: qrModeEnum,
    unitsPerCarton: z.coerce.number().int().positive().optional(),
    manufacturingDate: z.string().trim().min(1, 'Manufacturing date is required.'),
    mrp: z.coerce.number().positive('Enter the MRP for this size.'),
    batchNo: z.string().trim().max(60).default(''),
    uspCode: z.string().trim().max(60).default(''),
  })
  .superRefine((data, ctx) => {
    if (data.qrMode === 'multi' && !data.unitsPerCarton) {
      ctx.addIssue({ code: 'custom', message: 'unitsPerCarton is required when qrMode is "multi".', path: ['unitsPerCarton'] });
    }
  });

export const batchIdParamSchema = z.object({ batchId: z.string().trim().min(1) });
export const cartonIdParamSchema = z.object({ cartonId: z.string().trim().min(1) });
