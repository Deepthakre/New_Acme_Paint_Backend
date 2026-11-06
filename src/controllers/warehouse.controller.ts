import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Product } from '../models/Product';
import { Carton } from '../models/Carton';
import { Batch } from '../models/Batch';
import { extractScannedId } from '../utils/ids';
import { generateInvoiceForUnits, nowStr } from '../services/invoice.service';
import { parsePagination, paginate } from '../utils/pagination';

function nowTs(): number {
  return Date.now();
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.batchId) filter.batchId = req.query.batchId;
  if (req.query.holder) filter.holder = req.query.holder;
  if (req.query.active !== undefined) filter.active = req.query.active === 'true';

  // Free-text search over QR / batch / product name (case-insensitive, contains).
  // The term is regex-escaped and length-capped so user input can't inject a pattern.
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 60) : '';
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ qr: rx }, { batchId: rx }, { product: rx }];
  }

  const result = await paginate(Product.find(filter), Product.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

export const getProductByQr = asyncHandler(async (req: Request, res: Response) => {
  const id = extractScannedId(req.params.qr);
  const p = await Product.findOne({ qr: id }).lean();
  res.json({ success: true, data: p ? { qr: p.qr, product: p.product, size: p.size, status: p.status, holder: p.holder } : null });
});

// ---------- ACTIVATION ----------
export const activateScan = asyncHandler(async (req: Request, res: Response) => {
  const raw = extractScannedId(req.body.qr);
  const isCartonRef = raw.startsWith('CTN-');

  if (isCartonRef) {
    const carton = await Carton.findOne({ id: raw }).lean();
    if (!carton) throw ApiError.badRequest('Unknown carton QR.');
    const items = await Product.find({ qr: { $in: carton.qrList } });
    const toActivate = items.filter((p) => !p.active);
    await Promise.all(
      toActivate.map((p) => {
        p.active = true;
        p.log.push({ event: 'ACTIVATED — ready for dispatch', who: req.user?.username || 'Manufacturer', time: nowStr() });
        return p.save();
      })
    );
    return res.json({
      success: true,
      data: { type: 'carton', id: carton.id, activated: toActivate.map((p) => p.qr), alreadyActive: items.length - toActivate.length },
    });
  }

  const product = await Product.findOne({ qr: raw });
  if (!product) throw ApiError.badRequest('QR not recognized.');
  if (product.active) return res.json({ success: true, data: { type: 'single', activated: [], alreadyActive: 1 } });
  product.active = true;
  product.log.push({ event: 'ACTIVATED — ready for dispatch', who: req.user?.username || 'Manufacturer', time: nowStr() });
  await product.save();
  res.json({ success: true, data: { type: 'single', activated: [product.qr], alreadyActive: 0 } });
});

export const deactivateProduct = asyncHandler(async (req: Request, res: Response) => {
  const qr = extractScannedId(req.params.qr);
  const product = await Product.findOne({ qr });
  if (!product) throw ApiError.notFound('QR not recognized.');
  if (product.active) {
    product.active = false;
    product.log.push({ event: 'DEACTIVATED — reverted to inactive', who: req.user?.username || 'Manufacturer', time: nowStr() });
    await product.save();
  }
  res.json({ success: true, data: product.toJSON() });
});

// ---------- DISPATCH ----------
export const getDispatchOverview = asyncHandler(async (_req: Request, res: Response) => {
  const batches = await Batch.find().lean();
  const overview = await Promise.all(
    batches.map(async (b) => {
      const total = await Product.countDocuments({ batchId: b.id });
      const dispatched = await Product.countDocuments({ batchId: b.id, status: { $ne: 'FACTORY' } });
      const undispatched = total - dispatched;
      let dispatchStatus: 'NOT_DISPATCHED' | 'PARTIALLY_DISPATCHED' | 'FULLY_DISPATCHED' = 'NOT_DISPATCHED';
      if (dispatched > 0 && undispatched === 0) dispatchStatus = 'FULLY_DISPATCHED';
      else if (dispatched > 0) dispatchStatus = 'PARTIALLY_DISPATCHED';
      return { batchId: b.id, product: b.product, size: b.size, mrp: b.mrp, total, dispatched, undispatched, dispatchStatus };
    })
  );
  res.json({ success: true, data: overview });
});

export const dispatchByQuantity = asyncHandler(async (req: Request, res: Response) => {
  const { batchId, qty, dealer } = req.body;
  const available = await Product.find({ batchId, status: 'FACTORY', active: true }).limit(qty);
  if (available.length < qty) {
    const inactiveCount = await Product.countDocuments({ batchId, status: 'FACTORY', active: false });
    throw ApiError.badRequest(
      `Only ${available.length} activated unit(s) available in that batch.` +
        (inactiveCount ? ` ${inactiveCount} more exist but haven't been activated yet.` : '')
    );
  }
  const time = nowStr();
  const ts = nowTs();
  await Promise.all(
    available.map((p) => {
      p.status = 'TRANSIT';
      p.holder = dealer;
      p.log.push({ event: `DISPATCHED to ${dealer}`, who: req.user?.username || 'Warehouse', time, ts });
      return p.save();
    })
  );
  res.json({ success: true, data: available.map((p) => p.qr) });
});

export const addDispatchScan = asyncHandler(async (req: Request, res: Response) => {
  const raw = extractScannedId(req.body.qr);
  const isCartonRef = raw.startsWith('CTN-');

  if (isCartonRef) {
    const carton = await Carton.findOne({ id: raw }).lean();
    if (!carton) throw ApiError.badRequest('Unknown carton QR.');
    const items = await Product.find({ qr: { $in: carton.qrList } }).lean();
    const notInFactory = items.filter((p) => p.status !== 'FACTORY');
    if (notInFactory.length) throw ApiError.badRequest(`Carton has ${notInFactory.length} unit(s) not in factory stock.`);
    const notActive = items.filter((p) => !p.active);
    if (notActive.length) throw ApiError.badRequest(`Carton has ${notActive.length} unit(s) not yet activated — activate the batch first.`);
    return res.json({ success: true, data: { type: 'carton', id: carton.id, qrs: carton.qrList } });
  }

  const product = await Product.findOne({ qr: raw }).lean();
  if (!product) throw ApiError.badRequest('QR not recognized.');
  if (product.status !== 'FACTORY') throw ApiError.badRequest(`This unit is already ${product.status.toLowerCase()}, not in factory stock.`);
  if (!product.active) throw ApiError.badRequest('This unit has not been activated yet — activate it first.');
  res.json({ success: true, data: { type: 'single', qrs: [product.qr] } });
});

export const confirmScanDispatch = asyncHandler(async (req: Request, res: Response) => {
  const { qrs, dealer } = req.body;
  const time = nowStr();
  const ts = nowTs();
  const products = await Product.find({ qr: { $in: qrs }, status: 'FACTORY' });
  await Promise.all(
    products.map((p) => {
      p.status = 'TRANSIT';
      p.holder = dealer;
      p.log.push({ event: `DISPATCHED to ${dealer} (scanned)`, who: req.user?.username || 'Warehouse', time, ts });
      return p.save();
    })
  );
  res.json({ success: true, data: products.map((p) => p.qr) });
});

// ---------- RECEIVE ----------
export const confirmReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { dealer, qrs } = req.body;
  const expected = await Product.find({ status: 'TRANSIT', holder: dealer });
  const receivedSet = new Set<string>(qrs);
  const received = expected.filter((p) => receivedSet.has(p.qr));
  const shortage = expected.filter((p) => !receivedSet.has(p.qr));
  const time = nowStr();
  const ts = nowTs();

  await Promise.all(
    received.map((p) => {
      p.status = 'DEALER';
      p.log.push({ event: `RECEIVED at ${dealer}`, who: dealer, time, ts });
      return p.save();
    })
  );
  await Promise.all(
    shortage.map((p) => {
      p.log.push({ event: 'NOT SCANNED AT RECEIPT — possible shortage', who: dealer, time, ts });
      return p.save();
    })
  );

  const invoice = await generateInvoiceForUnits({
    dealer,
    units: received.map((p) => ({ product: p.product, size: p.size, batchId: p.batchId })),
    note: `Invoice for stock receipt (${received.length} unit(s))`,
  });
  if (invoice) {
    await Product.updateMany({ qr: { $in: received.map((p) => p.qr) } }, { $set: { invoiceId: invoice.invoiceId } });
  }

  res.json({
    success: true,
    data: {
      received: received.map((p) => ({ qr: p.qr, product: p.product, size: p.size })),
      shortage: shortage.map((p) => ({ qr: p.qr, product: p.product, size: p.size })),
      invoice: invoice ? invoice.toJSON() : null,
    },
  });
});

