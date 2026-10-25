import { Schema, model } from 'mongoose';

export interface IPainterOtp {
  mobile: string;
  /** HMAC of the OTP - the plain code is never stored. */
  codeHash: string;
  attempts: number;
  requestedAt: Date;
  expiresAt: Date;
}

const schema = new Schema<IPainterOtp>(
  {
    mobile: { type: String, required: true, unique: true, index: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    requestedAt: { type: Date, required: true },
    // TTL index; expiry is also checked in code because autoIndex is off in production.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export const PainterOtp = model<IPainterOtp>('PainterOtp', schema);
