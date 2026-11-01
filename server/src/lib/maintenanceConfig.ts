import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { ApiError } from './http';
import { writeAudit } from './audit';

export interface MaintenanceJob {
  key: string;
  label: string;
  scope: 'admin' | 'runtime';
  table: string;
  retentionDays: number;
  batchSize: number;
  intervalSec: number;
  enabled: boolean;
  updatedAt: string | null;
}

export interface MaintenanceSettings {
  schedulerEnabled: boolean;
  hourLocal: number;
  minuteLocal: number;
  timezone: string;
  updatedAt: string | null;
}

export interface JobUpdate {
  retentionDays: number;
  batchSize: number;
  intervalSec: number;
  enabled: boolean;
  expectedUpdatedAt?: string | null;
}

export interface SettingsUpdate {
  schedulerEnabled: boolean;
  hourLocal: number;
  minuteLocal: number;
  expectedUpdatedAt?: string | null;
}

const CACHE_TTL_MS = 30_000;

let jobsCache: { at: number; items: MaintenanceJob[] } | null = null;
let settingsCache: { at: number; value: MaintenanceSettings } | null = null;

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapJob(row: RowDataPacket): MaintenanceJob {
  return {
    key: String(row.job_key),
    label: String(row.label),
    scope: String(row.scope) as 'admin' | 'runtime',
    table: String(row.table_name),
    retentionDays: Number(row.retention_days),
    batchSize: Number(row.batch_size),
    intervalSec: Number(row.interval_sec),
    enabled: Number(row.enabled) === 1,
    updatedAt: toIso(row.updated_at)
  };
}

function mapSettings(row: RowDataPacket | undefined): MaintenanceSettings {
  if (!row) {
    return {
      schedulerEnabled: true,
      hourLocal: 3,
      minuteLocal: 0,
      timezone: 'Asia/Ho_Chi_Minh',
      updatedAt: null
    };
  }
  return {
    schedulerEnabled: Number(row.scheduler_enabled) === 1,
    hourLocal: Number(row.run_hour_local),
    minuteLocal: Number(row.run_minute_local),
    timezone: String(row.timezone),
    updatedAt: toIso(row.updated_at)
  };
}

function validateInt(value: unknown, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, 'VALIDATION', `${name} phải trong khoảng ${min}..${max}`);
  }
  return parsed;
}

function validateBool(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  throw new ApiError(400, 'VALIDATION', `${name} phải là boolean`);
}

export function invalidateMaintenanceConfig(): void {
  jobsCache = null;
  settingsCache = null;
}

export async function listJobs(force = false): Promise<MaintenanceJob[]> {
  if (!force && jobsCache && Date.now() - jobsCache.at < CACHE_TTL_MS) {
    return jobsCache.items;
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT job_key, label, scope, table_name, retention_days, batch_size,
            interval_sec, enabled, updated_at
       FROM maintenance_jobs
      ORDER BY FIELD(scope, 'runtime', 'admin'), job_key`
  );
  const items = rows.map(mapJob);
  jobsCache = { at: Date.now(), items };
  return items;
}

export async function getJob(key: string): Promise<MaintenanceJob | null> {
  const items = await listJobs(true);
  return items.find((item) => item.key === key) ?? null;
}

export async function getSettings(force = false): Promise<MaintenanceSettings> {
  if (!force && settingsCache && Date.now() - settingsCache.at < CACHE_TTL_MS) {
    return settingsCache.value;
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT scheduler_enabled, run_hour_local, run_minute_local, timezone, updated_at
       FROM maintenance_settings WHERE id = 1 LIMIT 1`
  );
  const value = mapSettings(rows[0]);
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function updateJob(
  key: string,
  input: JobUpdate,
  actorId: number,
  ip: string
): Promise<MaintenanceJob> {
  const current = await getJob(key);
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy job');
  if (input.expectedUpdatedAt && current.updatedAt && input.expectedUpdatedAt !== current.updatedAt) {
    throw new ApiError(409, 'CONFLICT', 'Cấu hình đã thay đổi, tải lại trước khi lưu');
  }
  const retentionDays = validateInt(input.retentionDays, 'retentionDays', 1, 3650);
  const batchSize = validateInt(input.batchSize, 'batchSize', 100, 50000);
  const intervalSec = validateInt(input.intervalSec, 'intervalSec', 300, 86400);
  const enabled = validateBool(input.enabled, 'enabled');
  await adminPool.query(
    `UPDATE maintenance_jobs
        SET retention_days = ?, batch_size = ?, interval_sec = ?, enabled = ?,
            updated_by = ?
      WHERE job_key = ?`,
    [retentionDays, batchSize, intervalSec, enabled ? 1 : 0, actorId, key]
  );
  invalidateMaintenanceConfig();
  const updated = await getJob(key);
  if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy job');
  await writeAudit(
    adminPool,
    actorId,
    'maintenance.config',
    'maintenance_job',
    key,
    {
      retention_days: current.retentionDays,
      batch_size: current.batchSize,
      interval_sec: current.intervalSec,
      enabled: current.enabled
    },
    {
      retention_days: updated.retentionDays,
      batch_size: updated.batchSize,
      interval_sec: updated.intervalSec,
      enabled: updated.enabled
    },
    ip
  );
  return updated;
}

export async function updateSettings(
  input: SettingsUpdate,
  actorId: number,
  ip: string
): Promise<MaintenanceSettings> {
  const current = await getSettings(true);
  if (input.expectedUpdatedAt && current.updatedAt && input.expectedUpdatedAt !== current.updatedAt) {
    throw new ApiError(409, 'CONFLICT', 'Cấu hình đã thay đổi, tải lại trước khi lưu');
  }
  const schedulerEnabled = validateBool(input.schedulerEnabled, 'schedulerEnabled');
  const hourLocal = validateInt(input.hourLocal, 'hourLocal', 0, 23);
  const minuteLocal = validateInt(input.minuteLocal, 'minuteLocal', 0, 59);
  await adminPool.query(
    `UPDATE maintenance_settings
        SET scheduler_enabled = ?, run_hour_local = ?, run_minute_local = ?,
            updated_by = ?
      WHERE id = 1`,
    [schedulerEnabled ? 1 : 0, hourLocal, minuteLocal, actorId]
  );
  invalidateMaintenanceConfig();
  const updated = await getSettings(true);
  await writeAudit(
    adminPool,
    actorId,
    'maintenance.settings',
    'maintenance_settings',
    1,
    {
      scheduler_enabled: current.schedulerEnabled,
      run_hour_local: current.hourLocal,
      run_minute_local: current.minuteLocal
    },
    {
      scheduler_enabled: updated.schedulerEnabled,
      run_hour_local: updated.hourLocal,
      run_minute_local: updated.minuteLocal
    },
    ip
  );
  return updated;
}
