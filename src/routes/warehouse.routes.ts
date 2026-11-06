import { Router } from 'express';
import * as ctrl from '../controllers/warehouse.controller';
import { validate } from '../middleware/validate';
import {
  qrRefSchema,
  qrParamSchema,
  dispatchByQuantitySchema,
  confirmScanDispatchSchema,
  confirmReceiptSchema,
  forceConfirmSchema,
} from '../validators/warehouse.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { requireAuth, requireRole, optionalAuth, enforceOwnDealer } from '../middleware/auth';

const router = Router();

// Product lookup is used by several roles (dealer scanning stock, warehouse
// scanning shipments) so it only requires auth, not a specific role.
router.get('/products', requireAuth, requireRole('admin', 'warehouse'), validate({ query: paginationQuerySchema }), ctrl.listProducts);
router.get('/products/full-log', requireAuth, requireRole('admin', 'warehouse'), validate({ query: paginationQuerySchema }), ctrl.getFullProductLog);
router.get('/products/:qr', optionalAuth, validate({ params: qrParamSchema }), ctrl.getProductByQr);

router.post('/products/activate', requireAuth, requireRole('admin'), validate({ body: qrRefSchema }), ctrl.activateScan);
router.post('/products/:qr/deactivate', requireAuth, requireRole('admin'), validate({ params: qrParamSchema }), ctrl.deactivateProduct);

router.get('/dispatch/overview', requireAuth, requireRole('admin', 'warehouse'), ctrl.getDispatchOverview);
router.post('/dispatch/by-quantity', requireAuth, requireRole('admin', 'warehouse'), validate({ body: dispatchByQuantitySchema }), ctrl.dispatchByQuantity);
router.post('/dispatch/scan', requireAuth, requireRole('admin', 'warehouse'), validate({ body: qrRefSchema }), ctrl.addDispatchScan);
router.post(
  '/dispatch/confirm-scan',
  requireAuth,
  requireRole('admin', 'warehouse'),
  validate({ body: confirmScanDispatchSchema }),
  ctrl.confirmScanDispatch
);

router.post('/receive/confirm', requireAuth, requireRole('dealer'), enforceOwnDealer('body'), validate({ body: confirmReceiptSchema }), ctrl.confirmReceipt);
router.get('/receive/shortages', requireAuth, requireRole('admin', 'warehouse'), validate({ query: paginationQuerySchema }), ctrl.getShortages);
router.get(
  '/receive/pending-deliveries',
  requireAuth,
  requireRole('admin', 'warehouse'),
  validate({ query: paginationQuerySchema }),
  ctrl.getPendingDeliveries
);
router.post('/receive/force-confirm', requireAuth, requireRole('admin'), validate({ body: forceConfirmSchema }), ctrl.forceConfirmDelivery);

export default router;
