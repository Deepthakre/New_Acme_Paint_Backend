import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/webhook.controller';

const router = Router();

// Gateways retry; allow a generous burst but still cap abuse. Authenticity comes from the HMAC signature, not from this limiter.
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

router.post('/payout', webhookLimiter, ctrl.payoutWebhook);

export default router;
