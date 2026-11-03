import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { query } from '../db/pool';
import { callGoInternal } from '../lib/internalApi';
import { runtimeQuery } from '../db/runtimePool';
import type {
  RawAlert,
  RawConnection,
  RawData,
  RawJob,
  RawMountpoint,
  RawRelayMetric,
  RawStation
} from './filter';

interface GoMetrics {
  jobId: number;
  state: string;
  appliedRevision: number;
  bytesUp: number;
  bytesDown: number;
  frames: number;
  crcErrors: number;
  lastDataAt?: string;
  lastError?: string;
}

interface GoConnection {
  id: number;
  direction: string;
  listenerId: number;
  mountpointId: number;
  accountId: number | null;
  remoteAddr: string;
  userAgent?: string;
  startTs: string;
  bytesIn: number;
  bytesOut: number;
}

let baseCache: { at: number; value: RawData } | null = null;
let baseInflight: Promise<RawData> | null = null;

export function invalidateBaseDataCache(): void {
  baseCache = null;
}

export async function loadBaseData(force = false): Promise<RawData> {
  const now = Date.now();
  if (!force && baseCache && now - baseCache.at < config.realtime.baseCacheMs) {
    return baseCache.value;
  }
  if (!force && baseInflight) return baseInflight;
  const inflight = fetchBaseData();
  baseInflight = inflight;
  try {
    const value = await inflight;
    baseCache = { at: Date.now(), value };
    return value;
  } finally {
    if (baseInflight === inflight) baseInflight = null;
  }
}

async function fetchBaseData(): Promise<RawData> {
  const jobRows = await query<RowDataPacket[]>(
    `SELECT id, name, enabled, owner_web_user_id
       FROM relay_jobs
      WHERE deleted_at IS NULL`
  );
  const jobs: RawJob[] = jobRows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    ownerId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id)
  }));

  const stationRows = await query<RowDataPacket[]>(
    'SELECT id, enabled, status, owner_web_user_id FROM stations'
  );
  const stations: RawStation[] = stationRows.map((row) => ({
    id: Number(row.id),
    enabled: Boolean(row.enabled),
    status: String(row.status ?? ''),
    ownerId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id)
  }));

  const mountpointRows = await query<RowDataPacket[]>(
    'SELECT id, station_id, owner_web_user_id FROM mountpoints'
  );
  const mountpoints: RawMountpoint[] = mountpointRows.map((row) => ({
    id: Number(row.id),
    stationId: row.station_id === null ? null : Number(row.station_id),
    ownerId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id)
  }));

  const listenerRows = await query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM caster_listeners WHERE enabled = 1'
  );
  const listenersCount = Number(listenerRows[0]?.total ?? 0);

  let relay: RawRelayMetric[] = [];
  let goOk = true;
  let stale = false;
  try {
    const response = await callGoInternal<{ items: GoMetrics[] }>(
      '/internal/snapshot',
      undefined,
      { method: 'GET', timeoutMs: 1500 }
    );
    relay = (response?.items ?? []).map((item) => ({
      jobId: Number(item.jobId),
      state: String(item.state || 'unknown'),
      appliedRevision: Number(item.appliedRevision ?? 0),
      bytesUp: Number(item.bytesUp ?? 0),
      bytesDown: Number(item.bytesDown ?? 0),
      frames: Number(item.frames ?? 0),
      crcErrors: Number(item.crcErrors ?? 0),
      lastDataAt: item.lastDataAt,
      lastError: item.lastError
    }));
  } catch {
    goOk = false;
    stale = true;
    relay = await fallbackRelayMetrics(jobs);
  }

  let connections: RawConnection[] = [];
  let casterOk = true;
  try {
    const response = await callGoInternal<{ items: GoConnection[] }>(
      '/internal/caster/connections',
      undefined,
      { method: 'GET', timeoutMs: 1500 }
    );
    connections = (response?.items ?? []).map((item) => ({
      id: Number(item.id),
      direction: String(item.direction || ''),
      listenerId: Number(item.listenerId ?? 0),
      mountpointId: Number(item.mountpointId ?? 0),
      accountId: item.accountId === null || item.accountId === undefined ? null : Number(item.accountId),
      remoteAddr: String(item.remoteAddr ?? ''),
      userAgent: String(item.userAgent ?? ''),
      startTs: String(item.startTs ?? ''),
      bytesIn: Number(item.bytesIn ?? 0),
      bytesOut: Number(item.bytesOut ?? 0)
    }));
  } catch {
    casterOk = false;
  }

  return {
    relay,
    connections,
    jobs,
    stations,
    mountpoints,
    listenersCount,
    goOk,
    casterOk,
    stale,
    ts: new Date().toISOString()
  };
}

async function fallbackRelayMetrics(jobs: RawJob[]): Promise<RawRelayMetric[]> {
  if (jobs.length === 0) return [];
  try {
    const rows = await runtimeQuery<RowDataPacket[]>(
      `SELECT relay_job_id, runtime_state, applied_revision, last_error
         FROM relay_job_state
        WHERE relay_job_id IN (?)`,
      [jobs.map((job) => job.id)]
    );
    return rows.map((row) => ({
      jobId: Number(row.relay_job_id),
      state: String(row.runtime_state || 'unknown'),
      appliedRevision: Number(row.applied_revision ?? 0),
      bytesUp: 0,
      bytesDown: 0,
      frames: 0,
      crcErrors: 0,
      lastError: row.last_error === null || row.last_error === undefined ? undefined : String(row.last_error)
    }));
  } catch {
    return jobs.map((job) => ({
      jobId: job.id,
      state: 'unknown',
      appliedRevision: 0,
      bytesUp: 0,
      bytesDown: 0,
      frames: 0,
      crcErrors: 0
    }));
  }
}

export async function loadOpenAlerts(): Promise<RawAlert[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, type, severity, target_type, target_id, title, message, status,
            owner_web_user_id, created_at
       FROM alerts
      WHERE status = 'open'
      ORDER BY id DESC
      LIMIT 200`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    type: String(row.type),
    severity: String(row.severity),
    targetType: String(row.target_type),
    targetId: row.target_id === null ? null : Number(row.target_id),
    title: String(row.title),
    message: String(row.message ?? ''),
    status: String(row.status),
    ownerId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
    createdAt: new Date(row.created_at).toISOString()
  }));
}
