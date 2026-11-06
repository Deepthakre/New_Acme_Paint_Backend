# TrackPaint / UBS Paint Tracking — Backend API

A secure, production-grade REST API for the `Paint_Tracking_typescript` frontend, built with **Node.js, Express, TypeScript and MongoDB (Mongoose)**.

## Highlights

- **Auth**: JWT access tokens (short-lived, sent in `Authorization: Bearer`) + httpOnly refresh-token cookie, bcrypt password hashing, per-role accounts (`admin`, `warehouse`, `dealer`, `salesrep`, `customer`).
- **Rate limiting**: dedicated brute-force protection on `/api/auth/login` (keyed by IP + username, with `skipSuccessfulRequests`), plus an account-lockout fallback after repeated failures, an OTP-send limiter, a register limiter, and a general API-wide limiter.
- **Pagination**: every list endpoint (`GET /api/.../...`) returns `{ success, data, pagination: { page, limit, totalItems, totalPages, hasNextPage, hasPrevPage } }`, driven by a single shared `paginate()` helper — never a hand-rolled `.slice()`.
- **Validation**: every request body/params/query is parsed through a `zod` schema before it reaches a controller (`middleware/validate.ts`). Bad input never reaches the database layer.
- **Security**: `helmet`, strict `cors` (only your configured frontend origin, `credentials: true`), NoSQL-injection sanitization (`express-mongo-sanitize`) on body/params, `hpp` against parameter pollution, centralized error handler that hides internal errors in production, server-side HMAC signing of every QR code (the secret never reaches the browser bundle — unlike the frontend's dev-only `qr.ts` signer), atomic counters/conditional updates everywhere money or stock changes (no double-spend/double-claim races).
- **Optimized**: compound Mongo indexes on the query shapes the app actually runs (batch/status/holder), `.lean()` reads on every list endpoint, `compression` middleware, connection pooling.

## Getting started

```bash
cd backend
cp .env.example .env      # then fill in real secrets — see below
npm install
npm run seed               # creates demo accounts + starter catalog
npm run dev                 # http://localhost:5000
```

### Required `.env` values

Everything is documented in `.env.example`. The two things you MUST change before running anywhere but your own laptop:

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `QR_SIGNING_SECRET` — generate with `openssl rand -hex 32` (or 64). The app refuses to start with short/missing secrets.
- `MONGO_URI` — point at your MongoDB instance (Atlas, local, Docker — anything).

### Demo accounts (created by `npm run seed`)

| Role      | Username    | Password       |
|-----------|-------------|----------------|
| admin     | admin       | Admin@123      |
| warehouse | warehouse   | Warehouse@123  |
| dealer    | dealer1     | Dealer@123     |
| salesrep  | salesrep1   | SalesRep@123   |
| customer  | customer1   | Customer@123   |

## Wiring up the frontend

1. In the frontend project, install axios: `npm install axios`.
2. Add `VITE_API_URL=http://localhost:5000/api` to the frontend's `.env`.
3. A ready-made client already exists at `src/lib/apiClient.ts` in your frontend folder — it exports the **exact same function names and signatures** as `src/lib/dataService.ts` (login, register, listBatches, startBatch, verifyProduct, …), just backed by real `axios` calls to this API instead of `localStorage`. Swap the import in each page:
   ```ts
   // before
   import * as ds from '../lib/dataService';
   // after
   import * as ds from '../lib/apiClient';
   ```
   No other page code needs to change.
4. Existing pages get real backend data as flat arrays (via an internal `getAll()` helper that pages through the API automatically) so nothing else breaks. When you're ready to add real pagination controls (page numbers, "load more", etc.) to a specific screen, use the `paged.*` helpers exported from the same file instead — they return `{ data, pagination }` for that one page.

## Project layout

```
src/
  config/        env validation, DB connection, company info
  models/        Mongoose schemas (User, Product, Batch, Carton, Order, LedgerEntry, Voucher, Painter, RewardRate, RewardBarcode, RewardClaim, AuditLog, Counter, ...)
  validators/    zod schemas, one file per domain
  middleware/    auth (JWT + RBAC), rate limiters, validate(), sanitize, error handler
  controllers/   business logic, one file per domain
  routes/        Express routers wiring validators + middleware + controllers
  services/      shared logic (invoice generation) used by multiple controllers
  utils/         logger, ApiError, asyncHandler, JWT helpers, QR signing, pagination
  seed/          demo data seed script
  app.ts         Express app assembly (security middleware stack)
  server.ts      process bootstrap + graceful shutdown
```

## API surface (all under `/api`)

- `POST /auth/register`, `POST /auth/login` (rate-limited), `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST/PUT/DELETE /catalog` — product master data
- `GET/POST /manufacturing/batches`, `GET /manufacturing/batches/:id/labels`, `GET /manufacturing/cartons/:id`, `GET /manufacturing/batches/activation-summary`
- `GET /warehouse/products`, `POST /warehouse/products/activate`, `POST /warehouse/products/:qr/deactivate`
- `GET /warehouse/dispatch/overview`, `POST /warehouse/dispatch/by-quantity|scan|confirm-scan`
- `POST /warehouse/receive/confirm|force-confirm`, `GET /warehouse/receive/shortages|pending-deliveries`
- `GET /dealers/:dealer/stock|purchase-history|balance`, `POST /dealers/sell|return`, `GET /dealers/payment-status`
- `GET/POST /orders`, `POST /orders/:id/decision`
- `GET /ledger`, `GET /ledger/:dealer`, `POST /ledger/charge|payment`
- `GET/POST/PUT /accessories`, `POST /accessories/:sku/stock-in|sell`
- Painter reward programme (sticker QR -> automatic UPI payout) — see `REWARD_MODULE.md`:
  - `POST /rewards/otp/send|verify` (mobile OTP -> short session token), `POST /rewards/check`, `POST /rewards/claim`, `GET /rewards/claims`, `POST /rewards/claims/:id/retry`
  - `POST /webhooks/payout` (HMAC-verified RazorpayX callback)
  - Admin (`/admin/rewards/*`): `rates`, `barcodes/generate|summary|void`, `claims`, `claims/:id/retry|check`, `painters`, `stats`
- `POST /vouchers/send-otp`, `POST /vouchers/redeem`, `GET /vouchers/:dealer`
- `GET /dashboard/stats`
- `GET /verify?qr=...` — public, rate-limited, checks the HMAC signature server-side

## Notes / production checklist

- Rate limiters use express-rate-limit's in-memory store, correct for a single instance. If you scale to multiple instances/containers behind a load balancer, swap in a shared store (e.g. `rate-limit-redis`) so the login limit is enforced globally, not per-instance.
- `startBatch` reserves ID ranges via atomic Mongo counters, so concurrent batch starts never collide — but the batch of inserts itself isn't wrapped in a multi-document transaction (those require a replica-set Mongo deployment). If you deploy on Atlas or a replica set, wrapping `startBatch`/`confirmReceipt`/`forceConfirmDelivery` in a `mongoose.startSession()` transaction is a natural next step.
- Voucher OTP: `POST /vouchers/send-otp` (dealer, authenticated) sends a 6-digit code to the dealer's own registered mobile; only an HMAC is stored, it expires in 5 minutes, allows 5 attempts and is single-use. `POST /vouchers/redeem` verifies it server-side and caps the discount at `VOUCHER_MAX_DISCOUNT`. Delivery lives in `src/services/sms.service.ts` — it logs the code in development and returns an error in production until you wire in a real SMS provider (Twilio, MSG91, etc.).
- Dealers can only read/act on their own dealer account (`enforceOwnDealer` in `middleware/auth.ts`).
- `POST /auth/logout` no longer needs a valid access token; it uses the refresh cookie. Set `COOKIE_SAMESITE` if the frontend is on a different site.
- CORS is locked to `CORS_ORIGINS` in `.env` — add every real frontend origin (including your production domain) there.


## Painter reward programme

Setup, env vars, Razorpay steps and go-live checklist: **`REWARD_MODULE.md`**.