export const getShortages = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { status: 'TRANSIT', 'log.event': { $regex: 'possible shortage' } };
  const result = await paginate(Product.find(filter), Product.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

export const getPendingDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter = { status: 'TRANSIT' };
  const [rows, totalItems] = await Promise.all([
    Product.find(filter).lean(),
    Product.countDocuments(filter),
  ]);

  const withDispatch = rows.map((p) => {
    const dispatchLog = [...p.log].reverse().find((l) => l.event.startsWith('DISPATCHED'));
    return { p, ts: dispatchLog?.ts || 0, dispatchLog };
  });
  withDispatch.sort((a, b) => a.ts - b.ts);

  const { page, limit } = params;
  const pageSlice = withDispatch.slice((page - 1) * limit, (page - 1) * limit + limit);

  const data = pageSlice.map(({ p, dispatchLog }) => ({
    qr: p.qr,
    product: p.product,
    size: p.size,
    batchId: p.batchId,
    dealer: p.holder,
    dispatchedAt: dispatchLog?.time || '—',
    duration: dispatchLog?.ts ? formatDuration(Date.now() - dispatchLog.ts) : '—',
    flaggedShortage: p.log.some((l) => l.event.includes('possible shortage')),
  }));

  const totalPages = Math.max(Math.ceil(totalItems / limit), 1);
  res.json({
    success: true,
    data,
    pagination: { page, limit, totalItems, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
  });
});

