import { Router } from 'express';
import * as ctrl from '../controllers/wallet.controller';
import { validate } from '../middleware/validate';
import { withdrawSchema } from '../validators/reward.validators';
import { paginationQuerySchema } from '../validators/common.validators';
import { requirePainter } from '../middleware/painterAuth';
import { withdrawLimiter } from '../middleware/rateLimiters';

const router = Router();
router.use(requirePainter);

router.get('/', ctrl.getWallet);
router.get('/ledger', validate({ query: paginationQuerySchema }), ctrl.listMyLedger);
router.get('/payouts', validate({ query: paginationQuerySchema }), ctrl.listMyPayouts);
router.post('/withdraw', withdrawLimiter, validate({ body: withdrawSchema }), ctrl.withdraw);

export default router;
