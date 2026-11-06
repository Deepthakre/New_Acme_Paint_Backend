import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  sort: z.string().regex(/^-?[a-zA-Z0-9_.]+$/).optional(),
}).passthrough(); // allow additional filter params defined per-route

export const roleEnum = z.enum(['admin', 'warehouse', 'dealer', 'salesrep', 'customer']);
export const qrModeEnum = z.enum(['single', 'multi']);
export const productStatusEnum = z.enum(['FACTORY', 'TRANSIT', 'DEALER', 'SOLD', 'RETURNED']);
export const orderStatusEnum = z.enum(['PENDING', 'DISPATCHED', 'REJECTED']);
export const returnConditionEnum = z.enum(['resellable', 'damaged']);

export const nonEmptyString = z.string().trim().min(1, 'This field is required.');
export const positiveInt = z.coerce.number().int().positive();
export const nonNegativeNumber = z.coerce.number().min(0);
