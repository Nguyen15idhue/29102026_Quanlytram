import { statfs } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { adminPool, query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { socketClientCount } from '../realtime/socket';
import { callGoInternal } from './internalApi';

export type OptimizeLevel = 'info' | 'warn' | 'critical';

export interface TableSize {
  name: string;
  rows: number;
  dataBytes: number;
  indexBytes: number;
  totalBytes: number;
}

export interface RetentionJob {
  key: string;
  label: string;
  scope: 'admin' | 'runtime';
  table: string;
  retentionDays: number;
  enabled: boolean;
  backlogRows: number | null;
}

export interface Recommendation {
  id: string;
  level: OptimizeLevel;
  title: string;
  detail: string;
  actionTab: 'optimize' | 'automation' | null;
}

export interface TableRow extends RowDataPacket {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  TABLE_ROWS: number | null;
  DATA_LENGTH: number | null;
  INDEX_LENGTH: number | null;
}

const CACHE_TTL_MS = 20_000;
const MAX_TABLES = 20;
const LARGE_TABLE_BYTES = 2 * 1024 ** 3;

const BACKLOG_SQL: Record<string, { schema: 'admin' | 'runtime'; table: string; condition: (days: number) => string }> = {
  'relay-sessions': {
    schema: 'runtime',
    table: 'relay_sessions',
    condition: (days) => `end_ts IS NOT NULL AND end_ts < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'relay-events': {
    schema: 'runtime',
    table: 'relay_events',
    condition: (days) => `ts < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'relay-hourly': {
    schema: 'runtime',
    table: 'relay_hourly',
    condition: (days) => `hour_start_utc < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'quality-samples': {
    schema: 'runtime',
    table: 'quality_samples',
    condition: (days) => `ts < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'quality-alerts': {
    schema: 'runtime',
    table: 'quality_alerts',
    condition: (days) => `resolved_at IS NOT NULL AND last_seen < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'caster-connections': {
    schema: 'runtime',
    table: 'caster_connections',
    condition: (days) => `end_ts IS NOT NULL AND end_ts < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'station-sessions': {
    schema: 'runtime',
    table: 'station_source_sessions',
    condition: (days) => `end_ts IS NOT NULL AND end_ts < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'rtcm-message-stats': {
    schema: 'runtime',
    table: 'rtcm_message_stats',
    condition: (days) => `hour_start_utc < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'web-sessions': {
    schema: 'admin',
    table: 'web_sessions',
    condition: (days) => `expires_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'audit-logs': {
    schema: 'admin',
    table: 'audit_logs',
    condition: (days) => `created_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  },
  'acked-alerts': {
    schema: 'admin',
    table: 'alerts',
    condition: (days) => `status = 'acked' AND acked_at IS NOT NULL AND acked_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
  }
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function splitTables(
  rows: TableRow[],
  adminDatabase: string
): { admin: { sizeBytes: number; tables: TableSize[] }; runtime: { sizeBytes: number; tables: TableSize[] } } {
  const build = (schema: string) => {
    const items = rows
      .filter((row) => row.TABLE_SCHEMA === schema)
      .map((row) => {
        const dataBytes = Number(row.DATA_LENGTH ?? 0);
        const indexBytes = Number(row.INDEX_LENGTH ?? 0);
        return {
          name: String(row.TABLE_NAME),
          rows: Number(row.TABLE_ROWS ?? 0),
          dataBytes,
          indexBytes,
          totalBytes: dataBytes + indexBytes
        };
      })
      .sort((a, b) => b.totalBytes - a.totalBytes);
    return {
      sizeBytes: items.reduce((sum, item) => sum + item.totalBytes, 0),
      tables: items.slice(0, MAX_TABLES)
    };
  };
  return { admin: build(adminDatabase), runtime: build(config.mysql.runtimeDatabase) };
}

export function buildRecommendations(input: {
  heapPercent: number;
  eventLoopLagMs: number;
  mysqlLatencyMs: number;
  quality:
    | {
        queueDepth?: number;
        queueSize?: number;
        dropped?: number;
        storeDrops?: number;
      }
    | null
    | undefined;
  tables: TableSize[];
  retention: RetentionJob[];
  diskUsedPercent: number | null;
}): Recommendation[] {
  const items: Recommendation[] = [];
  if (input.heapPercent >= 80) {
    items.push({
      id: 'heap-high',
      level: 'warn',
      title: 'Heap Node cao',
      detail: `Heap đang dùng ${input.heapPercent.toFixed(1)}%. Xem xét tăng RAM hoặc giảm cache.`,
      actionTab: null
    });
  }
  if (input.eventLoopLagMs >= 200) {
    items.push({
      id: 'loop-lag',
      level: 'warn',
      title: 'Event loop lag cao',
      detail: `Lag ${input.eventLoopLagMs.toFixed(0)} ms. Kiểm tra tác vụ đồng bộ hoặc query nặng.`,
      actionTab: null
    });
  }
  if (input.mysqlLatencyMs >= 300) {
    items.push({
      id: 'db-latency',
      level: 'warn',
      title: 'MySQL chậm',
      detail: `Ping ${input.mysqlLatencyMs.toFixed(0)} ms. Kiểm tra tải, khóa bảng và pool.`,
      actionTab: null
    });
  }
  const queueDepth = input.quality?.queueDepth ?? 0;
  const queueSize = input.quality?.queueSize ?? 0;
  if (queueSize > 0 && queueDepth / queueSize >= 0.9) {
    items.push({
      id: 'quality-queue-full',
      level: 'warn',
      title: 'Hàng đợi quality gần đầy',
      detail: `Queue ${queueDepth}/${queueSize}. Giảm tải hoặc tăng QUALITY_QUEUE_SIZE.`,
      actionTab: null
    });
  }
  if ((input.quality?.dropped ?? 0) > 0) {
    items.push({
      id: 'quality-drops',
      level: 'warn',
      title: 'Quality bỏ mẫu',
      detail: `Đã bỏ ${input.quality?.dropped} mẫu do queue đầy.`,
      actionTab: null
    });
  }
  if ((input.quality?.storeDrops ?? 0) > 0) {
    items.push({
      id: 'store-drops',
      level: 'warn',
      title: 'Store bỏ mẫu',
      detail: `Đã bỏ ${input.quality?.storeDrops} mẫu trước khi ghi DB.`,
      actionTab: null
    });
  }
  const large = input.tables.filter((table) => table.totalBytes >= LARGE_TABLE_BYTES).slice(0, 3);
  for (const table of large) {
    items.push({
      id: `table-large-${table.name}`,
      level: 'info',
      title: `Bảng ${table.name} lớn`,
      detail: `Dung lượng ${(table.totalBytes / 1024 ** 3).toFixed(2)} GB. Xem retention hoặc archive.`,
      actionTab: 'automation'
    });
  }
  for (const job of input.retention) {
    const backlog = job.backlogRows ?? 0;
    const threshold = job.key === 'web-sessions' ? 1000 : 10000;
    if (backlog >= threshold) {
      items.push({
        id: `retention-backlog-${job.key}`,
        level: 'info',
        title: `Tồn đọng ${job.label}`,
        detail: `${backlog} dòng cũ hơn ${job.retentionDays} ngày chưa được dọn.`,
        actionTab: 'automation'
      });
    }
  }
  if (input.diskUsedPercent !== null && input.diskUsedPercent >= 90) {
    items.push({
      id: 'disk-high',
      level: 'critical',
      title: 'Đĩa gần đầy',
      detail: `Đĩa đang dùng ${input.diskUsedPercent.toFixed(1)}%. Dọn dữ liệu hoặc backup ra ngoài.`,
      actionTab: 'automation'
    });
  }
  return items;
}

async function tableMetric(): Promise<{
  status: 'ok' | 'error';
  admin: { sizeBytes: number; tables: TableSize[] };
  runtime: { sizeBytes: number; tables: TableSize[] };
  rows: TableRow[];
}> {
  try {
    const rows = await withTimeout(
      query<TableRow[]>(
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA IN (?, ?)`,
        [config.mysql.adminDatabase, config.mysql.runtimeDatabase]
      ),
      2500
    );
    const split = splitTables(rows, config.mysql.adminDatabase);
    return { status: 'ok', admin: split.admin, runtime: split.runtime, rows };
  } catch {
    return {
      status: 'error',
      admin: { sizeBytes: 0, tables: [] },
      runtime: { sizeBytes: 0, tables: [] },
      rows: []
    };
  }
}

async function poolMetric() {
  try {
    const core = adminPool.pool as any;
    return {
      totalConnections: core?._allConnections?.length ?? null,
      freeConnections: core?._freeConnections?.length ?? null,
      queue: core?._connectionQueue?.length ?? null,
      connectionLimit: core?.config?.connectionLimit ?? null
    };
  } catch {
    return null;
  }
}

async function mysqlLatency(): Promise<number | null> {
  const started = performance.now();
  try {
    await withTimeout(adminPool.query('SELECT 1'), 2000);
    return performance.now() - started;
  } catch {
    return null;
  }
}

async function slowQueries() {
  try {
    const rows = await withTimeout(
      query<RowDataPacket[]>(
        `SELECT DIGEST_TEXT AS digestText, COUNT_STAR AS calls,
                ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS totalSeconds
           FROM performance_schema.events_statements_summary_by_digest
          WHERE DIGEST_TEXT IS NOT NULL
          ORDER BY SUM_TIMER_WAIT DESC
          LIMIT 10`
      ),
      1500
    );
    return {
      available: true as const,
      items: rows.map((row) => ({
        digestText: String(row.digestText),
        calls: Number(row.calls ?? 0),
        totalSeconds: Number(row.totalSeconds ?? 0)
      }))
    };
  } catch {
    return { available: false as const, reason: 'performance_schema không khả dụng' };
  }
}

async function diskMetric() {
  try {
    const stat = await statfs(process.cwd());
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bfree) * Number(stat.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      available: true as const,
      totalBytes,
      freeBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
      growthBytesPerDay: null,
      projectedFullDays: null
    };
  } catch {
    return { available: false as const, reason: 'Không đọc được dung lượng đĩa' };
  }
}

async function goMetric() {
  const started = performance.now();
  try {
    const [quality, snapshot] = await Promise.all([
      callGoInternal<any>('/internal/rtcm/health', undefined, { method: 'GET', timeoutMs: 2000 }),
      callGoInternal<{ items: any[] }>('/internal/snapshot', undefined, {
        method: 'GET',
        timeoutMs: 2000
      })
    ]);
    return {
      reachable: true as const,
      latencyMs: performance.now() - started,
      quality: quality ?? null,
      relay: (snapshot?.items ?? []).map((item) => ({
        jobId: Number(item.jobId ?? 0),
        state: String(item.state ?? ''),
        monitorDrops: Number(item.monitorDrops ?? 0),
        crcErrors: Number(item.crcErrors ?? 0),
        retries: Number(item.retries ?? 0)
      }))
    };
  } catch {
    return {
      reachable: false as const,
      latencyMs: performance.now() - started,
      quality: null,
      relay: []
    };
  }
}

async function retentionMetric(): Promise<RetentionJob[]> {
  let rows: RowDataPacket[];
  try {
    rows = await withTimeout(
      query<RowDataPacket[]>(
        `SELECT job_key, label, scope, table_name, retention_days, enabled
           FROM maintenance_jobs
          ORDER BY FIELD(scope, 'runtime', 'admin'), job_key`
      ),
      2000
    );
  } catch {
    return [];
  }
  const jobs = await Promise.all(
    rows.map(async (row) => {
      const key = String(row.job_key);
      const spec = BACKLOG_SQL[key];
      const base = {
        key,
        label: String(row.label),
        scope: String(row.scope) as 'admin' | 'runtime',
        table: String(row.table_name),
        retentionDays: Number(row.retention_days),
        enabled: Number(row.enabled) === 1,
        backlogRows: null as number | null
      };
      if (!spec) return base;
      try {
        const sql = `SELECT COUNT(*) c FROM \`${spec.table}\` WHERE ${spec.condition(base.retentionDays)}`;
        const result =
          spec.schema === 'runtime'
            ? await withTimeout(runtimeQuery<RowDataPacket[]>(sql), 1500)
            : await withTimeout(query<RowDataPacket[]>(sql), 1500);
        return { ...base, backlogRows: Number(result[0]?.c ?? 0) };
      } catch {
        return base;
      }
    })
  );
  return jobs;
}

async function eventLoopLagMs(): Promise<number> {
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Math.max(0, performance.now() - start - 50);
}

async function collect() {
  const memory = process.memoryUsage();
  const heapPercent = memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) * 100 : 0;
  const loopLag = await eventLoopLagMs();
  const [tables, pool, latency, slow, disk, go, retention] = await Promise.all([
    tableMetric(),
    poolMetric(),
    mysqlLatency(),
    slowQueries(),
    diskMetric(),
    goMetric(),
    retentionMetric()
  ]);
  const recommendations = buildRecommendations({
    heapPercent,
    eventLoopLagMs: loopLag,
    mysqlLatencyMs: latency ?? 0,
    quality: go.quality,
    tables: [...tables.admin.tables, ...tables.runtime.tables],
    retention,
    diskUsedPercent: disk.available ? disk.usedPercent : null
  });
  return {
    generatedAt: new Date().toISOString(),
    cacheTtlSec: CACHE_TTL_MS / 1000,
    cached: false,
    database: {
      status: tables.status,
      admin: tables.admin,
      runtime: tables.runtime,
      growth: [],
      pool,
      latencyMs: latency,
      slowQueries: slow
    },
    go,
    node: {
      heapPercent,
      eventLoopLagMs: loopLag,
      rssBytes: memory.rss,
      socketClients: socketClientCount()
    },
    disk,
    retention: { jobs: retention },
    recommendations
  };
}

let cache: { at: number; data: any } | null = null;
let inflight: Promise<any> | null = null;

export async function getSystemOptimize(): Promise<any> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }
  if (inflight) return inflight;
  inflight = collect()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
