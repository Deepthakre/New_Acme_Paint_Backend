import { z } from 'zod';

export const mobileSchema = z.string().trim().regex(/^\d{10}$/, 'Enter a valid 10-digit mobile number.');
export const upiSchemaValue = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/, 'Enter a valid UPI ID, e.g. name@upi.');

export const sendPainterOtpSchema = z.object({ mobile: mobileSchema });

export const verifyPainterOtpSchema = z.object({
  mobile: mobileSchema,
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP.'),
  // Needed only the first time (registration):
  name: z.string().trim().min(2, 'Enter your name.').max(120).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  experience: z.string().trim().max(60).optional(),
  painterType: z.string().trim().max(60).optional(),
});

export const updateUpiSchema = z.object({ upiId: upiSchemaValue });
