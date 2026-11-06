import { Router } from 'express';
import * as ctrl from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { placeOrderSchema, decideOrderSchema, orderIdParamSchema } from '../validators/order.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { requireAuth, requireRole, enforceOwnDealer } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, requireRole('admin', 'dealer', 'salesrep'), enforceOwnDealer('query'), validate({ query: paginationQuerySchema }), ctrl.listOrders);
router.post('/', requireAuth, requireRole('dealer', 'salesrep'), enforceOwnDealer('body'), validate({ body: placeOrderSchema }), ctrl.placeOrder);
router.post(
  '/:orderId/decision',
  requireAuth,
  requireRole('admin'),
  validate({ params: orderIdParamSchema, body: decideOrderSchema }),
  ctrl.decideOrder
);

export default router;
