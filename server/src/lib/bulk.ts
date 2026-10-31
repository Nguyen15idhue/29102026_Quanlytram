import { z } from 'zod';

export const bulkBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  action: z.string().min(1).max(40)
});

export interface BulkResult {
  updated: number;
  skipped: number;
  forbidden: number;
  notFound: number;
}

export function emptyBulkResult(): BulkResult {
  return { updated: 0, skipped: 0, forbidden: 0, notFound: 0 };
}

export function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids)];
}
