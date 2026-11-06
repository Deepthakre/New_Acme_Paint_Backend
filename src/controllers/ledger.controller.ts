import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { LedgerEntry } from '../models/LedgerEntry';
import { nextSeq } from '../models/Counter';
import { nextInvoiceId } from '../utils/ids';
import { parsePagination, paginate } from '../utils/pagination';
import { nowStr } from '../services/invoice.service';

export const getLedgerForDealer = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { dealer: req.params.dealer };
  const result = await paginate(LedgerEntry.find(filter), LedgerEntry.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

export const getFullLedger = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const result = await paginate(LedgerEntry.find(), LedgerEntry.countDocuments(), params);
  res.json({ success: true, ...result });
});

export const recordCharge = asyncHandler(async (req: Request, res: Response) => {
  const { dealer, amount, note, subtotal, gst } = req.body;
  const invoiceSeq = await nextSeq('invoice');
  const entry = await LedgerEntry.create({
    dealer,
    type: 'CHARGE',
    amount,
    note,
    subtotal,
    gst,
    invoiceId: nextInvoiceId(invoiceSeq),
    date: nowStr(),
  });
  res.status(201).json({ success: true, data: entry.toJSON() });
});

export const recordPayment = asyncHandler(async (req: Request, res: Response) => {
  const { dealer, amount, note } = req.body;
  const entry = await LedgerEntry.create({ dealer, type: 'PAYMENT', amount, note: note || 'Payment', date: nowStr() });
  res.status(201).json({ success: true, data: entry.toJSON() });
});

export const getDealerBalance = asyncHandler(async (req: Request, res: Response) => {
  const entries = await LedgerEntry.find({ dealer: req.params.dealer }).lean();
  const billed = entries.filter((l) => l.type === 'CHARGE').reduce((s, l) => s + l.amount, 0);
  const paid = entries.filter((l) => l.type === 'PAYMENT').reduce((s, l) => s + l.amount, 0);
  res.json({ success: true, data: { billed, paid, outstanding: billed - paid } });
});
