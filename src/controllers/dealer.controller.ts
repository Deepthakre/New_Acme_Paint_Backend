import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Product } from '../models/Product';
import { LedgerEntry } from '../models/LedgerEntry';
import { Order } from '../models/Order';
import { User } from '../models/User';
import { parsePagination, paginate } from '../utils/pagination';
import { nowStr } from '../services/invoice.service';
import { handleBucketReturned } from '../services/reward.service';

export const getDealerStock = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { status: 'DEALER', holder: req.params.dealer };
  const result = await paginate(Product.find(filter), Product.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

export const getInvoiceById = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await LedgerEntry.findOne({ invoiceId: req.params.invoiceId }).lean();
  if (invoice && req.user?.role === 'dealer' && !req.user.dealerNames.includes(invoice.dealer)) {
    throw ApiError.forbidden('You can only access your own invoices.');
  }
  res.json({ success: true, data: invoice || null });
});

export const sellToCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { qr, dealer, customerName } = req.body;
  const p = await Product.findOne({ qr });
  if (!p) throw ApiError.notFound('QR not found.');
  if (p.status !== 'DEALER' || p.holder !== dealer) throw ApiError.badRequest('This unit is not in your dealer stock.');
  p.status = 'SOLD';
  p.log.push({ event: `SOLD to ${customerName || 'Walk-in Customer'}`, who: dealer, time: nowStr() });
  p.holder = customerName || 'Walk-in Customer';
  await p.save();
  res.json({ success: true, data: p.toJSON() });
});

export const processReturn = asyncHandler(async (req: Request, res: Response) => {
  const { qr, reason, condition, dealer } = req.body;
  const p = await Product.findOne({ qr });
  if (!p) throw ApiError.notFound('QR not found.');
  p.status = condition === 'resellable' ? 'DEALER' : 'RETURNED';
  p.holder = dealer;
  p.log.push({ event: `RETURNED (${reason}, ${condition})`, who: dealer, time: nowStr() });
  await p.save();
  // Cancels a not-yet-claimed inner reward (or flags an already-paid one for review).
  await handleBucketReturned(p.qr, condition === 'resellable');
  res.json({ success: true, data: p.toJSON() });
});

export const listKnownDealerNames = asyncHandler(async (_req: Request, res: Response) => {
  const [dealerUsers, dealerOrders] = await Promise.all([
    User.find({ role: 'dealer' }).select('businessName').lean(),
    Order.distinct('dealer'),
  ]);
  const names = new Set<string>();
  dealerUsers.forEach((u) => u.businessName && names.add(u.businessName));
  dealerOrders.forEach((d) => names.add(d));
  res.json({ success: true, data: [...names] });
});

async function computeDealerBalance(dealer: string) {
  const entries = await LedgerEntry.find({ dealer }).lean();
  const billed = entries.filter((l) => l.type === 'CHARGE').reduce((s, l) => s + l.amount, 0);
  const paid = entries.filter((l) => l.type === 'PAYMENT').reduce((s, l) => s + l.amount, 0);
  return { billed, paid, outstanding: billed - paid };
}

export const getDealerBalance = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await computeDealerBalance(req.params.dealer) });
});

export const getDealerPurchaseHistory = asyncHandler(async (req: Request, res: Response) => {
  const dealer = req.params.dealer;
  const [orders, ledger, balance] = await Promise.all([
    Order.find({ dealer }).sort('-createdAt').lean(),
    LedgerEntry.find({ dealer }).sort('-createdAt').lean(),
    computeDealerBalance(dealer),
  ]);
  const invoices = ledger.filter((l) => l.type === 'CHARGE');
  const payments = ledger.filter((l) => l.type === 'PAYMENT');

  const invoiceDatesAsc = invoices.map((i) => i.date).slice().reverse();
  const duration = invoiceDatesAsc.length
    ? { firstInvoiceDate: invoiceDatesAsc[0], lastInvoiceDate: invoiceDatesAsc[invoiceDatesAsc.length - 1], invoiceCount: invoices.length }
    : null;

  const rateHistory: Array<{ product: string; size: string; qty: number; mrp: number; invoiceId?: string; date: string }> = [];
  invoices.forEach((inv) => {
    (inv.items || []).forEach((it) => {
      rateHistory.push({ product: it.product, size: it.size, qty: it.qty, mrp: it.mrp, invoiceId: inv.invoiceId, date: inv.date });
    });
  });

  res.json({ success: true, data: { orders, ledger, invoices, payments, balance, duration, rateHistory } });
});

export const getAllDealersPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const dealerUsers = await User.find({ role: 'dealer' }).select('businessName').lean();
  const names = [...new Set(dealerUsers.map((u) => u.businessName).filter(Boolean))] as string[];

  const rows = await Promise.all(names.map(async (dealer) => ({ dealer, ...(await computeDealerBalance(dealer)) })));
  const { page, limit } = params;
  const start = (page - 1) * limit;
  const pageData = rows.slice(start, start + limit);
  const totalItems = rows.length;
  const totalPages = Math.max(Math.ceil(totalItems / limit), 1);

  res.json({
    success: true,
    data: pageData,
    pagination: { page, limit, totalItems, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
  });
});
