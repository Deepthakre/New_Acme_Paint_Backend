import { Router } from 'express';
import authRoutes from './auth.routes';
import catalogRoutes from './catalog.routes';
import manufacturingRoutes from './manufacturing.routes';
import warehouseRoutes from './warehouse.routes';
import dealerRoutes from './dealer.routes';
import orderRoutes from './order.routes';
import ledgerRoutes from './ledger.routes';
import accessoryRoutes from './accessory.routes';
import rewardRoutes from './reward.routes';
import webhookRoutes from './webhook.routes';
import rewardAdminRoutes from './rewardAdmin.routes';
import voucherRoutes from './voucher.routes';
import dashboardRoutes from './dashboard.routes';
import verifyRoutes from './verify.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/catalog', catalogRoutes);
router.use('/manufacturing', manufacturingRoutes);
router.use('/warehouse', warehouseRoutes);
router.use('/dealers', dealerRoutes);
router.use('/orders', orderRoutes);
router.use('/ledger', ledgerRoutes);
router.use('/accessories', accessoryRoutes);
router.use('/rewards', rewardRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/admin/rewards', rewardAdminRoutes);
router.use('/vouchers', voucherRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/verify', verifyRoutes);

export default router;
