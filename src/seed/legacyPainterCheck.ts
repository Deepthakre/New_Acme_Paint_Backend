/**
 * One-off helper for moving from the OLD painter reward module (balance field on
 * the painter, `rewards` + `withdrawals` collections) to the new ledger-based one.
 *
 *   npx tsx src/seed/legacyPainterCheck.ts            -> report only (safe, read-only)
 *   npx tsx src/seed/legacyPainterCheck.ts --confirm  -> DROPS the legacy collections
 *
 * Run the report FIRST. If painters still hold an unpaid walletBalance, settle
 * those payments before dropping anything - the new system does not import old balances.
 */
import '../config/dns';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db';

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const names = (await db.listCollections().toArray()).map((c) => c.name);

  const painters = names.includes('painters') ? db.collection('painters') : null;
  const legacyPainters = painters ? await painters.countDocuments({ walletBalance: { $exists: true } }) : 0;
  const unpaid = painters
    ? await painters.aggregate([{ $match: { walletBalance: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$walletBalance' }, count: { $sum: 1 } } }]).toArray()
    : [];
  const rewards = names.includes('rewards') ? await db.collection('rewards').countDocuments({}) : 0;
  const withdrawals = names.includes('withdrawals') ? await db.collection('withdrawals').countDocuments({}) : 0;
  const pendingWd = names.includes('withdrawals') ? await db.collection('withdrawals').countDocuments({ status: 'PENDING' }) : 0;

  console.log('Legacy painter documents (old schema):', legacyPainters);
  console.log('Painters with unpaid wallet balance :', unpaid[0]?.count ?? 0, '=> Rs', unpaid[0]?.total ?? 0);
  console.log('Legacy reward records               :', rewards);
  console.log('Legacy withdrawals (pending)        :', withdrawals, `(${pendingWd})`);

  if (!process.argv.includes('--confirm')) {
    console.log('\nRead-only run. Settle any unpaid balances / pending withdrawals, then re-run with --confirm to drop the legacy data.');
  } else {
    if (legacyPainters && painters) await painters.drop();
    if (names.includes('rewards')) await db.collection('rewards').drop();
    if (names.includes('withdrawals')) await db.collection('withdrawals').drop();
    console.log('\nLegacy painter / rewards / withdrawals collections dropped.');
  }
  await disconnectDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
