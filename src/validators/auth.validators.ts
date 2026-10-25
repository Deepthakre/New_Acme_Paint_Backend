import { z } from 'zod';
import { roleEnum } from './common.validators';

// Strong password policy: min 8 chars, at least one letter and one number.
// This is enforced server-side regardless of what the frontend form allows.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(128),
  role: roleEnum,
});

export const registerSchema = z
  .object({
    role: roleEnum,
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'Username must be at least 3 characters.')
      .max(40)
      .regex(/^[a-z0-9._-]+$/i, 'Username can only contain letters, numbers, dots, underscores and hyphens.'),
    password: passwordSchema,
    businessName: z.string().trim().max(150).optional(),
    owner: z.string().trim().max(120).optional(),
    fullName: z.string().trim().max(120).optional(),
    mobile: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'Mobile number must be 10 digits.')
      .optional(),
    address: z.string().trim().max(300).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'dealer' && !data.businessName) {
      ctx.addIssue({ code: 'custom', message: 'Business name is required for dealer accounts.', path: ['businessName'] });
    }
    if ((data.role === 'salesrep' || data.role === 'customer') && !data.fullName) {
      ctx.addIssue({ code: 'custom', message: 'Full name is required.', path: ['fullName'] });
    }
    if (data.role === 'admin' || data.role === 'warehouse') {
      ctx.addIssue({ code: 'custom', message: 'This role cannot self-register.', path: ['role'] });
    }
  });
