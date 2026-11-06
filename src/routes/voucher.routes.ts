import { Router } from 'express';
import * as ctrl from '../controllers/voucher.controller';
import { validate } from '../middleware/validate';
import { sendOtpSchema, redeemVoucherSchema } from '../validators/voucher.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { dealerNameParamSchema } from '../validators/dealer.validators';
import { requireAuth, requireRole, enforceOwnDealer } from '../middleware/auth';
import { otpRateLimiter } from '../middleware/rateLimiters';

const router = Router();

router.post('/send-otp', requireAuth, requireRole('dealer'), otpRateLimiter, validate({ body: sendOtpSchema }), ctrl.sendVoucherOtp);
router.post('/redeem', requireAuth, requireRole('dealer'), validate({ body: redeemVoucherSchema }), ctrl.redeemVoucher);
router.get(
  '/:dealer',
  requireAuth,
  enforceOwnDealer('params'),
  requireRole('admin', 'dealer'),
  validate({ params: dealerNameParamSchema, query: paginationQuerySchema }),
  ctrl.listVouchers
);

export default router;
