/**
 * One-off cleanup after replacing the OLD reward module (campaigns / wallet ledger / payouts / fraud flags ...).
 *
 *   npx tsx src/seed/dropOldRewardData.ts            -> REPORT ONLY (safe). Shows any money the old system still owes painters.
 *   npx tsx src/seed/dropOldRewardData.ts --confirm  -> DROPS the old collections.
 *
 * Run the report first. If painters still have an unpaid wallet balance / pending payout in the OLD system,
 * pay them first - the new module does not import old balances.
 */
import '../config/dns';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db';

const OLD = ['rewardcodes', 'walletledgers', 'payouts', 'campaigns', 'fraudflags', 'adminnotifications', 'rewards', 'withdrawals'];

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const names = (await db.listCollections().toArray()).map((c) => c.name);

  console.log('Old collections found:');
  for (const n of OLD) if (names.includes(n)) console.log(`  ${n.padEnd(20)} ${await db.collection(n).countDocuments({})} documents`);

  if (names.includes('walletledgers')) {
    const rows = await db
      .collection('walletledgers')
      .aggregate([
        { $match: { account: { $regex: '^PAINTER:' } } },
        { $group: { _id: '$direction', total: { $sum: '$amountPaise' } } },
      ])
      .toArray();
    const credit = rows.find((r) => r._id === 'CREDIT')?.total ?? 0;
    const debit = rows.find((r) => r._id === 'DEBIT')?.total ?? 0;
    console.log(`\nOLD wallets still hold: Rs ${(credit - debit) / 100}  <-- pay this out before dropping`);
  }
  if (names.includes('payouts')) {
    const pending = await db.collection('payouts').countDocuments({ status: { $in: ['PENDING', 'PROCESSING'] } });
    console.log(`OLD payouts still pending: ${pending}`);
  }

  if (!process.argv.includes('--confirm')) {
    console.log('\nRead-only run. Settle the amounts above, then re-run with --confirm to drop the old collections.');
  } else {
    for (const n of OLD) if (names.includes(n)) await db.collection(n).drop();
    console.log('\nOld reward collections dropped. (The "painters" and "auditlogs" collections are kept - the new module reuses them.)');
  }
  await disconnectDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
