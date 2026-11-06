import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { ProductCatalogItem } from '../models/ProductCatalogItem';
import { parsePagination, paginate } from '../utils/pagination';

export const listCatalog = asyncHandler(async (req: Request, res: Response) => {
  const params = parsePagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = {};
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: 'i' };

  const result = await paginate(
    ProductCatalogItem.find(filter),
    ProductCatalogItem.countDocuments(filter),
    params
  );
  res.json({ success: true, ...result });
});

export const addCatalogItem = asyncHandler(async (req: Request, res: Response) => {
  const existing = await ProductCatalogItem.findOne({ itemCode: req.body.itemCode }).lean();
  if (existing) throw ApiError.conflict(`Item code ${req.body.itemCode} already exists.`);
  const item = await ProductCatalogItem.create(req.body);
  res.status(201).json({ success: true, data: item.toJSON() });
});

export const updateCatalogItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await ProductCatalogItem.findOneAndUpdate({ itemCode: req.params.itemCode }, req.body, { new: true, runValidators: true });
  if (!item) throw ApiError.notFound('Product not found.');
  res.json({ success: true, data: item.toJSON() });
});

export const deleteCatalogItem = asyncHandler(async (req: Request, res: Response) => {
  await ProductCatalogItem.deleteOne({ itemCode: req.params.itemCode });
  res.json({ success: true, data: true });
});
