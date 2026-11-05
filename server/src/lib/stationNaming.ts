import type { PoolConnection } from 'mysql2/promise';
import { ApiError } from './http';

const MAX_MOUNTPOINT_NAME = 128;

export function normalizeStationName(name: string): string {
  const normalized = name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return `TRAM_${Date.now()}`;
  return normalized.slice(0, MAX_MOUNTPOINT_NAME);
}

export async function uniqueMountpointName(
  conn: PoolConnection,
  stationName: string
): Promise<string> {
  const base = normalizeStationName(stationName);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const [rows] = await conn.query<any[]>(
      'SELECT id FROM mountpoints WHERE name = ? LIMIT 1',
      [candidate]
    );
    if (rows.length === 0) return candidate;
    const suffixText = `_${suffix}`;
    candidate = `${base.slice(0, MAX_MOUNTPOINT_NAME - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
}

/** Dùng tên mountpoint người dùng nhập; báo lỗi nếu đã tồn tại. */
export async function ensureMountpointNameAvailable(
  conn: PoolConnection,
  requested: string
): Promise<string> {
  const candidate = requested.trim();
  if (!candidate) {
    throw new ApiError(400, 'INVALID_MOUNTPOINT', 'Tên mountpoint không được để trống');
  }
  if (candidate.length > MAX_MOUNTPOINT_NAME) {
    throw new ApiError(
      400,
      'INVALID_MOUNTPOINT',
      `Tên mountpoint tối đa ${MAX_MOUNTPOINT_NAME} ký tự`
    );
  }
  const [rows] = await conn.query<any[]>(
    'SELECT id FROM mountpoints WHERE name = ? LIMIT 1',
    [candidate]
  );
  if (rows.length > 0) {
    throw new ApiError(409, 'MOUNTPOINT_EXISTS', `Mountpoint "${candidate}" đã tồn tại`);
  }
  return candidate;
}
