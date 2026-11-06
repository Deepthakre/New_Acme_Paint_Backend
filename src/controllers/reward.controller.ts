import type { Request, Response } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { Painter } from '../models/Painter';
import { PainterOtp } from '../models/PainterOtp';
import { sendOtpSms } from '../services/sms.service';
import { checkCode, claimReward, listClaimsForMobile, messageFor } from '../services/reward.service';
import { retryFailedClaim } from '../services/rewardPayout.service';
import { PAINTER_SESSION_SECONDS, signPainterToken } from '../utils/painterToken';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const hashOtp = (mobile: string, otp: string): string => crypto.createHmac('sha256', env.QR_SIGNING_SECRET).update(`painter:${mobile}:${otp}`).digest('hex');
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function deviceIdFrom(req: Request): string | null {
  const raw = req.headers['x-device-id'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

/** Step 1: send a 6-digit OTP to the painter's mobile. */
export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { mobile } = req.body as { mobile: string };

  const prior = await PainterOtp.findOne({ mobile }).select('requestedAt').lean();
  if (prior && Date.now() - prior.requestedAt.getTime() < OTP_RESEND_MS) throw ApiError.tooMany('Please wait 30 seconds before requesting another OTP.');
  const existing = await Painter.findOne({ mobile }).select('status').lean();
  if (existing?.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked. Please contact support.');

  const otp = String(crypto.randomInt(100000, 1000000));
  const now = new Date();
  await PainterOtp.findOneAndUpdate(
    { mobile },
    { mobile, codeHash: hashOtp(mobile, otp), attempts: 0, requestedAt: now, expiresAt: new Date(now.getTime() + OTP_TTL_MS) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  try {
    await sendOtpSms(mobile, otp);
  } catch (err) {
    await PainterOtp.deleteOne({ mobile });
    throw err;
  }
  res.json({ success: true, data: { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 } });
});

/** Step 2: verify the OTP -> a short-lived session token + the painter's saved details (to pre-fill the form). */
export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { mobile, otp } = req.body as { mobile: string; otp: string };

  const record = await PainterOtp.findOne({ mobile });
  if (!record || record.expiresAt.getTime() < Date.now()) throw ApiError.badRequest('OTP expired or not requested. Please request a new one.');

  const bumped = await PainterOtp.findOneAndUpdate({ _id: record._id, attempts: { $lt: OTP_MAX_ATTEMPTS } }, { $inc: { attempts: 1 } }, { new: true });
  if (!bumped) {
    await PainterOtp.deleteOne({ _id: record._id });
    throw ApiError.tooMany('Too many incorrect attempts. Please request a new OTP.');
  }
  if (!safeEqualHex(record.codeHash, hashOtp(mobile, otp))) throw ApiError.badRequest('Incorrect OTP.');

  // Single use: a replayed verify finds nothing to delete.
  const consumed = await PainterOtp.findOneAndDelete({ _id: record._id, codeHash: record.codeHash });
  if (!consumed) throw ApiError.badRequest('This OTP has already been used.');

  const painter = await Painter.findOne({ mobile }).select('name city upiId status').lean();
  if (painter?.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked. Please contact support.');

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      sessionToken: signPainterToken(mobile),
      expiresInSeconds: PAINTER_SESSION_SECONDS,
      painter: painter ? { name: painter.name, city: painter.city, upiId: painter.upiId } : null,
    },
  });
});

/** Step 3: "this sticker is worth ₹X" - before the painter types their details. */
export const check = asyncHandler(async (req: Request, res: Response) => {
  const result = await checkCode(req.body.code);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: result });
});

/** Step 4: claim. The money is sent to the UPI ID automatically. */
export const claim = asyncHandler(async (req: Request, res: Response) => {
  const outcome = await claimReward({
    mobile: req.painterMobile!,
    rawCode: req.body.code,
    name: req.body.name,
    city: req.body.city,
    upiId: req.body.upiId,
    ip: req.ip ?? null,
    deviceId: deviceIdFrom(req),
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ success: true, data: outcome });
});

/** The painter's own reward history. */
export const myClaims = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  const result = await listClaimsForMobile(req.painterMobile!, page, limit);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, ...result });
});

/** The payout failed (usually a wrong UPI ID): fix it and send again. */
export const retryClaim = asyncHandler(async (req: Request, res: Response) => {
  const c = await retryFailedClaim({ claimId: req.params.id, mobile: req.painterMobile!, upiId: req.body.upiId, ip: req.ip ?? null });
  res.json({
    success: true,
    data: { claimId: c.id, status: c.status, amountPaise: c.amountPaise, size: c.size, upiId: c.upiId, failureReason: c.failureReason, message: messageFor(c) },
  });
});
