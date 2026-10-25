import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export type Role = 'admin' | 'warehouse' | 'dealer' | 'salesrep' | 'customer';
export const ROLES: Role[] = ['admin', 'warehouse', 'dealer', 'salesrep', 'customer'];

export interface IUser {
  username: string;
  passwordHash: string;
  role: Role;
  name: string;
  mobile?: string;
  // dealer-only
  businessName?: string;
  owner?: string;
  address?: string;
  // salesrep-only
  target?: number;
  dealers?: string[];
  // security
  tokenVersion: number;
  failedLoginAttempts: number;
  lockUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
  isLocked(): boolean;
}

export type UserDoc = HydratedDocument<IUser, IUserMethods>;

type UserModel = Model<IUser, Record<string, never>, IUserMethods>;

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true, minlength: 3, maxlength: 40 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    mobile: { type: String, trim: true, match: [/^\d{10}$/, 'Mobile number must be 10 digits'] },
    businessName: { type: String, trim: true, maxlength: 150 },
    owner: { type: String, trim: true, maxlength: 120 },
    address: { type: String, trim: true, maxlength: 300 },
    target: { type: Number, min: 0 },
    dealers: [{ type: String, trim: true }],
    tokenVersion: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.isLocked = function (): boolean {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

// Never leak the hash or lockout bookkeeping in API responses.
userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: any) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.failedLoginAttempts;
    delete ret.lockUntil;
    delete ret.tokenVersion;
    return ret;
  },
});

export const User = model<IUser, UserModel>('User', userSchema);
