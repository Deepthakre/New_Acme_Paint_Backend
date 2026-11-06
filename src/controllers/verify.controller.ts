import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { Product } from '../models/Product';
import { ProductCatalogItem } from '../models/ProductCatalogItem';
import { AccessoryItem } from '../models/AccessoryItem';
import { Batch } from '../models/Batch';
import { verifyQrString, extractScannedId } from '../utils/ids';
import { COMPANY_INFO } from '../config/companyInfo';

/**
 * Public "scan to verify" endpoint. Anyone with a camera can hit this, so
 * it never trusts the scanned string blindly: the HMAC signature embedded
 * in the QR is re-checked server-side (using the secret that never left
 * the server) before treating the lookup as genuine. A structurally valid
 * but forged QR (right shape, wrong signature) is reported as counterfeit
 * rather than silently falling through to a lookup-by-id.
 */
export const verifyProduct = asyncHandler(async (req: Request, res: Response) => {
  const qrString = String(req.query.qr || req.params.qrString || '').trim();
  const hasSig = qrString.includes('.');

  if (hasSig) {
    const { valid } = verifyQrString(qrString);
    if (!valid) {
      return res.json({ success: true, data: { found: false, reason: 'signature_mismatch' } });
    }
  }

  const bareId = extractScannedId(qrString);
  const p = await Product.findOne({ $or: [{ qr: bareId }, { qrString }] }).lean();
  if (!p) return res.json({ success: true, data: { found: false } });

  const [catalogItem, acc, batch] = await Promise.all([
    ProductCatalogItem.findOne({ name: p.product }).lean(),
    AccessoryItem.findOne({ name: p.product }).lean(),
    Batch.findOne({ id: p.batchId }).lean(),
  ]);

  const master = catalogItem || {
    itemCode: acc?.sku || '—',
    name: p.product,
    unit: 'Pcs',
    sizes: acc?.sizes || [],
    usp: acc ? `Genuine ${acc.category} from ${COMPANY_INFO.manufacturedBy}.` : 'General purpose paint product.',
    manufacturedBy: COMPANY_INFO.manufacturedBy,
    address: COMPANY_INFO.address,
    email: COMPANY_INFO.email,
    website: COMPANY_INFO.website,
    helpline: COMPANY_INFO.helpline,
  };

  res.json({
    success: true,
    data: {
      found: true,
      product: p,
      master,
      manufacturingDate: batch?.manufacturingDate || null,
      mrp: batch?.mrp || null,
    },
  });
});
