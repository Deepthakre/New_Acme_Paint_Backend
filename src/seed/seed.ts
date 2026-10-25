/* eslint-disable no-console */
import { connectDb, disconnectDb } from '../config/db';
import { User, hashPassword } from '../models/User';
import { ProductCatalogItem } from '../models/ProductCatalogItem';
import { AccessoryItem } from '../models/AccessoryItem';
import { nextSeq } from '../models/Counter';
import { Counter } from '../models/Counter';

// Same company info as the frontend's src/lib/constants.ts (COMPANY_INFO) —
// kept identical so every seeded product shows the real manufacturer block.
const COMPANY_INFO = {
  manufacturedBy: 'AcmePaints',
  website: 'https://www.acmepaints.com/',
  address: 'Plot no.10, opp. Zero Degree Lounge, Isasani, Nagpur, Maharashtra 440019',
  email: 'info@acmepaints.com',
  helpline: '+91 94221 17922',
};

const SIZE_OPTIONS = ['20L', '10L', '4L', '1L'];

async function upsertUser(data: {
  username: string;
  password: string;
  role: 'admin' | 'warehouse' | 'dealer' | 'salesrep' | 'customer';
  name: string;
  businessName?: string;
  owner?: string;
  address?: string;
  mobile?: string;
}) {
  const passwordHash = await hashPassword(data.password);
  await User.findOneAndUpdate(
    { username: data.username },
    { $set: { ...data, passwordHash }, $setOnInsert: { tokenVersion: 0 } },
    { upsert: true, new: true }
  );
  console.log(`  ✓ ${data.role.padEnd(9)} ${data.username} / ${data.password}`);
}

// ---------- FULL PRODUCT (PAINT) CATALOG ----------
function seedProduct(itemCode: string, name: string, unit = 'L', sizes: string[] = SIZE_OPTIONS) {
  return {
    itemCode,
    name,
    unit,
    sizes: [...sizes],
    usp: "Update this product's USP / key information.",
    manufacturedBy: COMPANY_INFO.manufacturedBy,
    address: COMPANY_INFO.address,
    email: COMPANY_INFO.email,
    website: COMPANY_INFO.website,
    helpline: COMPANY_INFO.helpline,
  };
}

const PRODUCT_CATALOG = [
  seedProduct('AP-001', 'READY SHADE Premium Emulsion'),
  seedProduct('AP-002', 'NIVA Acrylic Emulsion'),
  seedProduct('AP-003', 'LAVISH Shine Luxury Emulsion'),
  seedProduct('AP-004', 'FINE COAT Water Base Primer'),
  seedProduct('AP-005', 'RIO SHINE Exterior Emulsion'),
  seedProduct('AP-006', 'NIVA Acrylic Distemper', 'KG', ['20KG', '10KG', '4KG', '1KG']),
  seedProduct('AP-007', 'DESIRE SHINE Interior Emulsion'),
  seedProduct('AP-008', 'DAMP PROTECT'),
  seedProduct('AP-009', 'RIO ULTRA Weatherproof'),
  seedProduct('AP-010', 'RIO Exterior Emulsion'),
  seedProduct('AP-011', 'ACME Wall Putty', 'KG', ['40KG']),
  seedProduct('AP-012', 'ACME Paints 24 Carat Gold', 'L', ['50ml', '100ml', '200ml', '500ml']),
  seedProduct('AP-ACC-001', 'Paint Brush', 'Pcs', ['2 inch', '3 inch', '4 inch']),
  seedProduct('AP-ACC-002', 'Paint Roller', 'Pcs', ['7 inch', '9 inch']),
  seedProduct('AP-ACC-003', 'Thinner', 'L', ['500ml', '1L', '5L']),
  seedProduct('AP-ACC-004', 'Wall Putty', 'KG', ['5KG', '20KG', '40KG']),
  seedProduct('AP-ACC-005', 'Distemper', 'KG', ['20KG', '10KG', '4KG', '1KG']),
];

// ---------- FULL ACCESSORIES CATALOG (Brushes / Rollers / Tools) ----------
const PRICED_STARTER_ACCESSORIES = [
  { name: 'Brush 2-inch', category: 'Paint Brushes', sizes: ['2 inch'], price: 45, stock: 60, reorder: 20 },
  { name: 'Brush 4-inch', category: 'Paint Brushes', sizes: ['4 inch'], price: 75, stock: 35, reorder: 15 },
  { name: 'Roller 9-inch', category: 'Rollers & Textures', sizes: ['9 inch'], price: 120, stock: 8, reorder: 10 },
  { name: 'Thinner 1L', category: 'Thinner / Chemical', sizes: ['500ml', '1L', '5L'], price: 180, stock: 25, reorder: 10 },
  { name: 'Wall Putty 5kg', category: 'Putty / Primer', sizes: ['5KG', '20KG', '40KG'], price: 320, stock: 0, reorder: 5 },
];

