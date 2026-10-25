import { WalletLedger } from '../models/WalletLedger';
import { Payout } from '../models/Payout';
import { RewardCode } from '../models/RewardCode';
import { Campaign } from '../models/Campaign';

/**
 * Daily reconciliation: proves the books agree with each other. Everything
 * here is READ-ONLY; it reports problems, it never "fixes" money silently.
 */
export async function reconcile() {
  const [totals, imbalanced, wallets, payoutAgg, stuck, campaigns, spendAgg, payoutDebits, payoutRefunds, payouts] = await Promise.all([
    WalletLedger.aggregate<{ _id: string; total: number }>([{ $group: { _id: '$direction', total: { $sum: '$amountPaise' } } }]),
    WalletLedger.aggregate<{ _id: string; credit: number; debit: number }>([
      {
        $group: {
          _id: '$txnId',
          credit: { $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amountPaise', 0] } },
          debit: { $sum: { $cond: [{ $eq: ['$direction', 'DEBIT'] }, '$amountPaise', 0] } },
        },
      },
      { $match: { $expr: { $ne: ['$credit', '$debit'] } } },
      { $limit: 20 },
    ]),
    WalletLedger.aggregate<{ _id: string; total: number }>([
      { $match: { account: { $regex: '^PAINTER:' } } },
      { $group: { _id: '$direction', total: { $sum: '$amountPaise' } } },
    ]),
    Payout.aggregate<{ _id: string; count: number; total: number }>([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
    Payout.find({ status: { $in: ['PENDING', 'PROCESSING'] }, createdAt: { $lt: new Date(Date.now() - 24 * 3_600_000) } })
      .select('id painterId amountPaise status createdAt')
      .limit(20)
      .lean(),
    Campaign.find().select('id name spentPaise budgetPaise').lean(),
    RewardCode.aggregate<{ _id: string; total: number }>([
      { $match: { status: { $in: ['REDEEMED', 'HELD'] }, campaignId: { $ne: null } } },
      { $group: { _id: '$campaignId', total: { $sum: '$amountPaise' } } },
    ]),
    WalletLedger.distinct('refId', { type: 'PAYOUT' }),
    WalletLedger.distinct('refId', { type: 'PAYOUT_REVERSAL' }),
    Payout.find().select('id status').lean(),
  ]);

  const sum = (rows: { _id: string; total: number }[], dir: string) => rows.find((r) => r._id === dir)?.total ?? 0;
  const totalCredit = sum(totals, 'CREDIT');
  const totalDebit = sum(totals, 'DEBIT');

  const hasDebit = new Set(payoutDebits as string[]);
  const hasRefund = new Set(payoutRefunds as string[]);
  const missingDebit = payouts.filter((p) => !hasDebit.has(p.id)).map((p) => p.id);
  const missingRefund = payouts.filter((p) => (p.status === 'FAILED' || p.status === 'REVERSED') && !hasRefund.has(p.id)).map((p) => p.id);

  const spendByCampaign = new Map(spendAgg.map((r) => [r._id, r.total]));
  const campaignDrift = campaigns
    .map((c) => ({ id: c.id, name: c.name, recordedSpentPaise: c.spentPaise, claimsTotalPaise: spendByCampaign.get(c.id) ?? 0 }))
    .filter((c) => c.recordedSpentPaise !== c.claimsTotalPaise);

  const problems =
    (totalCredit !== totalDebit ? 1 : 0) + imbalanced.length + missingDebit.length + missingRefund.length + campaignDrift.length;

  return {
    ok: problems === 0,
    ledgerBalanced: totalCredit === totalDebit,
    totalCreditPaise: totalCredit,
    totalDebitPaise: totalDebit,
    imbalancedTransactions: imbalanced,
    totalWalletLiabilityPaise: sum(wallets, 'CREDIT') - sum(wallets, 'DEBIT'),
    payoutsByStatus: payoutAgg.map((p) => ({ status: p._id, count: p.count, totalPaise: p.total })),
    stuckPayouts: stuck,
    payoutsMissingLedgerDebit: missingDebit,
    refundedPayoutsMissingLedgerCredit: missingRefund,
    campaignDrift,
    checkedAt: new Date().toISOString(),
  };
}
