import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LATEST_WINDOW_MINUTES,
  buildLatestFallbackQuery,
  buildLatestQuery,
  latestSampleMap
} from '../src/lib/latestSample';

describe('Plan 20 - truy vấn mẫu chất lượng mới nhất', () => {
  it('chỉ đọc cửa sổ ngắn và không lấy cột details', () => {
    const { sql, params } = buildLatestQuery({
      targetType: 'station',
      ids: [680, 682]
    });
    expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY target_id');
    expect(sql).toContain(`INTERVAL ${LATEST_WINDOW_MINUTES} MINUTE`);
    expect(sql).not.toContain('details');
    expect(sql).not.toContain('qs.*');
    expect(params).toEqual(['station', 680, 682]);
  });

  it('lọc theo hướng khi được yêu cầu', () => {
    const { sql, params } = buildLatestQuery({
      targetType: 'relay_job',
      ids: [12],
      direction: 'downstream'
    });
    expect(sql).toContain('AND direction = ?');
    expect(params).toEqual(['relay_job', 12, 'downstream']);
  });

  it('đếm theo mountpoint khi lấy cho danh sách mountpoint', () => {
    const { sql } = buildLatestQuery({
      targetType: 'station',
      ids: [1, 2, 3],
      direction: 'ingest',
      by: 'mountpoint'
    });
    expect(sql).toContain('PARTITION BY mountpoint_id');
    expect(sql).toContain('mountpoint_id IN (?,?,?)');
  });

  it('fallback mỗi target một lần seek index và giữ đúng thứ tự tham số', () => {
    const { sql, params } = buildLatestFallbackQuery(
      { targetType: 'station', ids: [7, 8], direction: 'ingest' },
      [7, 8]
    );
    expect(sql.match(/ORDER BY ts DESC LIMIT 1/g)).toHaveLength(2);
    expect(sql).toContain('UNION ALL');
    expect(params).toEqual([
      'station',
      7,
      'ingest',
      'station',
      8,
      'ingest'
    ]);
  });

  it('giữ mẫu đầu tiên cho mỗi khoá khi dựng map', () => {
    const map = latestSampleMap(
      [
        { target_id: 5, score: 90 },
        { target_id: 5, score: 10 },
        { target_id: 6, score: 80 }
      ] as any,
      'target'
    );
    expect(map.get(5)?.score).toBe(90);
    expect(map.get(6)?.score).toBe(80);
  });

  it('migration 011 tạo đủ index và tăng schema version', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../db/migrations/runtime/011_perf_indexes.sql'),
      'utf8'
    );
    expect(sql).toContain('idx_quality_samples_latest (target_type, target_id, ts)');
    expect(sql).toContain(
      'idx_quality_samples_target_dir_ts (target_type, target_id, direction, ts)'
    );
    expect(sql).toContain('idx_relay_sessions_open (relay_job_id, end_ts)');
    expect(sql).toContain('idx_quality_alerts_open (resolved_at, last_seen)');
    expect(sql).toContain("schema_version', '11'");
  });
});
