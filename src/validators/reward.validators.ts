import { z } from 'zod';

export const mobileSchema = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.');
export const upiSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,64}@[a-z][a-z0-9.-]{1,40}$/, 'Enter a valid UPI ID, e.g. name@upi.');
const codeSchema = z.string().trim().min(8, 'Scan or enter the reward code.').max(300);

// ---------------- painter ----------------
export const sendOtpSchema = z.object({ mobile: mobileSchema });
export const verifyOtpSchema = z.object({ mobile: mobileSchema, otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP.') });
export const checkCodeSchema = z.object({ code: codeSchema });
export const claimSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2, 'Enter your name.').max(80),
  city: z.string().trim().min(2, 'Enter your city.').max(60),
  upiId: upiSchema,
});
export const retryClaimSchema = z.object({ upiId: upiSchema });
export const claimIdParamSchema = z.object({ id: z.string().trim().regex(/^RC-\d{4}-\d{6}$/, 'Invalid reward id.') });
export const myClaimsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------------- admin ----------------
const rupeesToPaise = (v: number) => Math.round(v * 100);
export const setRateSchema = z.object({
  size: z.string().trim().min(1, 'Enter the bucket size.').max(20),
  amountRupees: z.coerce.number().positive('Reward must be more than 0.').max(100000).transform(rupeesToPaise),
  active: z.boolean().optional().default(true),
});
export const generateBarcodesSchema = z.object({
  size: z.string().trim().min(1).max(20),
  count: z.coerce.number().int().min(1).max(1000),
  label: z.string().trim().max(60).optional().default(''),
});
export const voidBarcodeSchema = z.object({
  serial: z.string().trim().regex(/^RB-\d{6,}$/, 'Serial looks like RB-000123.'),
  reason: z.string().trim().min(3, 'Give a short reason.').max(200),
});
export const adminClaimsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ALL', 'QUEUED', 'PROCESSING', 'PAID', 'FAILED']).default('ALL'),
  search: z.string().trim().max(60).optional().default(''),
});
export const adminPaintersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(60).optional().default(''),
});
export const painterIdParamSchema = z.object({ id: z.string().trim().min(1).max(40) });
export const painterStatusSchema = z.object({ status: z.enum(['ACTIVE', 'BLOCKED']) });