function accItem(name: string, category: string, sizes: string[] = []) {
  return { name, category, sizes };
}

const BULK_ACCESSORY_CATALOG = [
  // ---- Paint Brushes ----
  accItem('AB-50', 'Paint Brushes', ['1"', '2"', '3"', '4"']),
  accItem('GREEN', 'Paint Brushes', ['4"']),
  accItem('RS NEW PAINTER', 'Paint Brushes', ['4"']),
  accItem('KINGFISHER', 'Paint Brushes', ['4"', '5"']),
  accItem('ACME-PAINTER', 'Paint Brushes', ['4"']),
  accItem('ULTIMA', 'Paint Brushes', ['3"', '4"', '5"', '6"']),
  accItem('B-22', 'Paint Brushes', ['4"']),
  accItem('PEPSI', 'Paint Brushes', ['4"']),
  accItem('555', 'Paint Brushes', ['5"']),
  accItem('555 (W)', 'Paint Brushes', ['4"']),
  accItem('B-44 (W)', 'Paint Brushes', ['4"']),
  accItem('HERO', 'Paint Brushes', ['4"']),
  accItem('B-44 (B)', 'Paint Brushes', ['1"', '1.5"', '2"', '2.5"', '3"', '4"']),
  accItem('GREEN PURE', 'Paint Brushes', ['4"']),
  accItem('DELUXE', 'Paint Brushes', ['1"', '2"', '3"', '4"']),
  accItem('RS-PAINTER', 'Paint Brushes', ['4"']),
  accItem('CHITRAHAR', 'Paint Brushes', ['4"']),
  accItem('111 (W)', 'Paint Brushes', ['1"', '1.5"', '2"', '2.5"', '3"', '4"']),
  accItem('CLASSMATE', 'Paint Brushes', ['1"', '3"']),
  accItem('B-44 (White)', 'Paint Brushes', ['3"']),
  accItem('111', 'Paint Brushes', ['3"']),
  accItem('CHAMPION', 'Paint Brushes', ['3"', '4"', '5"', '6"']),
  accItem('LION', 'Paint Brushes', ['3"', '4"']),
  accItem('RS SONA', 'Paint Brushes', ['4"']),
  accItem('JET-50', 'Paint Brushes', ['1"', '2"', '3"', '4"']),
  accItem('AB-40 PREMIUM', 'Paint Brushes', ['4"', '5"']),
  accItem('COCO', 'Paint Brushes', ['4"']),
  accItem('B-44', 'Paint Brushes', ['4"']),
  accItem('WRITING BRUSH', 'Paint Brushes', ['0-16 No.']),

  // ---- Rollers & Textures ----
  accItem('RAGGING ROLLER', 'Rollers & Textures', ['7"']),
  accItem('R-10', 'Rollers & Textures', ['5"']),
  accItem('UNIFIBER YELLOW LINE', 'Rollers & Textures', ['6"', '9"']),
  accItem('GREEN WHITE THREAD', 'Rollers & Textures', ['9"']),
  accItem('YELLO TEXTURE', 'Rollers & Textures', ['6"', '9"']),
  accItem('SPIKE ROLLER', 'Rollers & Textures', ['10"']),
  accItem('WHITE THREAD', 'Rollers & Textures', ['9"']),
  accItem('MICRO FIBRE ROLLER / MICRO FIBER / MICROFIBER', 'Rollers & Textures', ['2"', '4"', '6"', '9"']),
  accItem('YELLOW THREAD', 'Rollers & Textures', ['9"']),
  accItem('GREEN THREAD', 'Rollers & Textures', ['9"']),
  accItem('FLOWER', 'Rollers & Textures', ['9"']),
  accItem('VINTAGE', 'Rollers & Textures', ['9"']),
  accItem('TIGRE ROLLER', 'Rollers & Textures', ['9"']),
  accItem('WHITE SMOOTH', 'Rollers & Textures', ['9"']),
  accItem('WOOD GRAIN', 'Rollers & Textures', ['5"']),
  accItem('FOAM ROLLER', 'Rollers & Textures', ['2"', '3"', '4"', '6"']),

  // ---- Other Tools & Accessories ----
  accItem('SCRAPPER', 'Other Tools & Accessories', ['4"']),
  accItem('TRAY 1st & TRAY 2nd', 'Other Tools & Accessories', ['10"']),
  accItem('SPECTULA', 'Other Tools & Accessories', []),
  accItem('PUTTING PUTTY', 'Other Tools & Accessories', ['2"', '3"', '4"', '6"', '8"']),
  accItem('BANNER SET', 'Other Tools & Accessories', []),
  accItem('WIRE BRUSH', 'Other Tools & Accessories', ['5 & 6 Line']),
  accItem('PLASTIC TROWEL', 'Other Tools & Accessories', []),
  accItem('COMBING', 'Other Tools & Accessories', []),
  accItem('SANDING TROWEL', 'Other Tools & Accessories', []),
  accItem('ROLLER HANDLE', 'Other Tools & Accessories', ['2"', '3"', '4"', '5"', '6"', '9"']),
  accItem('ROLLER HANDLE LONG', 'Other Tools & Accessories', ['4"', '5"']),
];

