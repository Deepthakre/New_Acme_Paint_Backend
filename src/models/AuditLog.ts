import { Schema, model } from 'mongoose';

/** Immutable trail of every redeem / payout / admin action in the reward programme. */
export interface IAuditLog {
  action: string; // e.g. REWARD_REDEEMED, PAYOUT_REQUESTED, CAMPAIGN_CREATED
  actorType: 'PAINTER' | 'ADMIN' | 'SYSTEM' | 'WEBHOOK';
  actorId: string;
  refType: string;
  refId: string;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}

const schema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, index: true },
    actorType: { type: String, enum: ['PAINTER', 'ADMIN', 'SYSTEM', 'WEBHOOK'], required: true },
    actorId: { type: String, required: true, index: true },
    refType: { type: String, required: true },
    refId: { type: String, required: true, index: true },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog = model<IAuditLog>('AuditLog', schema);
