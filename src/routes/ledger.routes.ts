import { Router } from 'express';
import * as ctrl from '../controllers/ledger.controller';
import { validate } from '../middleware/validate';
import { recordChargeSchema, recordPaymentSchema } from '../validators/ledger.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { dealerNameParamSchema } from '../validators/dealer.validators';
import { requireAuth, requireRole, enforceOwnDealer } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, requireRole('admin'), validate({ query: paginationQuerySchema }), ctrl.getFullLedger);
router.get(
  '/:dealer',
  requireAuth,
  enforceOwnDealer('params'),
  requireRole('admin', 'dealer', 'salesrep'),
  validate({ params: dealerNameParamSchema, query: paginationQuerySchema }),
  ctrl.getLedgerForDealer
);
router.get(
  '/:dealer/balance',
  requireAuth,
  enforceOwnDealer('params'),
  requireRole('admin', 'dealer', 'salesrep'),
  validate({ params: dealerNameParamSchema }),
  ctrl.getDealerBalance
);
router.post('/charge', requireAuth, requireRole('admin'), validate({ body: recordChargeSchema }), ctrl.recordCharge);
router.post('/payment', requireAuth, requireRole('admin'), validate({ body: recordPaymentSchema }), ctrl.recordPayment);

export default router;
