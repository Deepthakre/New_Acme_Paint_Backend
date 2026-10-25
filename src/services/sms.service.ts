import { isProd } from '../config/env';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/ApiError';

/**
 * Delivers an OTP by SMS. Plug your provider (Twilio, MSG91, ...) in here.
 * In development the code is logged so the flow can be tested end to end.
 * In production with no provider configured it fails loudly instead of
 * pretending the SMS was sent.
 */
export async function sendOtpSms(mobile: string, otp: string): Promise<void> {
  if (!isProd) {
    logger.info(`[DEV OTP] ${mobile}: ${otp}`);
    return;
  }
  // TODO: call your SMS provider here and return on success.
  throw ApiError.internal('SMS delivery is not configured on this server.');
}
