import { Router } from 'express';
import * as ctrl from '../controllers/reward.controller';
import { validate } from '../middleware/validate';
import { redeemRewardSchema } from '../validators/reward.validators';
import { requirePainter } from '../middleware/painterAuth';
import { redeemLimiter, redeemIpLimiter } from '../middleware/rateLimiters';

const router = Router();

// Scan the INNER QR. IP limiter (cheap, pre-auth) -> painter auth -> per-painter limiter -> redeem.
router.post('/redeem', redeemIpLimiter, requirePainter, redeemLimiter, validate({ body: redeemRewardSchema }), ctrl.redeemReward);

export default router;
