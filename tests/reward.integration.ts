import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db';
import { createApp } from '../src/app';
import { gateway, GatewayRejectedError, GatewayUnknownError } from '../src/services/payoutGateway.service';
import { upsertRate, generateBarcodes, checkCode, claimReward, voidBarcode, listClaimsForMobile } from '../src/services/reward.service';
import { retryFailedClaim, adminRetryClaim, dispatchPayout } from '../src/services/rewardPayout.service';
import { RewardClaim } from '../src/models/RewardClaim';
import { RewardBarcode } from '../src/models/RewardBarcode';
import { Painter } from '../src/models/Painter';
import { signPainterToken } from '../src/utils/painterToken';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) fails++; };
const rejects = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e; } };
const base = (mobile: string, code: string, extra: object = {}) => ({ mobile, rawCode: code, name: 'Ramesh Painter', city: 'Nagpur', upiId: 'ramesh@oksbi', ip: '1.1.1.1', deviceId: null, ...extra });

async function main() {
  await connectDb();

  await Promise.all([RewardClaim, RewardBarcode, Painter].map((m) => m.syncIndexes()));
  const real = { cf: gateway.createFundAccount, cp: gateway.createPayout };

  // ---------- rates + generation
  ok('cannot generate without a rate', !!(await rejects(generateBarcodes({ size: '20L', count: 1, label: '', adminId: 'a' }))));
  await upsertRate({ size: '20 l', amountPaise: 5000, active: true }, 'admin');
  await upsertRate({ size: '4L', amountPaise: 1500, active: true }, 'admin');
  ok('rate above max rejected', !!(await rejects(upsertRate({ size: '1L', amountPaise: 99999999, active: true }, 'admin'))));
  const run = await generateBarcodes({ size: '20L', count: 12, label: 'test run', adminId: 'admin' });
  const run4 = await generateBarcodes({ size: '4l', count: 2, label: '', adminId: 'admin' });
  ok('12 codes + serials', run.codes.length === 12 && run.codes[0].serial === 'RB-000001' && run.codes[11].serial === 'RB-000012');
  ok('serials continue across runs', run4.codes[0].serial === 'RB-000013');
  ok('only hashes stored (no plain code in DB)', (await RewardBarcode.find({}).lean()).every((b: any) => !JSON.stringify(b).includes(run.codes[0].code)));
  const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12] = run.codes.map((c) => c.code);

  // ---------- happy path (mock gateway = instant success)
  const chk = await checkCode(c1);
  ok('check shows size + amount', chk.size === '20L' && chk.amountPaise === 5000);
  const r1 = await claimReward(base('9876543210', c1));
  ok('claim -> PAID automatically', r1.status === 'PAID' && r1.amountPaise === 5000, r1.message);
  const doc1: any = await RewardClaim.findOne({ id: r1.claimId }).lean();
  ok('claim stored w/ painter details + utr', doc1.painterName === 'Ramesh Painter' && doc1.city === 'Nagpur' && doc1.upiId === 'ramesh@oksbi' && !!doc1.utr && doc1.payoutSeq === 1);
  const b1: any = await RewardBarcode.findOne({ serial: 'RB-000001' }).lean();
  ok('barcode flipped to CLAIMED', b1.status === 'CLAIMED' && b1.claimedByMobile === '9876543210');
  ok('painter auto-created', !!(await Painter.findOne({ mobile: '9876543210' })));

  const second = await rejects(claimReward(base('9123456780', c1)));
  ok('same sticker twice -> 409', second?.statusCode === 409, second?.message);
  const bad = await rejects(claimReward(base('9876543210', 'ABCDEFGHJKMNPQ')));
  ok('garbage code -> 400', bad?.statusCode === 400);
  const amt4 = await claimReward(base('9876543210', run4.codes[0].code));
  ok('amount depends on size (4L = Rs 15)', amt4.amountPaise === 1500 && amt4.size === '4L');

  // ---------- race: same sticker, 8 phones at the same instant
  const racers = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => claimReward(base(`90000000${10 + i}`, c2))));
  const won = racers.filter((r) => r.status === 'fulfilled').length;
  ok('RACE: exactly ONE of 8 simultaneous claims wins', won === 1, `won=${won}`);
  ok('RACE: exactly one claim row for that sticker', (await RewardClaim.countDocuments({ barcodeSerial: 'RB-000002' })) === 1);

  // ---------- void
  await voidBarcode('RB-000003', 'lost sheet', 'admin');
  const v = await rejects(claimReward(base('9876543210', c3)));
  ok('voided sticker cannot be claimed', v?.statusCode === 400, v?.message);
  ok('claimed sticker cannot be voided', (await rejects(voidBarcode('RB-000001', 'x', 'admin')))?.statusCode === 409);

  // ---------- gateway says NO (wrong UPI) -> FAILED -> painter fixes UPI -> PAID
  gateway.createFundAccount = async () => { throw new GatewayRejectedError('Invalid VPA'); };
  const f = await claimReward(base('9876543211', c4, { upiId: 'wrong@upi' }));
  ok('gateway rejection -> FAILED w/ reason', f.status === 'FAILED' && /Invalid VPA/.test(f.message), f.message);
  ok('failed claim keeps sticker CLAIMED (no re-use)', (await rejects(claimReward(base('9111111111', c4))))?.statusCode === 409);
  gateway.createFundAccount = real.cf;
  const other = await rejects(retryFailedClaim({ claimId: f.claimId, mobile: '9000000099', upiId: 'x@upi', ip: null }));
  ok('another mobile cannot retry my claim', other?.statusCode === 404);
  const fixed = await retryFailedClaim({ claimId: f.claimId, mobile: '9876543211', upiId: 'right@upi', ip: null });
  ok('painter retry with fixed UPI -> PAID, payoutSeq 2', fixed.status === 'PAID' && fixed.payoutSeq === 2 && fixed.upiId === 'right@upi');
  ok('painter UPI updated', (await Painter.findOne({ mobile: '9876543211' }).lean())?.upiId === 'right@upi');
  ok('paid claim cannot be retried', (await rejects(retryFailedClaim({ claimId: f.claimId, mobile: '9876543211', upiId: 'z@upi', ip: null })))?.statusCode === 409);

  // ---------- gateway UNKNOWN (timeout) -> stays QUEUED, never lost, same idempotency key on retry
  const refs: string[] = [];
  gateway.createPayout = async (i) => { refs.push(i.referenceId); throw new GatewayUnknownError('timeout'); };
  const u = await claimReward(base('9876543212', c5));
  ok('timeout -> stays QUEUED (not failed, not lost)', u.status === 'QUEUED');
  const uDoc: any = await RewardClaim.findOne({ id: u.claimId }).lean();
  ok('retry scheduled with back-off', uDoc.attempts === 1 && uDoc.nextAttemptAt > new Date());
  gateway.createPayout = async (i) => { refs.push(i.referenceId); return { id: 'mock_p', result: 'PAID', utr: 'UTR1', failureReason: null }; };
  const u2 = await adminRetryClaim(u.claimId, 'admin');
  ok('admin retry completes it -> PAID', u2.status === 'PAID');
  ok('SAME idempotency key on both attempts (cannot double pay)', refs.length === 2 && refs[0] === refs[1] && refs[0] === `${u.claimId}-1`, refs.join(' | '));

  // ---------- PROCESSING -> webhook
  gateway.createPayout = async () => ({ id: 'pout_abc', result: 'PROCESSING', utr: null, failureReason: null });
  const p = await claimReward(base('9876543213', c6));
  ok('gateway "processing" -> PROCESSING', p.status === 'PROCESSING');
  gateway.createPayout = real.cp;

  const server = createApp().listen(0);
  const url = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const hook = async (event: string, entity: object) => {
    const body = JSON.stringify({ event, payload: { payout: { entity } } });
    const sig = crypto.createHmac('sha256', 'whsec_test').update(body).digest('hex');
    const r = await fetch(url + '/webhooks/payout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig }, body });
    return r.status;
  };
  ok('webhook processed -> 200', (await hook('payout.processed', { id: 'pout_abc', reference_id: `${p.claimId}-1`, status: 'processed', utr: 'UTRXYZ' })) === 200);
  let pd: any = await RewardClaim.findOne({ id: p.claimId }).lean();
  ok('claim now PAID with UTR from webhook', pd.status === 'PAID' && pd.utr === 'UTRXYZ');
  const paidAt = pd.paidAt.getTime();
  await hook('payout.processed', { id: 'pout_abc', reference_id: `${p.claimId}-1`, status: 'processed', utr: 'UTRXYZ' });
  pd = await RewardClaim.findOne({ id: p.claimId }).lean();
  ok('replayed webhook changes nothing', pd.paidAt.getTime() === paidAt);
  await hook('payout.failed', { id: 'old', reference_id: `${p.claimId}-7`, status: 'failed', failure_reason: 'stale' });
  pd = await RewardClaim.findOne({ id: p.claimId }).lean();
  ok('webhook for a different attempt number is ignored', pd.status === 'PAID');
  await hook('payout.reversed', { id: 'pout_abc', reference_id: `${p.claimId}-1`, status: 'reversed', failure_reason: 'Bank reversed' });
  pd = await RewardClaim.findOne({ id: p.claimId }).lean();
  ok('reversal after paid -> FAILED (retryable)', pd.status === 'FAILED' && /reversed/i.test(pd.failureReason));

  // ---------- daily cap (env cap = 6; this mobile already has several today)
  const capMobile = '9555555555';
  const capCodes = [c7, c8, c9, c10, c11, c12];
  const res: string[] = [];
  for (const code of capCodes) { const e = await rejects(claimReward(base(capMobile, code))); res.push(e ? String(e.statusCode) : 'ok'); }
  ok('daily cap: 6 allowed then blocked', res.filter((x) => x === 'ok').length === 6, res.join(','));
  const extra = await generateBarcodes({ size: '20L', count: 1, label: 'cap', adminId: 'admin' });
  ok('7th claim same day -> 429', (await rejects(claimReward(base(capMobile, extra.codes[0].code))))?.statusCode === 429);

  // ---------- blocked painter
  await Painter.updateOne({ mobile: '9876543210' }, { $set: { status: 'BLOCKED' } });
  ok('blocked painter cannot claim', (await rejects(claimReward(base('9876543210', extra.codes[0].code))))?.statusCode === 403);

  // ---------- history
  const hist = await listClaimsForMobile('9876543210', 1, 20);
  ok('history lists my claims + total paid', hist.data.length === 2 && hist.totalPaidPaise === 6500, `n=${hist.data.length} paid=${hist.totalPaidPaise}`);

  // ---------- admin HTTP end-to-end
  const login = await fetch(url + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin@123', role: 'admin' }) });
  const tok = (await login.json() as any).data?.accessToken;
  ok('admin login works', !!tok);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` };
  const j = async (path: string, init: RequestInit = {}) => { const r = await fetch(url + path, { ...init, headers: H }); return { s: r.status, b: (await r.json()) as any }; };
  const rate = await j('/admin/rewards/rates', { method: 'PUT', body: JSON.stringify({ size: '10l', amountRupees: 25.5 }) });
  ok('PUT rate (₹25.50 -> 2550 paise)', rate.s === 200 && rate.b.data.amountPaise === 2550 && rate.b.data.size === '10L');
  const gen = await j('/admin/rewards/barcodes/generate', { method: 'POST', body: JSON.stringify({ size: '10L', count: 3, label: 'http run' }) });
  ok('generate over HTTP returns codes once', gen.s === 201 && gen.b.data.codes.length === 3);
  const sum = await j('/admin/rewards/barcodes/summary');
  ok('summary groups by run', sum.s === 200 && sum.b.data.some((r: any) => r.batchLabel === 'http run' && r.total === 3 && r.ACTIVE === 3));
  const cl = await j('/admin/rewards/claims?status=PAID&limit=5');
  ok('claims list + pagination', cl.s === 200 && cl.b.data.length > 0 && cl.b.pagination.totalItems >= 6, `items=${cl.b.pagination?.totalItems}`);
  const srch = await j('/admin/rewards/claims?search=ramesh');
  ok('claims search by name', srch.s === 200 && srch.b.data.length > 0);
  const st = await j('/admin/rewards/stats');
  ok('stats', st.s === 200 && st.b.data.paid.count > 0 && st.b.data.stickers.ACTIVE >= 3 && st.b.data.provider === 'mock', JSON.stringify(st.b.data?.paid));
  const pn = await j('/admin/rewards/painters');
  ok('painters list with claim totals', pn.s === 200 && pn.b.data.some((x: any) => x.mobile === '9876543210' && x.claims === 2 && x.paidPaise === 6500));
  const chkp = await j(`/admin/rewards/claims/${p.claimId}/check`, { method: 'POST' });
  ok('admin "check status" on a non-PROCESSING claim -> 409', chkp.s === 409);
  const wrongRole = await fetch(url + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'dealer1', password: 'Dealer@123', role: 'dealer' }) });
  const dtok = (await wrongRole.json() as any).data?.accessToken;
  const forb = await fetch(url + '/admin/rewards/stats', { headers: { Authorization: `Bearer ${dtok}` } });
  ok('dealer cannot reach admin reward API -> 403', forb.status === 403);

  // ---------- painter HTTP: token -> check -> claim -> history
  const pt = { 'Content-Type': 'application/json', Authorization: `Bearer ${signPainterToken('9811111111')}` };
  const hc = await fetch(url + '/rewards/check', { method: 'POST', headers: pt, body: JSON.stringify({ code: gen.b.data.codes[0].code }) });
  const hcj: any = await hc.json();
  ok('HTTP check', hc.status === 200 && hcj.data.amountPaise === 2550);
  const hcl = await fetch(url + '/rewards/claim', { method: 'POST', headers: pt, body: JSON.stringify({ code: gen.b.data.codes[0].code, name: 'Suresh', city: 'Nagpur', upiId: 'suresh@ybl' }) });
  const hclj: any = await hcl.json();
  ok('HTTP claim -> PAID', hcl.status === 201 && hclj.data.status === 'PAID' && hclj.data.amountPaise === 2550, hclj.data?.message);
  const hh = await fetch(url + '/rewards/claims', { headers: pt });
  const hhj: any = await hh.json();
  ok('HTTP history', hh.status === 200 && hhj.data.length === 1 && hhj.totalPaidPaise === 2550);

  server.close();
  await disconnectDb();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
