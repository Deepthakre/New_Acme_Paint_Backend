import { z } from 'zod';

// The OTP is always sent to the account's own registered mobile; any
// `mobile` the client still sends is ignored.
export const sendOtpSchema = z.object({
  mobile: z.string().trim().optional(),
});

export const redeemVoucherSchema = z.object({
  code: z.string().trim().min(4).max(20),
  discount: z.coerce.number().positive(),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP.'),
});
