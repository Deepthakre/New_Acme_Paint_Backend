import { Router } from 'express';
import * as ctrl from '../controllers/verify.controller';
import rateLimit from 'express-rate-limit';

const router = Router();

// Fully public (any consumer scanning a bucket), but rate-limited per IP
// since it's an unauthenticated endpoint that touches the database.
const verifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

router.get('/', verifyLimiter, ctrl.verifyProduct);
router.get('/:qrString', verifyLimiter, ctrl.verifyProduct);

export default router;
