import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { adminPool } from '../db/pool';
import { callGoInternal } from './internalApi';
import {
  hostHealthStatus,
  nodeHealthStatus,
  overallHealthStatus,
  type HealthStatus
} from './healthStatus';
import { socketClientCount } from '../realtime/socket';

type Status = HealthStatus;

const CACHE_TTL_MS = 12_000;

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

function cpuTimes(): { total: number; idle: number } {
  let total = 0;
  let idle = 0;
  for (const cpu of os.cpus()) {
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    idle += cpu.times.idle;
  }
  return { total, idle };
}

let previousCpu = cpuTimes();
let previousProcess = process.cpuUsage();
let previousCpuAt = Date.now();

function cpuPercentages(): { hostCpuPercent: number; processCpuPercent: number } {
  const current = cpuTimes();
  const now = Date.now();
  const totalDelta = current.total - previousCpu.total;
  const idleDelta = current.idle - previousCpu.idle;
  const processDelta = process.cpuUsage(previousProcess);
  const wallMs = Math.max(1, now - previousCpuAt);
  const hostCpuPercent =
    totalDelta > 0 ? Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100)) : 0;
  const processCpuPercent = Math.max(
    0,
    ((processDelta.user + processDelta.system) / 1000 / wallMs) * 100
  );
  previousCpu = current;
  previousProcess = process.cpuUsage();
  previousCpuAt = now;
  return { hostCpuPercent, processCpuPercent };
}

async function eventLoopLagMs(): Promise<number> {
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Math.max(0, performance.now() - start - 50);
}

async function diskMetric(): Promise<
  | { status: Status; totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number }
  | { status: Status; reason: string }
> {
  try {
    const stat = await statfs(process.cwd());
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bfree) * Number(stat.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      status: 'ok',
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
    };
  } catch {
    return { status: 'unknown', reason: 'Không đọc được dung lượng đĩa trên môi trường này' };
  }
}

async function mysqlMetric() {
  const started = performance.now();
  try {
    await withTimeout(adminPool.query('SELECT 1'), 2500);
    const latencyMs = performance.now() - started;
    const [rows] = await withTimeout(
      adminPool.query<any[]>(
        "SELECT MAX(version) AS version FROM schema_migrations WHERE scope = 'admin'"
      ),
      2000
    );
    const core = adminPool.pool as any;
    const totalConnections = core?._allConnections?.length ?? null;
    const freeConnections = core?._freeConnections?.length ?? null;
    const queue = core?._connectionQueue?.length ?? null;
    return {
      status: (latencyMs >= 1000 ? 'error' : latencyMs >= 300 ? 'warn' : 'ok') as Status,
      latencyMs,
      schemaVersion: Number(rows[0]?.version ?? 0),
      pool: {
        totalConnections,
        freeConnections,
        queue,
        connectionLimit: core?.config?.connectionLimit ?? null
      }
    };
  } catch {
    return {
      status: 'error' as Status,
      latencyMs: performance.now() - started,
      schemaVersion: null,
      pool: null,
      error: 'Không kết nối được MySQL'
    };
  }
}

async function goCall<T>(path: string): Promise<{ ok: boolean; latencyMs: number; data?: T }> {
  const started = performance.now();
  try {
    const data = await callGoInternal<T>(path, undefined, { method: 'GET', timeoutMs: 2000 });
    return { ok: true, latencyMs: performance.now() - started, data };
  } catch {
    return { ok: false, latencyMs: performance.now() - started };
  }
}

async function goMetric() {
  const [health, snapshot, connections, listeners] = await Promise.all([
    goCall<any>('/internal/rtcm/health'),
    goCall<{ items: unknown[] }>('/internal/snapshot'),
    goCall<{ items: unknown[] }>('/internal/caster/connections'),
    goCall<{ items: unknown[] }>('/internal/caster/listeners')
  ]);
  if (!health.ok) {
    return {
      status: 'error' as Status,
      reachable: false,
      latencyMs: health.latencyMs,
      error: 'Không gọi được Go internal (timeout hoặc HMAC lỗi)',
      quality: null,
      relayJobs: null,
      casterConnections: null,
      casterListeners: null
    };
  }
  const quality = health.data;
  return {
    status: (quality?.status === 'disabled' ? 'warn' : 'ok') as Status,
    reachable: true,
    latencyMs: health.latencyMs,
    error: null,
    quality,
    relayJobs: snapshot.ok ? snapshot.data?.items?.length ?? 0 : null,
    casterConnections: connections.ok ? connections.data?.items?.length ?? 0 : null,
    casterListeners: listeners.ok ? listeners.data?.items?.length ?? 0 : null
  };
}

let cache: { at: number; data: any } | null = null;
let inflight: Promise<any> | null = null;

async function collect() {
  const cpu = cpuPercentages();
  const loopLag = await eventLoopLagMs();
  const memory = process.memoryUsage();
  const heapPercent = memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) * 100 : 0;
  const hostTotal = os.totalmem();
  const hostFree = os.freemem();
  const hostUsed = hostTotal - hostFree;
  const memoryPercent = hostTotal > 0 ? (hostUsed / hostTotal) * 100 : 0;
  const [disk, mysql, go] = await Promise.all([diskMetric(), mysqlMetric(), goMetric()]);
  const diskPercent = 'usedPercent' in disk ? disk.usedPercent : null;
  const node = {
    status: nodeHealthStatus({ heapPercent, eventLoopLagMs: loopLag }),
    uptimeSec: process.uptime(),
    pid: process.pid,
    nodeVersion: process.version,
    cpuPercent: cpu.processCpuPercent,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    heapPercent,
    eventLoopLagMs: loopLag,
    socketClients: socketClientCount()
  };
  const host = {
    status: hostHealthStatus({ memoryPercent, diskPercent }),
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpuCount: os.cpus().length,
    cpuPercent: cpu.hostCpuPercent,
    loadavg:
      os.platform() === 'win32'
        ? null
        : os.loadavg().map((value) => Number(value.toFixed(2))),
    loadavgReason:
      os.platform() === 'win32' ? 'Windows không cung cấp load average chuẩn Unix' : null,
    uptimeSec: os.uptime(),
    memory: {
      totalBytes: hostTotal,
      usedBytes: hostUsed,
      freeBytes: hostFree,
      usedPercent: memoryPercent
    },
    disk,
    network: { status: 'unknown', reason: 'Không thu thập network metric ở P0' }
  };
  const statuses: Status[] = [node.status, host.status, mysql.status, go.status];
  const overall: Status = overallHealthStatus(statuses);
  return {
    status: overall,
    generatedAt: new Date().toISOString(),
    cacheTtlSec: CACHE_TTL_MS / 1000,
    cached: false,
    node,
    host,
    mysql,
    go
  };
}

export async function getSystemHealth(): Promise<any> {
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
