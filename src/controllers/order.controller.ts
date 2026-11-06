import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Order, type IOrderItem } from '../models/Order';
import { LedgerEntry } from '../models/LedgerEntry';
import { nextSeq } from '../models/Counter';
import { nextOrderId, nextInvoiceId } from '../utils/ids';
import { parsePagination, paginate } from '../utils/pagination';
import { GST_RATE, nowStr } from '../services/invoice.service';

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = {};
  if (req.query.dealer) filter.dealer = req.query.dealer;
  if (req.query.status) filter.status = req.query.status;
  const result = await paginate(Order.find(filter), Order.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

function computeOrderTotals(items: IOrderItem[]) {
  const priced = items.filter((it) => it.mrp !== undefined && it.mrp !== null && Number(it.mrp) > 0);
  if (priced.length === 0) return { subtotal: null, gst: null, total: null };
  const subtotal = priced.reduce((s, it) => s + Number(it.mrp) * Number(it.qty), 0);
  const gst = Math.round(subtotal * GST_RATE * 100) / 100;
  const total = Math.round((subtotal + gst) * 100) / 100;
  return { subtotal, gst, total };
}

export const placeOrder = asyncHandler(async (req: Request, res: Response) => {
  const { dealer, items, bookedBy } = req.body;
  const orderSeq = await nextSeq('order');
  const { subtotal, gst, total } = computeOrderTotals(items);

  const order = await Order.create({
    id: nextOrderId(orderSeq),
    dealer,
    items: items.map((it: any) => ({
      product: it.product,
      size: it.size,
      qty: Number(it.qty),
      mrp: it.mrp !== undefined && it.mrp !== null ? Number(it.mrp) : null,
    })),
    subtotal,
    gst,
    total,
    status: 'PENDING',
    bookedBy: bookedBy || null,
    invoiceId: null,
    date: nowStr(),
  });

  res.status(201).json({ success: true, data: order.toJSON() });
});

export const decideOrder = asyncHandler(async (req: Request, res: Response) => {
  const { decision } = req.body;
  const order = await Order.findOne({ id: req.params.orderId });
  if (!order) throw ApiError.notFound('Order not found.');
  if (order.status !== 'PENDING') throw ApiError.conflict(`Order is already ${order.status.toLowerCase()}.`);

  order.status = decision === 'approve' ? 'DISPATCHED' : 'REJECTED';

  if (decision === 'approve' && order.total) {
    const invoiceSeq = await nextSeq('invoice');
    const invoiceId = nextInvoiceId(invoiceSeq);
    await LedgerEntry.create({
      dealer: order.dealer,
      type: 'CHARGE',
      amount: order.total,
      note: `Invoice for order ${order.id}`,
      subtotal: order.subtotal,
      gst: order.gst,
      gstRate: GST_RATE,
      items: order.items.map((it) => ({ product: it.product, size: it.size, mrp: it.mrp ?? 0, qty: it.qty })),
      invoiceId,
      orderId: order.id,
      date: nowStr(),
    });
    order.invoiceId = invoiceId;
  }

  await order.save();
  res.json({ success: true, data: order.toJSON() });
});
