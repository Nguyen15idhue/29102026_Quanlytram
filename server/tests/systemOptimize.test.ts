import { describe, expect, it } from 'vitest';
import { buildRecommendations, splitTables, type TableRow } from '../src/lib/systemOptimize';

function tableRow(schema: string, name: string, total: number): TableRow {
  return {
    TABLE_SCHEMA: schema,
    TABLE_NAME: name,
    TABLE_ROWS: 10,
    DATA_LENGTH: total,
    INDEX_LENGTH: 0
  } as TableRow;
}

describe('systemOptimize splitTables', () => {
  it('tách admin/runtime, tính tổng và sắp xếp giảm dần', () => {
    const result = splitTables(
      [
        tableRow('cors_admin', 'a', 100),
        tableRow('cors_admin', 'b', 300),
        tableRow('cors_runtime', 'c', 200)
      ],
      'cors_admin'
    );
    expect(result.admin.sizeBytes).toBe(400);
    expect(result.admin.tables.map((item) => item.name)).toEqual(['b', 'a']);
    expect(result.runtime.sizeBytes).toBe(200);
    expect(result.runtime.tables[0].name).toBe('c');
  });

  it('giới hạn 20 bảng mỗi schema', () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      tableRow('cors_admin', `t${index}`, index)
    );
    const result = splitTables(rows, 'cors_admin');
    expect(result.admin.tables).toHaveLength(20);
  });
});

describe('systemOptimize buildRecommendations', () => {
  const base = {
    heapPercent: 40,
    eventLoopLagMs: 10,
    mysqlLatencyMs: 20,
    quality: { queueDepth: 0, queueSize: 100, dropped: 0, storeDrops: 0 },
    tables: [],
    retention: [],
    diskUsedPercent: 40
  };

  it('không có gợi ý khi mọi chỉ số bình thường', () => {
    expect(buildRecommendations(base)).toEqual([]);
  });

  it('cảnh báo heap, lag, DB, queue và drops', () => {
    const items = buildRecommendations({
      ...base,
      heapPercent: 85,
      eventLoopLagMs: 250,
      mysqlLatencyMs: 400,
      quality: { queueDepth: 95, queueSize: 100, dropped: 2, storeDrops: 1 }
    });
    const ids = items.map((item) => item.id);
    expect(ids).toContain('heap-high');
    expect(ids).toContain('loop-lag');
    expect(ids).toContain('db-latency');
    expect(ids).toContain('quality-queue-full');
    expect(ids).toContain('quality-drops');
    expect(ids).toContain('store-drops');
  });

  it('gợi ý retention backlog và đĩa critical', () => {
    const items = buildRecommendations({
      ...base,
      diskUsedPercent: 95,
      retention: [
        {
          key: 'audit-logs',
          label: 'Nhật ký audit',
          scope: 'admin',
          table: 'audit_logs',
          retentionDays: 365,
          enabled: true,
          backlogRows: 20000
        },
        {
          key: 'web-sessions',
          label: 'Phiên đăng nhập web',
          scope: 'admin',
          table: 'web_sessions',
          retentionDays: 7,
          enabled: true,
          backlogRows: 1500
        }
      ]
    });
    const ids = items.map((item) => item.id);
    expect(ids).toContain('retention-backlog-audit-logs');
    expect(ids).toContain('retention-backlog-web-sessions');
    expect(ids).toContain('disk-high');
    expect(items.find((item) => item.id === 'disk-high')?.level).toBe('critical');
  });

  it('gợi ý bảng lớn', () => {
    const items = buildRecommendations({
      ...base,
      tables: [
        {
          name: 'quality_samples',
          rows: 1,
          dataBytes: 3 * 1024 ** 3,
          indexBytes: 0,
          totalBytes: 3 * 1024 ** 3
        }
      ]
    });
    expect(items.map((item) => item.id)).toContain('table-large-quality_samples');
  });
});
