import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationQuerySchema } from '../validators/common.validators';
import {
  createCampaignSchema,
  updateCampaignSchema,
  resolveFlagSchema,
  markPaidSchema,
  markFailedSchema,
  painterStatusSchema,
  idParamSchema,
  batchIdBodySchema,
  productQrParamSchema,
  generateStickersSchema
} from '../validators/reward.validators';
import * as admin from '../controllers/rewardAdmin.controller';
import * as rewards from '../controllers/reward.controller';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Campaigns
router.get('/campaigns', validate({ query: paginationQuerySchema }), admin.listCampaigns);
router.post('/campaigns', validate({ body: createCampaignSchema }), admin.createCampaign);
router.patch('/campaigns/:id', validate({ params: idParamSchema, body: updateCampaignSchema }), admin.updateCampaign);

// Fraud flags / held rewards
router.get('/fraud-flags', validate({ query: paginationQuerySchema }), admin.listFraudFlags);
router.post('/fraud-flags/:id/resolve', validate({ params: idParamSchema, body: resolveFlagSchema }), admin.resolveFlag);

// Payouts
router.get('/payouts', validate({ query: paginationQuerySchema }), admin.listPayoutsAdmin);
router.post('/payouts/:id/mark-paid', validate({ params: idParamSchema, body: markPaidSchema }), admin.markPayoutPaid);
router.post('/payouts/:id/retry', validate({ params: idParamSchema }), admin.retryPayoutAdmin);
router.post('/payouts/:id/mark-failed', validate({ params: idParamSchema, body: markFailedSchema }), admin.markPayoutFailed);

// Notifications ("this painter just claimed money")
router.get('/notifications', validate({ query: paginationQuerySchema }), admin.listNotifications);
router.post('/notifications/read-all', admin.markNotificationsRead);

// Inner reward QR codes (printing)
router.post('/reward-codes/generate', validate({ body: generateStickersSchema }), rewards.generateBatchCodes);
router.get('/reward-codes/summary', rewards.codeSummary);
router.post('/reward-codes/:productQr/reissue', validate({ params: productQrParamSchema }), rewards.reissueBucketCode);

// Painters, redemptions, dashboard numbers, reconciliation
router.get('/painters', validate({ query: paginationQuerySchema }), admin.listPaintersAdmin);
router.post('/painters/:id/status', validate({ params: idParamSchema, body: painterStatusSchema }), admin.setPainterStatus);
router.get('/redemptions', validate({ query: paginationQuerySchema }), admin.listRedemptions);
router.get('/reward-stats', admin.rewardStats);
router.get('/reconcile', admin.runReconcile);

export default router;
