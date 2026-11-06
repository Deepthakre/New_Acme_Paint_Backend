import https from 'https';
import crypto from 'crypto';
import { env } from '../config/env';

/** The gateway clearly said NO (bad UPI ID, invalid request ...). Money was NOT sent -> safe to mark failed. */
export class GatewayRejectedError extends Error {}
/** We cannot tell whether the gateway got it (timeout / 5xx / network). NEVER treat as failed - retry with the same idempotency key. */
export class GatewayUnknownError extends Error {}

export type GatewayResult = 'PAID' | 'PROCESSING' | 'FAILED';

export interface GatewayPayout {
  id: string;
  result: GatewayResult;
  utr: string | null;
  failureReason: string | null;
}

export interface PayoutGateway {
  name: string;
  createContact(i: { name: string; mobile: string; referenceId: string }): Promise<string>;
  createFundAccount(i: { contactId: string; upiId: string }): Promise<string>;
  createPayout(i: { fundAccountId: string; amountPaise: number; referenceId: string; narration: string }): Promise<GatewayPayout>;
  fetchPayout(gatewayPayoutId: string): Promise<GatewayPayout>;
}

/** Razorpay payout status -> our 3 results. */
export function mapRazorpayStatus(status: string): GatewayResult {
  switch (status) {
    case 'processed':
      return 'PAID';
    case 'rejected':
    case 'cancelled':
    case 'failed':
    case 'reversed':
      return 'FAILED';
    default:
      return 'PROCESSING'; // queued, pending, processing, initiated, scheduled ...
  }
}

// ------------------------------------------------------------------ RazorpayX

interface HttpResult {
  status: number;
  json: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function request(method: 'GET' | 'POST', path: string, body: unknown, headers: Record<string, string>): Promise<HttpResult> {
  const payload = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.razorpay.com',
        path: `/v1${path}`,
        method,
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // non-JSON body
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class RazorpayXGateway implements PayoutGateway {
  name = 'razorpay';

  private auth(): string {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_ACCOUNT_NUMBER) {
      throw new GatewayUnknownError('RazorpayX is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_ACCOUNT_NUMBER).');
    }
    return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    let res: HttpResult;
    try {
      res = await request(method, path, body, { Authorization: this.auth(), ...extra });
    } catch (err) {
      throw new GatewayUnknownError(`Could not reach the payment gateway (${(err as Error).message}).`);
    }
    if (res.status === 0 || res.status >= 500 || res.status === 429) throw new GatewayUnknownError(`Payment gateway error (${res.status}).`);
    if (res.status === 401 || res.status === 403) throw new GatewayUnknownError('Payment gateway credentials were refused - check the RazorpayX keys.');
    if (res.status >= 400) {
      const desc = (res.json?.error as { description?: string } | undefined)?.description;
      throw new GatewayRejectedError(desc || `Payment gateway rejected the request (${res.status}).`);
    }
    return res.json;
  }

  private toPayout(p: Record<string, any>): GatewayPayout { // eslint-disable-line @typescript-eslint/no-explicit-any
    const result = mapRazorpayStatus(String(p.status ?? ''));
    const reason =
      (typeof p.failure_reason === 'string' && p.failure_reason) ||
      (typeof p.status_details?.description === 'string' && p.status_details.description) ||
      null;
    return { id: String(p.id), result, utr: typeof p.utr === 'string' ? p.utr : null, failureReason: result === 'FAILED' ? reason ?? `Payout ${p.status}` : null };
  }

  async createContact(i: { name: string; mobile: string; referenceId: string }): Promise<string> {
    const c = await this.call('POST', '/contacts', { name: i.name, contact: i.mobile, type: 'customer', reference_id: i.referenceId });
    return String(c.id);
  }

  async createFundAccount(i: { contactId: string; upiId: string }): Promise<string> {
    const f = await this.call('POST', '/fund_accounts', { contact_id: i.contactId, account_type: 'vpa', vpa: { address: i.upiId } });
    return String(f.id);
  }

  async createPayout(i: { fundAccountId: string; amountPaise: number; referenceId: string; narration: string }): Promise<GatewayPayout> {
    const p = await this.call(
      'POST',
      '/payouts',
      {
        account_number: env.RAZORPAY_ACCOUNT_NUMBER,
        fund_account_id: i.fundAccountId,
        amount: i.amountPaise,
        currency: 'INR',
        mode: 'UPI',
        purpose: 'cashback',
        queue_if_low_balance: true, // low RazorpayX balance -> payout waits, it does not fail
        reference_id: i.referenceId, // "<claimId>-<payoutSeq>" - comes back on the webhook
        narration: i.narration.slice(0, 30),
      },
      { 'X-Payout-Idempotency': i.referenceId } // a retry can NEVER pay twice
    );
    return this.toPayout(p);
  }

  async fetchPayout(gatewayPayoutId: string): Promise<GatewayPayout> {
    return this.toPayout(await this.call('GET', `/payouts/${encodeURIComponent(gatewayPayoutId)}`));
  }
}

// ------------------------------------------------------------------ mock (local testing only)

/** Pretends the payment succeeded instantly. env.ts refuses to start in production with this selected. */
class MockGateway implements PayoutGateway {
  name = 'mock';
  async createContact(): Promise<string> {
    return `mock_cont_${crypto.randomBytes(4).toString('hex')}`;
  }
  async createFundAccount(): Promise<string> {
    return `mock_fa_${crypto.randomBytes(4).toString('hex')}`;
  }
  async createPayout(i: { referenceId: string }): Promise<GatewayPayout> {
    return { id: `mock_pout_${i.referenceId}`, result: 'PAID', utr: `MOCK${Date.now()}`, failureReason: null };
  }
  async fetchPayout(id: string): Promise<GatewayPayout> {
    return { id, result: 'PAID', utr: `MOCK${Date.now()}`, failureReason: null };
  }
}

export const gateway: PayoutGateway = env.PAYOUT_PROVIDER === 'razorpay' ? new RazorpayXGateway() : new MockGateway();