export const forceConfirmDelivery = asyncHandler(async (req: Request, res: Response) => {
  const { qrs } = req.body;
  const confirmedBy = req.user?.username || 'Manufacturer';
  const targets = await Product.find({ qr: { $in: qrs }, status: 'TRANSIT' });
  if (!targets.length) throw ApiError.badRequest('None of the selected units are still awaiting delivery confirmation.');

  const byDealer = new Map<string, typeof targets>();
  targets.forEach((p) => {
    if (!byDealer.has(p.holder)) byDealer.set(p.holder, []);
    byDealer.get(p.holder)!.push(p);
  });

  let firstInvoice: any = null;
  for (const [dealer, units] of byDealer) {
    const time = nowStr();
    const ts = nowTs();
    await Promise.all(
      units.map((p) => {
        const dispatchLog = [...p.log].reverse().find((l) => l.event.startsWith('DISPATCHED'));
        const duration = dispatchLog?.ts ? formatDuration(Date.now() - dispatchLog.ts) : 'unknown duration';
        p.status = 'DEALER';
        p.log.push({ event: `MARKED DELIVERED by manufacturer (dealer never scanned) — was in transit ${duration}`, who: confirmedBy, time, ts });
        return p.save();
      })
    );
    const invoice = await generateInvoiceForUnits({
      dealer,
      units: units.map((p) => ({ product: p.product, size: p.size, batchId: p.batchId })),
      note: `Invoice for manufacturer-confirmed delivery (${units.length} unit(s))`,
    });
    if (invoice) {
      await Product.updateMany({ qr: { $in: units.map((p) => p.qr) } }, { $set: { invoiceId: invoice.invoiceId } });
      if (!firstInvoice) firstInvoice = invoice;
    }
  }

  res.json({
    success: true,
    data: {
      received: targets.map((p) => ({ qr: p.qr, product: p.product, size: p.size })),
      shortage: [],
      invoice: firstInvoice ? firstInvoice.toJSON() : null,
    },
  });
});


const PRODUCT_STATUSES = ['FACTORY', 'TRANSIT', 'DEALER', 'SOLD', 'RETURNED'];

export const getFullProductLog = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = {};

  // Category filter — whitelisted so only real statuses ever reach the query.
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
  if (PRODUCT_STATUSES.includes(status)) filter.status = status;

  // Free-text search over QR / batch / product / holder (case-insensitive, contains).
  // The term is regex-escaped and length-capped so user input can't inject a pattern.
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 60) : '';
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ qr: rx }, { batchId: rx }, { product: rx }, { holder: rx }];
  }

  const result = await paginate(Product.find(filter), Product.countDocuments(filter), params);
  res.json({ success: true, ...result });
});
