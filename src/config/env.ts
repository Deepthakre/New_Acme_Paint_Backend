import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Fail fast: an app that starts with a missing/weak secret is a security
// incident waiting to happen. Validate the whole environment once, here,
// instead of trusting `process.env.X!` scattered across the codebase.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // 'strict' is safest when the frontend and API share a site. Use 'none'
  // (requires HTTPS) only if they are deployed on different sites.
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  QR_SIGNING_SECRET: z.string().min(16, 'QR_SIGNING_SECRET must be at least 16 characters'),
  // Separate secret for the INNER reward QR codes (checksum + stored hash).
  // Kept apart from QR_SIGNING_SECRET so rotating one never breaks the other.
  REWARD_CODE_SECRET: z.string().min(32, 'REWARD_CODE_SECRET must be at least 32 characters'),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  LOGIN_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  API_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),
  API_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(300),

  // Upper bound for a single loyalty-voucher redemption (rupees).
  VOUCHER_MAX_DISCOUNT: z.coerce.number().positive().default(1000),

  // ---- Painter reward programme (barcode -> UPI auto payout) ----
  // 'razorpay' = real money via RazorpayX Payouts. 'mock' = pretends to pay (local testing ONLY - refused in production).
  PAYOUT_PROVIDER: z.enum(['razorpay', 'mock']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_ACCOUNT_NUMBER: z.string().optional(), // your RazorpayX business account number the money is paid FROM (keep it funded)
  PAYOUT_WEBHOOK_SECRET: z.string().optional(), // secret you set on the Razorpay webhook
  // Safety ceiling for ONE reward (also the maximum a reward rate can be set to). Default Rs 5,000.
  PAYOUT_MAX_PAISE: z.coerce.number().int().positive().default(500000),
  // One mobile number can claim at most this many stickers per day (IST). Stops a stolen sheet being cashed from one phone.
  REWARD_MAX_CLAIMS_PER_DAY: z.coerce.number().int().positive().default(20),
  // How long a verified OTP lets the painter scan / claim before they must verify again.
  REWARD_SESSION_MINUTES: z.coerce.number().int().min(5).max(120).default(20),

  DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(20),
  MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV !== 'production') return;
  if (v.PAYOUT_PROVIDER !== 'razorpay') {
    ctx.addIssue({ code: 'custom', path: ['PAYOUT_PROVIDER'], message: 'PAYOUT_PROVIDER must be "razorpay" in production (mock never moves real money).' });
    return;
  }
  for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_ACCOUNT_NUMBER', 'PAYOUT_WEBHOOK_SECRET'] as const) {
    if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required in production.` });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
