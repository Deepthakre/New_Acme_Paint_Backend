import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { AccessoryItem } from '../models/AccessoryItem';
import { nextSeq } from '../models/Counter';
import { parsePagination, paginate } from '../utils/pagination';

export const listAccessories = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: 'i' };
  const result = await paginate(AccessoryItem.find(filter), AccessoryItem.countDocuments(filter), params);
  res.json({ success: true, ...result });
});

export const addAccessoryItem = asyncHandler(async (req: Request, res: Response) => {
  const seq = await nextSeq('accSku');
  const item = await AccessoryItem.create({ sku: `ACC-${String(seq).padStart(4, '0')}`, ...req.body });
  res.status(201).json({ success: true, data: item.toJSON() });
});

export const updateAccessoryItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await AccessoryItem.findOneAndUpdate({ sku: req.params.sku }, req.body, { new: true, runValidators: true });
  if (!item) throw ApiError.notFound('Item not found.');
  res.json({ success: true, data: item.toJSON() });
});

export const stockInAccessory = asyncHandler(async (req: Request, res: Response) => {
  const item = await AccessoryItem.findOneAndUpdate(
    { sku: req.params.sku },
    { $inc: { stock: req.body.qty } },
    { new: true }
  );
  if (!item) throw ApiError.notFound('Item not found.');
  res.json({ success: true, data: item.toJSON() });
});

export const sellAccessory = asyncHandler(async (req: Request, res: Response) => {
  const { qty } = req.body;
  // Atomic conditional decrement — the $gte guard means a race between two
  // concurrent sells can never push stock negative, which a naive
  // read-then-write update would allow.
  const item = await AccessoryItem.findOneAndUpdate(
    { sku: req.params.sku, stock: { $gte: qty } },
    { $inc: { stock: -qty } },
    { new: true }
  );
  if (!item) {
    const existing = await AccessoryItem.findOne({ sku: req.params.sku }).lean();
    if (!existing) throw ApiError.notFound('Item not found.');
    throw ApiError.badRequest(`Only ${existing.stock} units in stock.`);
  }
  res.json({ success: true, data: item.toJSON() });
});
