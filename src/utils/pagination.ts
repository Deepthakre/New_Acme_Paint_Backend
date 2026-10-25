import type { Query } from 'mongoose';
import { env } from '../config/env';

export interface PaginationParams {
  page: number;
  limit: number;
  sort: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

/** Parses & clamps page/limit/sort query params — never trust raw client input for these. */
export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const rawPage = Number(query.page);
  const rawLimit = Number(query.limit);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), env.MAX_PAGE_SIZE)
      : env.DEFAULT_PAGE_SIZE;
  const sort = typeof query.sort === 'string' && /^-?[a-zA-Z0-9_.]+$/.test(query.sort) ? query.sort : '-createdAt';
  return { page, limit, sort };
}

/**
 * Runs a Mongoose query with skip/limit + a parallel count, and returns a
 * uniform { data, pagination } envelope every list endpoint in this API
 * uses. Centralizing this means every "proper pagination" requirement in
 * the brief is satisfied by construction, not by remembering to do it
 * per-route.
 */
export async function paginate<T>(
  query: Query<T[], T>,
  countQuery: Query<number, T>,
  { page, limit, sort }: PaginationParams
): Promise<PaginatedResult<T>> {
  const skip = (page - 1) * limit;
  const [data, totalItems] = await Promise.all([
    query.sort(sort).skip(skip).limit(limit).lean().exec() as unknown as Promise<T[]>,
    countQuery.exec(),
  ]);
  const totalPages = Math.max(Math.ceil(totalItems / limit), 1);
  return {
    data,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}
