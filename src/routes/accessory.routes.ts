import { Router } from 'express';
import * as ctrl from '../controllers/accessory.controller';
import { validate } from '../middleware/validate';
import { addAccessorySchema, updateAccessorySchema, skuParamSchema, stockQtySchema } from '../validators/accessory.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, validate({ query: paginationQuerySchema }), ctrl.listAccessories);
router.post('/', requireAuth, requireRole('admin'), validate({ body: addAccessorySchema }), ctrl.addAccessoryItem);
router.put('/:sku', requireAuth, requireRole('admin'), validate({ params: skuParamSchema, body: updateAccessorySchema }), ctrl.updateAccessoryItem);
router.post(
  '/:sku/stock-in',
  requireAuth,
  requireRole('admin', 'warehouse'),
  validate({ params: skuParamSchema, body: stockQtySchema }),
  ctrl.stockInAccessory
);
router.post(
  '/:sku/sell',
  requireAuth,
  requireRole('admin', 'dealer', 'warehouse'),
  validate({ params: skuParamSchema, body: stockQtySchema }),
  ctrl.sellAccessory
);

export default router;
