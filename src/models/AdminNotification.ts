import { Schema, model } from 'mongoose';

export type NotificationType = 'REWARD_CLAIMED' | 'REWARD_HELD' | 'PAYOUT_PENDING' | 'PAYOUT_SUCCESS' | 'PAYOUT_FAILED';

/** In-app alert shown to admins in the dashboard ("this painter just took money"). Shared by all admins. */
export interface IAdminNotification {
  type: NotificationType;
  title: string;
  body: string;
  refType: string;
  refId: string;
  meta: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

const schema = new Schema<IAdminNotification>(
  {
    type: { type: String, enum: ['REWARD_CLAIMED', 'REWARD_HELD', 'PAYOUT_PENDING', 'PAYOUT_SUCCESS', 'PAYOUT_FAILED'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    refType: { type: String, default: '' },
    refId: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ createdAt: -1 });

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const AdminNotification = model<IAdminNotification>('AdminNotification', schema);
