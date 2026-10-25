import { AdminNotification, type NotificationType } from '../models/AdminNotification';
import { logger } from '../utils/logger';

interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
}

/** Best-effort: a notification problem must never break a claim or a payout. */
export async function notifyAdmins(input: NotifyInput): Promise<void> {
  try {
    await AdminNotification.create({ ...input, refType: input.refType ?? '', refId: input.refId ?? '', meta: input.meta ?? {} });
    logger.info(`[ADMIN NOTIFY] ${input.title} - ${input.body}`);
  } catch (err) {
    logger.error('notifyAdmins failed', { err });
  }
}
