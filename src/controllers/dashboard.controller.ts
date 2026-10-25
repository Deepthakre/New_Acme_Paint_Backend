import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { Product } from '../models/Product';
import { Batch } from '../models/Batch';

export const getDashboardStats = asyncHandler(async (_req: Request, res: Response) => {
  const [totalProduced, factory, transit, dealerStock, sold, totalBatches] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ status: 'FACTORY' }),
    Product.countDocuments({ status: 'TRANSIT' }),
    Product.countDocuments({ status: 'DEALER' }),
    Product.countDocuments({ status: 'SOLD' }),
    Batch.countDocuments(),
  ]);
  res.json({ success: true, data: { totalProduced, factory, transit, dealerStock, sold, totalBatches } });
});