async function seedCatalog() {
  console.log('\nSeeding full product catalog (paints)...');
  for (const item of PRODUCT_CATALOG) {
    await ProductCatalogItem.findOneAndUpdate({ itemCode: item.itemCode }, item, { upsert: true });
    console.log(`  ✓ ${item.itemCode} — ${item.name}`);
  }
}

async function seedAccessories() {
   // Sync the accSku counter to whatever the highest existing SKU number
  // already is. Needed because an earlier seed run (before this counter
  // existed) created ACC-0001..0003 by hand, so nextSeq('accSku') would
  // otherwise start over from 1 and collide with them.
  const existingSkus = await AccessoryItem.find({}, 'sku').lean();
  const maxNum = existingSkus.reduce((max, it) => {
    const match = /ACC-(\d+)/.exec(it.sku);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  await Counter.findByIdAndUpdate('accSku', { seq: maxNum }, { upsert: true });
  console.log('\nSeeding priced starter accessories...');
  for (const item of PRICED_STARTER_ACCESSORIES) {
    const existing = await AccessoryItem.findOne({ name: item.name }).lean();
    if (existing) {
      console.log(`  ↷ ${existing.sku} — ${item.name} (already exists, skipped)`);
      continue;
    }
    const seq = await nextSeq('accSku');
    const sku = `ACC-${String(seq).padStart(4, '0')}`;
    await AccessoryItem.create({ sku, ...item });
    console.log(`  ✓ ${sku} — ${item.name}`);
  }

  console.log('\nSeeding full brush/roller/tools catalog (price & stock start at 0 — set via Accessories page)...');
  for (const item of BULK_ACCESSORY_CATALOG) {
    const existing = await AccessoryItem.findOne({ name: item.name }).lean();
    if (existing) {
      console.log(`  ↷ ${existing.sku} — ${item.name} (already exists, skipped)`);
      continue;
    }
    const seq = await nextSeq('accSku');
    const sku = `ACC-${String(seq).padStart(4, '0')}`;
    await AccessoryItem.create({ sku, name: item.name, category: item.category, sizes: item.sizes, price: 0, stock: 0, reorder: 10 });
    console.log(`  ✓ ${sku} — ${item.name}`);
  }
}

async function seed() {
  await connectDb();
  console.log('Seeding demo accounts (username / password):');

  await upsertUser({ username: 'admin', password: 'Admin@123', role: 'admin', name: 'Admin' });
  await upsertUser({ username: 'warehouse', password: 'Warehouse@123', role: 'warehouse', name: 'Warehouse Staff' });
  await upsertUser({
    username: 'dealer1',
    password: 'Dealer@123',
    role: 'dealer',
    name: 'Sharma Hardware & Paints',
    businessName: 'Sharma Hardware & Paints',
    owner: 'Ramesh Sharma',
    address: 'MG Road, Nagpur',
    mobile: '9876543210',
  });
  await upsertUser({
    username: 'salesrep1',
    password: 'SalesRep@123',
    role: 'salesrep',
    name: 'Anita Deshmukh',
    mobile: '9876500001',
  });
  await upsertUser({
    username: 'customer1',
    password: 'Customer@123',
    role: 'customer',
    name: 'Test Customer',
    mobile: '9876500002',
  });

  await seedCatalog();
  await seedAccessories();

  console.log('\nDone. Open /manufacturing -> Start a Production Batch: every category, product and pack size is now available.');
  await disconnectDb();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});