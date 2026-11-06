/**
 * Production runs with autoIndex OFF, so the new reward collections need their indexes built once:
 *
 *     npm run db:indexes
 *
 * The unique indexes (sticker code hash, one claim per sticker, one painter per mobile) are what make double-claims impossible.
 */
import '../config/dns';
import { connectDb, disconnectDb } from '../config/db';
import { Painter } from '../models/Painter';
import { RewardRate } from '../models/RewardRate';
import { RewardBarcode } from '../models/RewardBarcode';
import { RewardClaim } from '../models/RewardClaim';
import { PainterOtp } from '../models/PainterOtp';
import { AuditLog } from '../models/AuditLog';

async function main() {
  await connectDb();
  for (const m of [Painter, PainterOtp, RewardRate, RewardBarcode, RewardClaim, AuditLog]) {
    await m.syncIndexes();
    console.log(`indexes ready: ${m.collection.name}`);
  }
  await disconnectDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
