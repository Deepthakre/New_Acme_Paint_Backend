import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema } from '../validators/auth.validators';
import { loginRateLimiter, registerRateLimiter } from '../middleware/rateLimiters';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Rate-limited, per the brief: brute-force protection on the login page.
router.post('/login', loginRateLimiter, validate({ body: loginSchema }), ctrl.login);
router.post('/register', registerRateLimiter, validate({ body: registerSchema }), ctrl.register);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.get('/me', requireAuth, ctrl.me);

router.get('/dealers/known-names', requireAuth, ctrl.listKnownDealerNames);
router.get('/dealers/:name/profile', requireAuth, ctrl.getDealerProfile);
router.get('/salesreps/:name', requireAuth, ctrl.getSalesRep);

export default router;
