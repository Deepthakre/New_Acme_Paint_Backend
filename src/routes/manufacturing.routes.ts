import { Router } from 'express';
import * as ctrl from '../controllers/manufacturing.controller';
import { validate } from '../middleware/validate';
import { startBatchSchema, batchIdParamSchema, cartonIdParamSchema } from '../validators/manufacturing.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/batches', requireAuth, requireRole('admin', 'warehouse'), validate({ query: paginationQuerySchema }), ctrl.listBatches);
router.post('/batches', requireAuth, requireRole('admin'), validate({ body: startBatchSchema }), ctrl.startBatch);
router.get('/batches/activation-summary', requireAuth, requireRole('admin', 'warehouse'), ctrl.getBatchActivationSummary);
router.get(
  '/batches/:batchId/labels',
  requireAuth,
  requireRole('admin', 'warehouse'),
  validate({ params: batchIdParamSchema }),
  ctrl.getBatchLabels
);
router.get(
  '/cartons/:cartonId',
  requireAuth,
  requireRole('admin', 'warehouse'),
  validate({ params: cartonIdParamSchema }),
  ctrl.getCartonUnits
);

export default router;
