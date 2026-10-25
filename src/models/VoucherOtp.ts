import { Schema, model } from 'mongoose';

export interface IVoucherOtp {
  userId: string;
  mobile: string;
  /** HMAC of the OTP — the plain code is never stored. */
  codeHash: string;
  attempts: number;
  expiresAt: Date;
}

const schema = new Schema<IVoucherOtp>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    mobile: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    // TTL index: Mongo removes the document once expiresAt passes. (Expiry is
    // also checked in code, because autoIndex is off in production.)
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export const VoucherOtp = model<IVoucherOtp>('VoucherOtp', schema);
