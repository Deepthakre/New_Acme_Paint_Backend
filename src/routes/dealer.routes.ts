import { Router } from 'express';
import * as ctrl from '../controllers/dealer.controller';
import { validate } from '../middleware/validate';
import { sellToCustomerSchema, processReturnSchema, dealerNameParamSchema } from '../validators/dealer.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { requireAuth, requireRole, enforceOwnDealer } from '../middleware/auth';

const router = Router();

router.get(
  '/known-names',
  requireAuth,
  requireRole('admin', 'warehouse', 'salesrep'),
  ctrl.listKnownDealerNames
);
router.get(
  '/payment-status',
  requireAuth,
  requireRole('admin', 'salesrep'),
  validate({ query: paginationQuerySchema }),
  ctrl.getAllDealersPaymentStatus
);
router.get(
  '/:dealer/stock',
  requireAuth,
  enforceOwnDealer('params'),
  requireRole('admin', 'warehouse', 'dealer', 'salesrep'),
  validate({ params: dealerNameParamSchema, query: paginationQuerySchema }),
  ctrl.getDealerStock
);
router.get(
  '/:dealer/purchase-history',
  requireAuth,
  enforceOwnDealer('params'),
  requireRole('admin', 'dealer', 'salesrep'),
  validate({ params: dealerNameParamSchema }),
  ctrl.getDealerPurchaseHistory
);
router.get(
  '/:dealer/balance',
  requireAuth,
  enforceOwnDealer('params'),
  requireRole('admin', 'dealer', 'salesrep'),
  validate({ params: dealerNameParamSchema }),
  ctrl.getDealerBalance
);
router.get('/invoices/:invoiceId', requireAuth, requireRole('admin', 'dealer', 'salesrep'), ctrl.getInvoiceById);

router.post('/sell', requireAuth, requireRole('dealer'), enforceOwnDealer('body'), validate({ body: sellToCustomerSchema }), ctrl.sellToCustomer);
router.post('/return', requireAuth, requireRole('dealer'), enforceOwnDealer('body'), validate({ body: processReturnSchema }), ctrl.processReturn);

export default router;
