import { Batch } from '../models/Batch';
import { LedgerEntry, type IInvoiceLineItem } from '../models/LedgerEntry';
import { nextSeq } from '../models/Counter';
import { nextInvoiceId } from '../utils/ids';

export const GST_RATE = 0.18;

function now(): string {
  return new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Groups a set of just-received/confirmed units by product+size+mrp (the
 * MRP their batch was produced at) and raises one GST invoice covering all
 * of them — shared by confirmReceipt, forceConfirmDelivery, and
 * decideOrder so every path produces the exact same invoice shape that
 * the dealer/rep/manufacturer purchase-history views all read from.
 */
export async function generateInvoiceForUnits({
  dealer,
  units,
  note,
}: {
  dealer: string;
  units: Array<{ product: string; size: string; batchId: string }>;
  note: string;
}) {
  if (!units.length) return null;

  const batchIds = [...new Set(units.map((u) => u.batchId))];
  const batches = await Batch.find({ id: { $in: batchIds } }).lean();
  const mrpByBatch = new Map(batches.map((b) => [b.id, b.mrp]));

  const groups = new Map<string, IInvoiceLineItem>();
  units.forEach((u) => {
    const mrp = mrpByBatch.get(u.batchId) || 0;
    const key = `${u.product}|${u.size}|${mrp}`;
    if (!groups.has(key)) groups.set(key, { product: u.product, size: u.size, mrp, qty: 0 });
    groups.get(key)!.qty += 1;
  });

  const items = [...groups.values()];
  const subtotal = items.reduce((s, it) => s + it.mrp * it.qty, 0);
  if (subtotal <= 0) return null;

  const gst = Math.round(subtotal * GST_RATE * 100) / 100;
  const total = Math.round((subtotal + gst) * 100) / 100;
  const invoiceSeq = await nextSeq('invoice');
  const invoiceId = nextInvoiceId(invoiceSeq);

  const entry = await LedgerEntry.create({
    dealer,
    type: 'CHARGE',
    amount: total,
    note,
    subtotal,
    gst,
    gstRate: GST_RATE,
    items,
    invoiceId,
    date: now(),
  });

  return entry;
}

export function nowStr(): string {
  return now();
}
