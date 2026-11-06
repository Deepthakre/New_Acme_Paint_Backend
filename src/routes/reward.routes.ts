import { Router } from 'express';
import * as ctrl from '../controllers/reward.controller';
import { validate } from '../middleware/validate';
import { requirePainterSession } from '../middleware/painterSession';
import { painterOtpLimiter, painterAuthLimiter, claimIpLimiter, claimLimiter } from '../middleware/rateLimiters';
import { sendOtpSchema, verifyOtpSchema, checkCodeSchema, claimSchema, retryClaimSchema, claimIdParamSchema, myClaimsQuerySchema } from '../validators/reward.validators';

const router = Router();

// Mobile verification (no password, no registration form - details are asked while claiming).
router.post('/otp/send', painterOtpLimiter, validate({ body: sendOtpSchema }), ctrl.sendOtp);
router.post('/otp/verify', painterAuthLimiter, validate({ body: verifyOtpSchema }), ctrl.verifyOtp);

// Everything below needs the short-lived token from /otp/verify. IP limiter first (cheap), then session, then per-mobile limiter.
router.post('/check', claimIpLimiter, requirePainterSession, claimLimiter, validate({ body: checkCodeSchema }), ctrl.check);
router.post('/claim', claimIpLimiter, requirePainterSession, claimLimiter, validate({ body: claimSchema }), ctrl.claim);
router.get('/claims', requirePainterSession, validate({ query: myClaimsQuerySchema }), ctrl.myClaims);
router.post('/claims/:id/retry', claimIpLimiter, requirePainterSession, claimLimiter, validate({ params: claimIdParamSchema, body: retryClaimSchema }), ctrl.retryClaim);

export default router;
