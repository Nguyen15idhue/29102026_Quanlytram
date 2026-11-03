import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown';

export interface SystemHealthResponse {
  status: HealthStatus;
  generatedAt: string;
  cacheTtlSec: number;
  cached: boolean;
  node: {
    status: HealthStatus;
    uptimeSec: number;
    pid: number;
    nodeVersion: string;
    cpuPercent: number;
    rssBytes: number;
    rssPercent?: number;
    memoryLimitBytes?: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    heapPercent: number;
    eventLoopLagMs: number;
    socketClients: number;
  };
  host: {
    status: HealthStatus;
    platform: string;
    release: string;
    architecture: string;
    cpuCount: number;
    cpuPercent: number;
    loadavg: number[] | null;
    loadavgReason: string | null;
    uptimeSec: number;
    memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number };
    disk:
      | {
          status: HealthStatus;
          totalBytes: number;
          usedBytes: number;
          freeBytes: number;
          usedPercent: number;
        }
      | { status: HealthStatus; reason: string };
    network: { status: HealthStatus; reason: string };
  };
  mysql: {
    status: HealthStatus;
    latencyMs: number;
    schemaVersion: number | null;
    pool: {
      totalConnections: number | null;
      freeConnections: number | null;
      queue: number | null;
      connectionLimit: number | null;
    } | null;
    error?: string;
  };
  go: {
    status: HealthStatus;
    reachable: boolean;
    latencyMs: number;
    error: string | null;
    quality: {
      queueDepth?: number;
      queueSize?: number;
      dropped?: number;
      parseErrors?: number;
      targets?: number;
      alertsOpen?: number;
      storeDrops?: number;
      time?: string;
      status?: string;
    } | null;
    relayJobs: number | null;
    casterConnections: number | null;
    casterListeners: number | null;
    /** true = Go báo relay suy giảm; null = chưa đọc được /health. */
    relayDegraded: boolean | null;
    relayHealthStatus: string | null;
  };
}

/**
 * Snapshot sức khỏe hệ thống (cache server 12s). Dùng chung query key để
 * topbar banner và trang System Health không gọi trùng.
 */
export function useSystemHealth(enabled = true) {
  return useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiFetch<SystemHealthResponse>('/api/system/health'),
    refetchInterval: 12_000,
    enabled
  });
}
