import { Router } from 'express';
import * as ctrl from '../controllers/painter.controller';
import { validate } from '../middleware/validate';
import { sendPainterOtpSchema, verifyPainterOtpSchema, updateUpiSchema } from '../validators/painter.validators';
import { requirePainter } from '../middleware/painterAuth';
import { painterOtpLimiter, painterAuthLimiter } from '../middleware/rateLimiters';

const router = Router();

// Painter login = mobile + OTP (no password). Registration happens on first successful verify.
router.post('/otp/send', painterOtpLimiter, validate({ body: sendPainterOtpSchema }), ctrl.sendPainterOtp);
router.post('/otp/verify', painterAuthLimiter, validate({ body: verifyPainterOtpSchema }), ctrl.verifyPainterOtp);
router.post('/refresh', painterAuthLimiter, ctrl.refreshPainter);
router.post('/logout', ctrl.logoutPainter);

router.get('/me', requirePainter, ctrl.getMe);
router.put('/me/upi', requirePainter, validate({ body: updateUpiSchema }), ctrl.updateUpi);

export default router;
