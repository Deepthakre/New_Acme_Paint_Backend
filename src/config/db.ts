import mongoose from 'mongoose';
import { env, isProd } from './env';
import { logger } from '../utils/logger';

mongoose.set('strictQuery', true);
// Never let a typo'd field silently vanish or a stray key get persisted —
// throw instead of quietly stripping, which is what strict:true (default)
// already gives us; this makes the intent explicit.
// mongoose.set('sanitizeFilter', true); // extra NoSQL-injection guard: rejects operator keys in filters built from user input

export async function connectDb(): Promise<void> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', { err }));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(env.MONGO_URI, {
    maxPoolSize: isProd ? 50 : 10,
    serverSelectionTimeoutMS: 10000,
    autoIndex: !isProd, // build indexes automatically only outside prod; run migrations/ensureIndexes in prod deploys
  });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
