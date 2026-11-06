# Painter Reward Module (sticker QR → automatic UPI payment)

## Flow
1. **Admin → Dashboard → Painter Rewards → Reward rates**: set ₹ reward per bucket size (20L, 10L, 4L, 1L …).
2. **Generate & print**: choose size + quantity → *Print* (50×50 mm, one sticker per page) or download CSV.
3. Stick the printed sticker **inside** the paint bucket.
4. Painter opens bucket, scans sticker (phone camera) → site opens → **mobile OTP** → sees reward amount → enters **name, city, UPI ID** → confirms.
5. Server atomically marks the sticker used, creates a claim and **sends the money to the UPI ID via RazorpayX** — nobody presses anything.
6. Result arrives by webhook (and a background job re-checks missed ones / retries unfinished ones every minute).
   Wrong UPI ID → claim shows *Failed*; painter fixes UPI on the same page (or Admin presses Retry).

## Safety built in
- Secret code: 60-bit random + checksum; DB stores only its HMAC. One sticker = one claim (unique DB index + atomic update; tested with 8 simultaneous scans → 1 wins).
- Gateway idempotency key `<claimId>-<attempt>` → a retry can never pay twice. Timeouts never mark a claim failed — it is retried.
- Webhook: HMAC-verified raw body; late/duplicate/other-attempt events ignored.
- Limits: 10 check/claim per 10 min per mobile, 30/min per IP, `REWARD_MAX_CLAIMS_PER_DAY` per mobile, `PAYOUT_MAX_PAISE` per reward. Admin can block a painter.
- Production refuses to start with `PAYOUT_PROVIDER=mock`.

## Go-live checklist
1. **SMS provider**: `src/services/sms.service.ts` only logs OTPs in development. Plug MSG91/Twilio there (OTP SMS needs DLT template in India). Vouchers use the same function.
2. **RazorpayX**: create a RazorpayX business account, fund it, set `PAYOUT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID/SECRET`, `RAZORPAY_ACCOUNT_NUMBER`.
   Webhook URL `https://<backend>/api/webhooks/payout`, events `payout.processed`, `payout.failed`, `payout.reversed`, secret = `PAYOUT_WEBHOOK_SECRET`.
   **Test in Razorpay test mode first** – the adapter is written to Razorpay's documented API but was tested here only against a mock gateway.
   Keep RazorpayX balance funded (low balance → payouts wait as "Processing").
3. `npm run db:indexes` once (production has autoIndex off).
4. Frontend env: `VITE_API_URL`, and **`VITE_PUBLIC_URL`** = your real site (printed in the sticker QR).
5. Old module data: `npm run db:drop-old-rewards` (report first; pay any old wallet balances; then `-- --confirm`).
6. Print 1 test sticker, scan with a phone, claim with a real small amount.

## Tests
`npm run test:reward` — integration test (needs MongoDB **replica set** in `MONGO_URI`, uses mock gateway). 51 checks: claim, race, void, failures, timeouts, webhooks, admin API.

## What was removed
Campaigns/budget, fraud-hold queue, wallet ledger + withdrawals, admin notifications, painter login/refresh cookie, "type bucket PRD id" step.
Sticker is now tied to a **bucket size** (not a specific PRD id); dealer returns no longer touch rewards — cancel a sticker by serial in the Printed stickers tab.
