import type { Request, Response } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { env, isProd } from '../config/env';
import { Painter, type IPainter } from '../models/Painter';
import { PainterOtp } from '../models/PainterOtp';
import { nextSeq } from '../models/Counter';
import { nextPainterId } from '../utils/ids';
import {
  signPainterAccessToken,
  signPainterRefreshToken,
  verifyPainterRefreshToken,
  PAINTER_REFRESH_COOKIE,
} from '../utils/painterJwt';
import { sendOtpSms } from '../services/sms.service';
import { audit } from '../services/audit.service';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/painters',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function hashOtp(mobile: string, otp: string): string {
  return crypto.createHmac('sha256', env.QR_SIGNING_SECRET).update(`painter:${mobile}:${otp}`).digest('hex');
}
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** What the painter app may see of its own account (no internals like tokenVersion / ledgerSeq). */
function publicProfile(p: Pick<IPainter, 'id' | 'name' | 'mobile' | 'city' | 'state' | 'experience' | 'painterType' | 'upiId' | 'upiUpdatedAt' | 'status' | 'createdAt'>) {
  return {
    id: p.id,
    name: p.name,
    mobile: p.mobile,
    city: p.city,
    state: p.state,
    experience: p.experience,
    painterType: p.painterType,
    upiId: p.upiId,
    upiUpdatedAt: p.upiUpdatedAt,
    status: p.status,
    createdAt: p.createdAt,
  };
}

function issueTokens(res: Response, painter: { id: string; tokenVersion: number }): string {
  const accessToken = signPainterAccessToken({ sub: painter.id, tv: painter.tokenVersion });
  const refreshToken = signPainterRefreshToken({ sub: painter.id, tv: painter.tokenVersion });
  res.cookie(PAINTER_REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTS);
  return accessToken;
}

/** Step 1 of login/registration: send a 6-digit OTP to the mobile. Same response whether or not the number is registered. */
export const sendPainterOtp = asyncHandler(async (req: Request, res: Response) => {
  const { mobile } = req.body as { mobile: string };

  const prior = await PainterOtp.findOne({ mobile }).select('requestedAt').lean();
  if (prior && Date.now() - prior.requestedAt.getTime() < OTP_RESEND_MS) {
    throw ApiError.tooMany('Please wait 30 seconds before requesting another OTP.');
  }
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

/** Step 2: verify the OTP. Existing painter -> logged in. New mobile -> needs name (+city) first, then registered + logged in. */
export const verifyPainterOtp = asyncHandler(async (req: Request, res: Response) => {
  const { mobile, otp, name, city, state, experience, painterType } = req.body as {
    mobile: string; otp: string; name?: string; city?: string; state?: string; experience?: string; painterType?: string;
  };

  const record = await PainterOtp.findOne({ mobile });
  if (!record || record.expiresAt.getTime() < Date.now()) throw ApiError.badRequest('OTP expired or not requested. Please request a new one.');

  const bumped = await PainterOtp.findOneAndUpdate({ _id: record._id, attempts: { $lt: OTP_MAX_ATTEMPTS } }, { $inc: { attempts: 1 } }, { new: true });
  if (!bumped) {
    await PainterOtp.deleteOne({ _id: record._id });
    throw ApiError.tooMany('Too many incorrect attempts. Please request a new OTP.');
  }
  if (!safeEqualHex(record.codeHash, hashOtp(mobile, otp))) throw ApiError.badRequest('Incorrect OTP.');

  let painter = await Painter.findOne({ mobile });
  if (painter?.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked. Please contact support.');

  // New number without a profile yet: keep the OTP valid and ask the app for the details.
  if (!painter && !name) {
    await PainterOtp.updateOne({ _id: record._id }, { $inc: { attempts: -1 } });
    return res.json({ success: true, data: { needsProfile: true } });
  }

  // Single use: a replayed verify finds nothing to delete.
  const consumed = await PainterOtp.findOneAndDelete({ _id: record._id, codeHash: record.codeHash });
  if (!consumed) throw ApiError.badRequest('This OTP has already been used.');

  let isNew = false;
  if (!painter) {
    // Retry on an id collision (e.g. ids already used by older data); a mobile collision means another tab just registered it.
    for (let attempt = 0; attempt < 5 && !painter; attempt++) {
      try {
        painter = await Painter.create({
          id: nextPainterId(await nextSeq('painter')),
          name: name as string,
          mobile,
          city: city ?? '',
          state: state ?? '',
          experience: experience ?? '',
          painterType: painterType || 'Painter',
        });
        isNew = true;
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
        painter = await Painter.findOne({ mobile });
      }
    }
  }
  if (!painter) throw ApiError.internal('Could not create the account.');

  painter.lastLoginAt = new Date();
  await painter.save();
  if (isNew) await audit({ action: 'PAINTER_REGISTERED', actorType: 'PAINTER', actorId: painter.id, refType: 'PAINTER', refId: painter.id, ip: req.ip ?? null });

  const accessToken = issueTokens(res, { id: painter.id, tokenVersion: painter.tokenVersion });
  res.status(isNew ? 201 : 200).json({ success: true, data: { painter: publicProfile(painter), accessToken, isNew } });
});

export const refreshPainter = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[PAINTER_REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No refresh token provided.');
  let payload;
  try {
    payload = verifyPainterRefreshToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token.');
  }
  const painter = await Painter.findOne({ id: payload.sub });
  if (!painter || painter.tokenVersion !== payload.tv || painter.status === 'BLOCKED') throw ApiError.unauthorized('Session no longer valid.');
  const accessToken = issueTokens(res, { id: painter.id, tokenVersion: painter.tokenVersion });
  res.json({ success: true, data: { accessToken, painter: publicProfile(painter) } });
});

export const logoutPainter = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[PAINTER_REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyPainterRefreshToken(token);
      await Painter.updateOne({ id: payload.sub, tokenVersion: payload.tv }, { $inc: { tokenVersion: 1 } });
    } catch {
      // nothing to revoke
    }
  }
  const { maxAge: _maxAge, ...clearOpts } = REFRESH_COOKIE_OPTS;
  res.clearCookie(PAINTER_REFRESH_COOKIE, clearOpts);
  res.json({ success: true, data: { loggedOut: true } });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const painter = await Painter.findOne({ id: req.painter!.id }).lean();
  if (!painter) throw ApiError.unauthorized();
  res.json({ success: true, data: publicProfile(painter as IPainter) });
});

export const updateUpi = asyncHandler(async (req: Request, res: Response) => {
  const { upiId } = req.body as { upiId: string };
  const before = await Painter.findOne({ id: req.painter!.id }).select('upiId').lean();
  if (before && before.upiId === upiId) {
    const same = await Painter.findOne({ id: req.painter!.id }).lean();
    return res.json({ success: true, data: publicProfile(same as IPainter) });
  }
  const painter = await Painter.findOneAndUpdate({ id: req.painter!.id }, { $set: { upiId, upiUpdatedAt: new Date() } }, { new: true }).lean();
  if (!painter) throw ApiError.unauthorized();
  await audit({ action: 'UPI_CHANGED', actorType: 'PAINTER', actorId: painter.id, refType: 'PAINTER', refId: painter.id, meta: { from: before?.upiId ?? '', to: upiId }, ip: req.ip ?? null });
  res.json({ success: true, data: publicProfile(painter as IPainter) });
});
