import { Router } from 'express';
import * as ctrl from '../controllers/dashboard.controller';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/stats', requireAuth, requireRole('admin', 'warehouse'), ctrl.getDashboardStats);

export default router;
