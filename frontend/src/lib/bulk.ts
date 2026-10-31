import { apiFetch } from '../api/client';

export interface BulkResult {
  updated: number;
  skipped: number;
  forbidden: number;
  notFound: number;
}

export async function sendBulk(
  path: string,
  action: string,
  ids: Array<string | number>,
  csrfToken: string | null
): Promise<BulkResult> {
  const data = await apiFetch<{ result: BulkResult }>(path, {
    method: 'POST',
    csrfToken,
    body: { action, ids: ids.map(Number) }
  });
  return data.result;
}

export function bulkMessage(result: BulkResult): string {
  const parts = [`${result.updated} đã cập nhật`];
  if (result.skipped) parts.push(`${result.skipped} bỏ qua`);
  if (result.forbidden) parts.push(`${result.forbidden} không có quyền`);
  if (result.notFound) parts.push(`${result.notFound} không tìm thấy`);
  return parts.join(' · ');
}
