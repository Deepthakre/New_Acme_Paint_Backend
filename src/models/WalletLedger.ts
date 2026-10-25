import { Schema, model } from 'mongoose';

export type LedgerDirection = 'CREDIT' | 'DEBIT';
export type LedgerEntryType = 'REWARD' | 'PAYOUT' | 'PAYOUT_REVERSAL' | 'ADJUSTMENT';

/**
 * APPEND-ONLY double-entry ledger. Every money movement is a balanced pair
 * (or more) of lines sharing a txnId: total CREDIT == total DEBIT.
 *   account 'PAINTER:<id>'          - a painter's wallet (liability)
 *   account 'SYSTEM:REWARD_EXPENSE' - reward programme spend
 *   account 'SYSTEM:PAYOUT_CLEARING'- money that left via UPI
 * A painter's balance = SUM(CREDIT) - SUM(DEBIT) on their account. There is
 * no update/delete path for this collection anywhere in the code; mistakes
 * are corrected with a new ADJUSTMENT/REVERSAL entry.
 */
export interface IWalletLedger {
  txnId: string;
  account: string;
  painterId: string | null;
  direction: LedgerDirection;
  amountPaise: number;
  type: LedgerEntryType;
  refType: string;
  refId: string;
  note: string;
  /** Unique per line - a retried request can never post the same movement twice. */
  idempotencyKey: string;
  createdAt: Date;
}

const schema = new Schema<IWalletLedger>(
  {
    txnId: { type: String, required: true, index: true },
    account: { type: String, required: true, index: true },
    painterId: { type: String, default: null, index: true },
    direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
    amountPaise: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => Number.isInteger(v) && v > 0, message: 'amountPaise must be a positive integer' },
    },
    type: { type: String, enum: ['REWARD', 'PAYOUT', 'PAYOUT_REVERSAL', 'ADJUSTMENT'], required: true, index: true },
    refType: { type: String, required: true },
    refId: { type: String, required: true },
    note: { type: String, default: '' },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ account: 1, createdAt: -1 });

schema.set('toJSON', {
  transform: (_d, ret: any) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const WalletLedger = model<IWalletLedger>('WalletLedger', schema);
