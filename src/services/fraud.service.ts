import type { ClientSession } from 'mongoose';
import { FraudFlag, type FraudFlagType } from '../models/FraudFlag';
import { nextSeq } from '../models/Counter';
import { nextFraudFlagId } from '../utils/ids';

interface FlagInput {
  type: FraudFlagType;
  painterId?: string | null;
  rewardCodeId?: string | null;
  productQr?: string | null;
  details: string;
}

/** Suspicious activity is put ON HOLD / flagged for a human - never silently auto-rejected. */
export async function raiseFlag(input: FlagInput, session?: ClientSession): Promise<void> {
  const seq = await nextSeq('fraudFlag');
  await FraudFlag.create(
    [
      {
        id: nextFraudFlagId(seq),
        type: input.type,
        painterId: input.painterId ?? null,
        rewardCodeId: input.rewardCodeId ?? null,
        productQr: input.productQr ?? null,
        details: input.details,
      },
    ],
    session ? { session } : undefined
  );
}

/** Same as raiseFlag but skips if an OPEN flag of this type already exists for the painter (avoids alert spam). */
export async function raiseFlagOnce(input: FlagInput): Promise<void> {
  const exists = await FraudFlag.exists({ type: input.type, painterId: input.painterId ?? null, status: 'OPEN' });
  if (!exists) await raiseFlag(input);
}
