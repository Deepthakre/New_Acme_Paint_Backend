import mongoose, { type ClientSession } from 'mongoose';
import { isProd } from '../config/env';
import { logger } from './logger';

function isTxnUnsupported(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null;
  return Boolean(e && (e.code === 20 || /Transaction numbers are only allowed|replica set/i.test(e.message || '')));
}

/**
 * Runs `fn` inside a MongoDB transaction (auto-retried on transient
 * conflicts). Money movement REQUIRES this, so production needs a replica
 * set (Atlas always is one).
 *
 * In development on a standalone local mongod (no replica set) there are no
 * transactions; we fall back to running without a session and log a warning
 * — never in production, where we fail loudly instead.
 */
export async function runInTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (!isProd && isTxnUnsupported(err)) {
      logger.warn('MongoDB transactions unavailable (standalone server) - running WITHOUT a transaction. Use a replica set in production.');
      return fn(undefined);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
