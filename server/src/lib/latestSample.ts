import { RowDataPacket } from 'mysql2/promise';
import { runtimeQuery } from '../db/runtimePool';

// Plan 20 (D20-1): mẫu mới nhất chỉ nằm trong 15 phút gần nhất với target đang
// chạy. Cửa sổ nhỏ giúp MySQL đọc vài dòng thay vì toàn bộ 7 ngày.
export const LATEST_WINDOW_MINUTES = 15;

// Chỉ các cột đường đọc cần dùng. Không select `details` (JSON) để tránh đọc
// ~1 KB/dòng và tránh sort tràn tmp-table.
export const LATEST_SAMPLE_COLUMNS = `target_type, target_id, direction, mountpoint_id,
  score, state, ts, age_ms, arp_x, arp_y, arp_z, reported_station_id,
  satellites, cells, msm_epochs, antenna`;

export type LatestSampleKey = 'target' | 'mountpoint';

export interface LatestSampleOptions {
  targetType: 'station' | 'relay_job';
  ids: number[];
  direction?: 'ingest' | 'upstream' | 'downstream';
  by?: LatestSampleKey;
  windowMinutes?: number;
}

export interface LatestSampleQuery {
  sql: string;
  params: unknown[];
}

function windowClause(options: LatestSampleOptions): number {
  const value = options.windowMinutes ?? LATEST_WINDOW_MINUTES;
  if (!Number.isFinite(value) || value <= 0) return LATEST_WINDOW_MINUTES;
  return Math.min(24 * 60, Math.round(value));
}

function keyColumn(by: LatestSampleKey | undefined): string {
  return by === 'mountpoint' ? 'mountpoint_id' : 'target_id';
}

/**
 * Truy vấn chính: chỉ đọc cửa sổ ngắn và chỉ các cột cần dùng.
 * Index `idx_quality_samples_latest (target_type, target_id, ts)` phục vụ
 * `ORDER BY ts DESC` trong window function.
 */
export function buildLatestQuery(options: LatestSampleOptions): LatestSampleQuery {
  const column = keyColumn(options.by);
  const params: unknown[] = [options.targetType, ...options.ids];
  let sql = `SELECT ${LATEST_SAMPLE_COLUMNS} FROM (
      SELECT ${LATEST_SAMPLE_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY ${column} ORDER BY ts DESC) AS rn
        FROM quality_samples
       WHERE target_type = ? AND ${column} IN (${options.ids.map(() => '?').join(',')})`;
  if (options.direction) {
    sql += ' AND direction = ?';
    params.push(options.direction);
  }
  sql += ` AND ts >= UTC_TIMESTAMP(3) - INTERVAL ${windowClause(options)} MINUTE
    ) ranked WHERE rn = 1`;
  return { sql, params };
}

/**
 * Fallback cho target không có mẫu trong cửa sổ ngắn (trạm vừa tắt lâu, hoặc
 * dữ liệu cũ): mỗi target một lần seek index `(target_type, target_id, ts)`.
 */
export function buildLatestFallbackQuery(
  options: LatestSampleOptions,
  missingIds: number[]
): LatestSampleQuery {
  const column = keyColumn(options.by);
  const directionSql = options.direction ? ' AND direction = ?' : '';
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const id of missingIds) {
    parts.push(
      `(SELECT ${LATEST_SAMPLE_COLUMNS} FROM quality_samples
         WHERE target_type = ? AND ${column} = ?${directionSql}
         ORDER BY ts DESC LIMIT 1)`
    );
    params.push(options.targetType, id);
    if (options.direction) params.push(options.direction);
  }
  return {
    sql: `SELECT ${LATEST_SAMPLE_COLUMNS} FROM (${parts.join(' UNION ALL ')}) latest`,
    params
  };
}

/**
 * Nạp mẫu mới nhất cho danh sách target/mountpoint.
 * Luôn trả về tối đa 1 dòng cho mỗi id; không ném lỗi khi bảng chưa migrate.
 */
export async function loadLatestSamples(
  options: LatestSampleOptions
): Promise<RowDataPacket[]> {
  if (options.ids.length === 0) return [];
  const column = keyColumn(options.by);
  const primary = buildLatestQuery(options);
  const rows = await runtimeQuery<RowDataPacket[]>(primary.sql, primary.params);
  const seen = new Set<number>();
  for (const row of rows as any[]) {
    seen.add(Number(row[column]));
  }
  const missing = options.ids.filter((id) => !seen.has(Number(id)));
  if (missing.length === 0) return rows as RowDataPacket[];

  const fallback = buildLatestFallbackQuery(options, missing);
  const extra = await runtimeQuery<RowDataPacket[]>(fallback.sql, fallback.params);
  return [...(rows as RowDataPacket[]), ...(extra as RowDataPacket[])];
}

/** Trả về Map theo khoá target_id hoặc mountpoint_id để route gắn vào danh sách. */
export function latestSampleMap(
  rows: RowDataPacket[],
  by: LatestSampleKey = 'target'
): Map<number, any> {
  const column = by === 'mountpoint' ? 'mountpoint_id' : 'target_id';
  const map = new Map<number, any>();
  for (const row of rows as any[]) {
    const key = Number(row[column]);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}
