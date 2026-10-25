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

  // ---- Painter reward programme ----
  PAYOUT_MIN_PAISE: z.coerce.number().int().positive().default(10000), // Rs 100
  PAYOUT_MAX_PAISE: z.coerce.number().int().positive().default(500000), // Rs 5,000 per request
  // 'manual' = admin marks payouts paid after paying out of band.
  // 'gateway' = hand over to services/payout.service.ts GatewayProvider (needs your gateway credentials + mapping).
  PAYOUT_PROVIDER: z.enum(['manual', 'razorpay']).default('manual'),
  // true: the reward is sent to the painter's UPI ID immediately after a successful claim. false: it waits in the wallet.
  PAYOUT_AUTO_ON_CLAIM: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // RazorpayX credentials (only needed when PAYOUT_PROVIDER=razorpay)
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_ACCOUNT_NUMBER: z.string().optional(), // your RazorpayX business account number that the money is paid from
  PAYOUT_WEBHOOK_SECRET: z.string().optional(),
  PAYOUT_WEBHOOK_SIGNATURE_HEADER: z.string().default('x-razorpay-signature'),
  UPI_CHANGE_COOLDOWN_HOURS: z.coerce.number().int().min(0).default(24),
  // false (default): reward can be claimed as soon as the lid is opened, even if the dealer never scanned the sale.
  // true: reward only after the bucket is marked SOLD.
  REWARD_REQUIRE_SOLD: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  REWARD_MAX_CLAIMS_PER_DAY: z.coerce.number().int().positive().default(25), // above this -> HOLD for review
  REWARD_MONTHLY_CAP_PAISE: z.coerce.number().int().positive().default(500000), // Rs 5,000 per painter / month
  REDEEM_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(8),
  REDEEM_BLOCK_MINUTES: z.coerce.number().int().positive().default(30),
  DEVICE_MAX_PAINTERS: z.coerce.number().int().positive().default(3),

  DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(20),
  MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
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
