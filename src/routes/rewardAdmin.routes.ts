import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as admin from '../controllers/rewardAdmin.controller';
import {
  setRateSchema,
  generateBarcodesSchema,
  voidBarcodeSchema,
  adminClaimsQuerySchema,
  adminPaintersQuerySchema,
  claimIdParamSchema,
  painterIdParamSchema,
  painterStatusSchema,
} from '../validators/reward.validators';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/stats', admin.stats);

// Reward amount per bucket size
router.get('/rates', admin.getRates);
router.put('/rates', validate({ body: setRateSchema }), admin.setRate);

// Stickers (barcodes): make, summary, cancel
router.post('/barcodes/generate', validate({ body: generateBarcodesSchema }), admin.generate);
router.get('/barcodes/summary', admin.summary);
router.post('/barcodes/void', validate({ body: voidBarcodeSchema }), admin.voidSticker);

// Claims = every reward claimed and its automatic UPI payout
router.get('/claims', validate({ query: adminClaimsQuerySchema }), admin.listClaims);
router.post('/claims/:id/retry', validate({ params: claimIdParamSchema }), admin.retryClaim);
router.post('/claims/:id/check', validate({ params: claimIdParamSchema }), admin.checkClaim);

// Painters
router.get('/painters', validate({ query: adminPaintersQuerySchema }), admin.listPainters);
router.post('/painters/:id/status', validate({ params: painterIdParamSchema, body: painterStatusSchema }), admin.setPainterStatus);

export default router;
