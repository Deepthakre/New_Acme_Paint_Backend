import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Batch } from '../models/Batch';
import { Carton } from '../models/Carton';
import { Product } from '../models/Product';
import { ProductCatalogItem } from '../models/ProductCatalogItem';
import { AccessoryItem } from '../models/AccessoryItem';
import { nextSeq, reserveSeqRange } from '../models/Counter';
import { nextBatchId, nextCartonId, nextProductId, signPayload } from '../utils/ids';
import { parsePagination, paginate } from '../utils/pagination';

function now(): string {
  return new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const listBatches = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = {};
  if (req.query.product) filter.product = req.query.product;
  const result = await paginate(Batch.find(filter), Batch.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

/**
 * Starts a manufacturing batch: mints every unit's QR server-side (the
 * client never invents product/carton IDs), signs each with the server-only
 * HMAC secret, and persists everything atomically-enough via reserved
 * counter ranges so two concurrent batch starts never collide on an ID.
 */
export const startBatch = asyncHandler(async (req: Request, res: Response) => {
  const { product, size, qty, qrMode, unitsPerCarton, manufacturingDate, mrp, batchNo, uspCode } = req.body;

  const batchSeq = await nextSeq('batch');
  const id = nextBatchId(batchSeq);
  const { start: startId, end: endId } = await reserveSeqRange('product', qty);

  const cartonRefs: string[] = [];
  const productDocs: any[] = [];
  const cartonDocs: any[] = [];

  if (qrMode === 'multi') {
    const perCarton = unitsPerCarton as number;
    const cartonCount = Math.ceil(qty / perCarton);
    let remaining = qty;
    let productSeq = startId;

    for (let c = 0; c < cartonCount; c++) {
      const cartonSeq = await nextSeq('carton');
      const cartonId = nextCartonId(cartonSeq);
      const unitsInThisCarton = Math.min(perCarton, remaining);
      const qrList: string[] = [];

      for (let i = 0; i < unitsInThisCarton; i++) {
        const qr = nextProductId(productSeq);
        productSeq += 1;
        const signed = signPayload(qr);
        productDocs.push({
          qr,
          qrString: signed.qrString,
          batchId: id,
          product,
          size,
          status: 'FACTORY',
          active: false,
          holder: 'Factory',
          cartonId,
          log: [{ event: 'PRODUCED (inactive — pending activation scan)', who: 'System', time: now() }],
        });
        qrList.push(qr);
      }
      const cartonSigned = signPayload(cartonId);
      cartonDocs.push({ id: cartonId, qrString: cartonSigned.qrString, batchId: id, product, size, unitsCount: unitsInThisCarton, qrList });
      cartonRefs.push(cartonId);
      remaining -= unitsInThisCarton;
    }
  } else {
    for (let seq = startId; seq <= endId; seq++) {
      const qr = nextProductId(seq);
      const signed = signPayload(qr);
      productDocs.push({
        qr,
        qrString: signed.qrString,
        batchId: id,
        product,
        size,
        status: 'FACTORY',
        active: false,
        holder: 'Factory',
        cartonId: null,
        log: [{ event: 'PRODUCED (inactive — pending activation scan)', who: 'System', time: now() }],
      });
    }
  }

  const [catalogItem, accItem] = await Promise.all([
    ProductCatalogItem.findOne({ name: product }).lean(),
    AccessoryItem.findOne({ name: product }).lean(),
  ]);

  const batch = await Batch.create({
    id,
    product,
    size,
    unit: catalogItem?.unit || (accItem ? 'Pcs' : 'L'),
    qty,
    qrMode,
    unitsPerCarton: qrMode === 'multi' ? unitsPerCarton : null,
    range: `${nextProductId(startId)} – ${nextProductId(endId)}`,
    date: now(),
    manufacturingDate,
    batchNo: batchNo || '',
    uspCode: uspCode || '',
    mrp: Number(mrp),
    cartonRefs,
  });

  if (cartonDocs.length) await Carton.insertMany(cartonDocs, { ordered: false });
  await Product.insertMany(productDocs, { ordered: false });

  res.status(201).json({ success: true, data: batch.toJSON() });
});

export const getBatchLabels = asyncHandler(async (req: Request, res: Response) => {
  const batch = await Batch.findOne({ id: req.params.batchId }).lean();
  if (!batch) throw ApiError.notFound('Batch not found');

  if (batch.qrMode === 'multi') {
    const cartons = await Carton.find({ batchId: batch.id }).lean();
    return res.json({ success: true, data: { mode: 'multi', batch, cartons } });
  }
  const items = await Product.find({ batchId: batch.id }).lean();
  res.json({ success: true, data: { mode: 'single', batch, items } });
});

export const getCartonUnits = asyncHandler(async (req: Request, res: Response) => {
  const carton = await Carton.findOne({ id: req.params.cartonId }).lean();
  if (!carton) throw ApiError.notFound('Carton not found.');
  const items = await Product.find({ qr: { $in: carton.qrList } }).lean();
  res.json({ success: true, data: { carton, items } });
});

export const getBatchActivationSummary = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Product.aggregate([
    {
      $group: {
        _id: '$batchId',
        total: { $sum: 1 },
        active: { $sum: { $cond: ['$active', 1, 0] } },
      },
    },
  ]);
  const summary: Record<string, { total: number; active: number }> = {};
  rows.forEach((r) => {
    summary[r._id] = { total: r.total, active: r.active };
  });
  res.json({ success: true, data: summary });
});
