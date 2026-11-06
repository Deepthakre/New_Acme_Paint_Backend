import { Router } from 'express';
import * as ctrl from '../controllers/catalog.controller';
import { validate } from '../middleware/validate';
import { catalogItemSchema, catalogItemUpdateSchema, itemCodeParamSchema } from '../validators/catalog.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, validate({ query: paginationQuerySchema }), ctrl.listCatalog);
router.post('/', requireAuth, requireRole('admin'), validate({ body: catalogItemSchema }), ctrl.addCatalogItem);
router.put(
  '/:itemCode',
  requireAuth,
  requireRole('admin'),
  validate({ params: itemCodeParamSchema, body: catalogItemUpdateSchema }),
  ctrl.updateCatalogItem
);
router.delete('/:itemCode', requireAuth, requireRole('admin'), validate({ params: itemCodeParamSchema }), ctrl.deleteCatalogItem);

export default router;
