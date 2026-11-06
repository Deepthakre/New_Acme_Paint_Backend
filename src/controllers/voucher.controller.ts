import type { Request, Response } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Voucher } from '../models/Voucher';
import { VoucherOtp } from '../models/VoucherOtp';
import { User } from '../models/User';
import { nextSeq } from '../models/Counter';
import { nextVoucherId } from '../utils/ids';
import { parsePagination, paginate } from '../utils/pagination';
import { nowStr } from '../services/invoice.service';
import { sendOtpSms } from '../services/sms.service';
import { env } from '../config/env';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(userId: string, otp: string): string {
  return crypto.createHmac('sha256', env.QR_SIGNING_SECRET).update(`${userId}:${otp}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Sends a one-time code to the logged-in dealer's OWN registered mobile
 * (taken from the account, never from the request). Only a hash is stored,
 * it expires in 5 minutes, and a new request replaces any earlier code.
 */
export const sendVoucherOtp = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id).select('mobile');
  if (!user?.mobile) throw ApiError.badRequest('Add a mobile number to your account before redeeming vouchers.');

  const otp = String(crypto.randomInt(100000, 1000000));
  await VoucherOtp.findOneAndUpdate(
    { userId: req.user!.id },
    { userId: req.user!.id, mobile: user.mobile, codeHash: hashOtp(req.user!.id, otp), attempts: 0, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    await sendOtpSms(user.mobile, otp);
  } catch (err) {
    await VoucherOtp.deleteOne({ userId: req.user!.id });
    throw err;
  }

  res.json({ success: true, data: { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 } });
});

export const redeemVoucher = asyncHandler(async (req: Request, res: Response) => {
  const { code, discount, otp } = req.body as { code: string; discount: number; otp: string };
  const userId = req.user!.id;

  // Dealer identity and mobile come from the authenticated account, not the request body.
  const user = await User.findById(userId).select('name businessName mobile');
  if (!user) throw ApiError.unauthorized();
  const dealer = user.businessName || user.name;

  if (discount > env.VOUCHER_MAX_DISCOUNT) {
    throw ApiError.badRequest(`Discount cannot exceed ₹${env.VOUCHER_MAX_DISCOUNT} per voucher.`);
  }

  // ---- verify OTP (server-side, attempt-limited, single use) ----
  const record = await VoucherOtp.findOne({ userId });
  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('OTP expired or not requested. Please request a new one.');
  }
  const bumped = await VoucherOtp.findOneAndUpdate(
    { _id: record._id, attempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!bumped) {
    await VoucherOtp.deleteOne({ _id: record._id });
    throw ApiError.tooMany('Too many incorrect attempts. Please request a new OTP.');
  }
  if (!safeEqualHex(record.codeHash, hashOtp(userId, otp))) {
    throw ApiError.badRequest('Incorrect OTP.');
  }
  // Consume it atomically: a replayed request finds nothing to delete.
  const consumed = await VoucherOtp.findOneAndDelete({ _id: record._id, codeHash: record.codeHash });
  if (!consumed) throw ApiError.badRequest('This OTP has already been used.');

  const seq = await nextSeq('voucher');
  const voucher = await Voucher.create({
    id: nextVoucherId(seq),
    dealer,
    mobile: user.mobile ?? record.mobile,
    code,
    discount,
    status: 'REDEEMED',
    date: nowStr(),
  });
  res.status(201).json({ success: true, data: voucher.toJSON() });
});

export const listVouchers = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { dealer: req.params.dealer };
  const result = await paginate(Voucher.find(filter), Voucher.countDocuments(filter), params);
  res.json({ success: true, ...result });
});
