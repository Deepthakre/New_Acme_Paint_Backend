import { z } from 'zod';

export const qrRefSchema = z.object({
  qr: z.string().trim().min(1, 'A QR/carton reference is required.'),
});

export const qrParamSchema = z.object({ qr: z.string().trim().min(1) });

export const dispatchByQuantitySchema = z.object({
  batchId: z.string().trim().min(1),
  qty: z.coerce.number().int().positive(),
  dealer: z.string().trim().min(1),
});

export const confirmScanDispatchSchema = z.object({
  qrs: z.array(z.string().trim().min(1)).min(1, 'At least one QR is required.'),
  dealer: z.string().trim().min(1),
});

export const confirmReceiptSchema = z.object({
  dealer: z.string().trim().min(1),
  qrs: z.array(z.string().trim().min(1)).default([]),
});

export const forceConfirmSchema = z.object({
  qrs: z.array(z.string().trim().min(1)).min(1),
});
