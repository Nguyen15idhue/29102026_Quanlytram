import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { writeAudit } from './audit';
import { ApiError } from './http';
import { callGoInternal } from './internalApi';
import {
  getJob,
  getSettings,
  listJobs,
  type MaintenanceJob,
  type MaintenanceSettings
} from './maintenanceConfig';

export interface MaintenanceRun {
  id: number;
  jobKey: string;
  scope: 'admin' | 'runtime';
  table: string;
  dryRun: boolean;
  status: 'running' | 'ok' | 'error';
  rowsDeleted: number;
  durationMs: number;
  error: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface AdminSpec {
  table: string;
  where: (days: number) => string;
  orderBy: string;
}

const ADMIN_SPECS: Record<string, AdminSpec> = {
  'web-sessions': {
    table: 'web_sessions',
    where: (days) => `expires_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`,
    orderBy: 'expires_at'
  },
  'audit-logs': {
    table: 'audit_logs',
    where: (days) => `created_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`,
    orderBy: 'id'
  },
  'acked-alerts': {
    table: 'alerts',
    where: (days) =>
      `status = 'acked' AND acked_at IS NOT NULL AND acked_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`,
    orderBy: 'id'
  }
};

const RUN_TIMEOUT_MS = 60_000;
const locks = new Set<string>();
let schedulerTimer: NodeJS.Timeout | null = null;
let lastRunDate: string | null = null;

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

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRun(row: RowDataPacket): MaintenanceRun {
  return {
    id: Number(row.id),
    jobKey: String(row.job_key),
    scope: String(row.scope) as 'admin' | 'runtime',
    table: String(row.table_name),
    dryRun: Number(row.dry_run) === 1,
    status: String(row.status) as MaintenanceRun['status'],
    rowsDeleted: Number(row.rows_deleted),
    durationMs: Number(row.duration_ms),
    error: String(row.error ?? ''),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at)
  };
}

async function insertRun(job: MaintenanceJob, dryRun: boolean, actorId: number | null): Promise<number> {
  const [result] = await adminPool.query<any>(
    `INSERT INTO maintenance_runs
       (job_key, scope, table_name, dry_run, status, started_at, triggered_by)
     VALUES (?, ?, ?, ?, 'running', UTC_TIMESTAMP(3), ?)`,
    [job.key, job.scope, job.table, dryRun ? 1 : 0, actorId]
  );
  return Number(result.insertId);
}

async function finishRun(
  id: number,
  status: 'ok' | 'error',
  rowsDeleted: number,
  durationMs: number,
  error = ''
): Promise<void> {
  await adminPool.query(
    `UPDATE maintenance_runs
        SET status = ?, rows_deleted = ?, duration_ms = ?, error = ?,
            finished_at = UTC_TIMESTAMP(3)
      WHERE id = ?`,
    [status, rowsDeleted, durationMs, error.slice(0, 500), id]
  );
}

async function countAdmin(spec: AdminSpec, days: number): Promise<number> {
  const rows = await withTimeout(
    query<RowDataPacket[]>(`SELECT COUNT(*) c FROM \`${spec.table}\` WHERE ${spec.where(days)}`),
    15_000
  );
  return Number(rows[0]?.c ?? 0);
}

async function deleteAdmin(spec: AdminSpec, days: number, batch: number): Promise<number> {
  const [result] = await withTimeout(
    adminPool.query<any>(
      `DELETE FROM \`${spec.table}\`
        WHERE ${spec.where(days)}
        ORDER BY ${spec.orderBy}
        LIMIT ?`,
      [batch]
    ),
    15_000
  );
  return Number(result.affectedRows ?? 0);
}

async function runAdminJob(
  job: MaintenanceJob,
  dryRun: boolean,
  actorId: number | null,
  ip: string
): Promise<{ runId: number; jobKey: string; dryRun: boolean; status: 'ok'; rowsDeleted: number; durationMs: number }> {
  const spec = ADMIN_SPECS[job.key];
  if (!spec) throw new ApiError(400, 'UNSUPPORTED_JOB', 'Job admin chưa được hỗ trợ');
  const started = Date.now();
  const runId = await insertRun(job, dryRun, actorId);
  try {
    let rowsDeleted = 0;
    if (dryRun) {
      rowsDeleted = await countAdmin(spec, job.retentionDays);
    } else {
      const deadline = Date.now() + RUN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const affected = await deleteAdmin(spec, job.retentionDays, job.batchSize);
        rowsDeleted += affected;
        if (affected < job.batchSize) break;
      }
    }
    const durationMs = Date.now() - started;
    await finishRun(runId, 'ok', rowsDeleted, durationMs);
    await writeAudit(
      adminPool,
      actorId,
      'maintenance.run',
      'maintenance_job',
      job.key,
      undefined,
      { dryRun, status: 'ok', rowsDeleted, durationMs },
      ip
    );
    return { runId, jobKey: job.key, dryRun, status: 'ok', rowsDeleted, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : 'maintenance failed';
    await finishRun(runId, 'error', 0, durationMs, message);
    await writeAudit(
      adminPool,
      actorId,
      'maintenance.run',
      'maintenance_job',
      job.key,
      undefined,
      { dryRun, status: 'error', error: message },
      ip
    );
    throw new ApiError(500, 'MAINTENANCE_FAILED', 'Không chạy được job dọn dẹp');
  }
}

async function runRuntimeJob(
  job: MaintenanceJob,
  dryRun: boolean,
  actorId: number | null,
  ip: string
): Promise<{ runId: number; jobKey: string; dryRun: boolean; status: 'ok'; rowsDeleted: number; durationMs: number }> {
  const started = Date.now();
  const runId = await insertRun(job, dryRun, actorId);
  try {
    const result = await withTimeout(
      callGoInternal<{ rows?: number }>(
        '/internal/maintenance/prune',
        { jobKey: job.key, dryRun },
        { method: 'POST', timeoutMs: RUN_TIMEOUT_MS }
      ),
      RUN_TIMEOUT_MS + 2_000
    );
    const rowsDeleted = Number(result?.rows ?? 0);
    const durationMs = Date.now() - started;
    await finishRun(runId, 'ok', rowsDeleted, durationMs);
    await writeAudit(
      adminPool,
      actorId,
      'maintenance.run',
      'maintenance_job',
      job.key,
      undefined,
      { dryRun, status: 'ok', rowsDeleted, durationMs },
      ip
    );
    return { runId, jobKey: job.key, dryRun, status: 'ok', rowsDeleted, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : 'go maintenance failed';
    await finishRun(runId, 'error', 0, durationMs, message);
    await writeAudit(
      adminPool,
      actorId,
      'maintenance.run',
      'maintenance_job',
      job.key,
      undefined,
      { dryRun, status: 'error', error: message },
      ip
    );
    throw new ApiError(502, 'GO_UNAVAILABLE', 'Go chưa sẵn sàng dọn dẹp runtime');
  }
}

export async function runJob(
  jobKey: string,
  dryRun: boolean,
  actorId: number | null,
  ip: string
) {
  if (locks.has(jobKey)) throw new ApiError(409, 'JOB_RUNNING', 'Job đang chạy');
  locks.add(jobKey);
  try {
    const job = await getJob(jobKey);
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy job');
    if (job.scope === 'runtime') return await runRuntimeJob(job, dryRun, actorId, ip);
    return await runAdminJob(job, dryRun, actorId, ip);
  } finally {
    locks.delete(jobKey);
  }
}

export async function reconcileGoMaintenance(): Promise<void> {
  try {
    await callGoInternal('/internal/maintenance/reconcile', {}, { method: 'POST', timeoutMs: 3000 });
  } catch {
    return;
  }
}

export async function lastRunMap(): Promise<
  Map<string, { status: string; rowsDeleted: number; finishedAt: string | null }>
> {
  const rows = await query<RowDataPacket[]>(
    `SELECT r.job_key, r.status, r.rows_deleted, r.finished_at
       FROM maintenance_runs r
       JOIN (SELECT job_key, MAX(id) id FROM maintenance_runs GROUP BY job_key) x
         ON x.id = r.id`
  );
  const map = new Map<string, { status: string; rowsDeleted: number; finishedAt: string | null }>();
  for (const row of rows) {
    map.set(String(row.job_key), {
      status: String(row.status),
      rowsDeleted: Number(row.rows_deleted),
      finishedAt: toIso(row.finished_at)
    });
  }
  return map;
}

export function nextDailyRun(settings: MaintenanceSettings, now = new Date()): string | null {
  if (!settings.schedulerEnabled) return null;
  const parts = localParts(now, settings.timezone);
  const candidate = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, settings.hourLocal, settings.minuteLocal)
  );
  const offsetMinutes = timezoneOffsetMinutes(now, settings.timezone);
  let next = new Date(candidate.getTime() - offsetMinutes * 60_000);
  if (next.getTime() <= now.getTime()) next = new Date(next.getTime() + 24 * 3600_000);
  return next.toISOString();
}

function timezoneOffsetMinutes(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function localParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute')
  };
}

async function isDue(job: MaintenanceJob, now = Date.now()): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT finished_at FROM maintenance_runs
      WHERE job_key = ? AND status = 'ok'
      ORDER BY id DESC LIMIT 1`,
    [job.key]
  );
  const last = rows[0]?.finished_at ? new Date(rows[0].finished_at).getTime() : null;
  if (last === null) return true;
  return now - last >= job.intervalSec * 1000;
}

async function tick(): Promise<void> {
  try {
    const settings = await getSettings(true);
    if (!settings.schedulerEnabled) return;
    const parts = localParts(new Date(), settings.timezone);
    if (parts.hour !== settings.hourLocal || parts.minute !== settings.minuteLocal) return;
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    if (lastRunDate === dateKey) return;
    lastRunDate = dateKey;
    const jobs = await listJobs(true);
    for (const job of jobs) {
      if (!job.enabled || job.scope !== 'admin') continue;
      if (!(await isDue(job))) continue;
      try {
        await runJob(job.key, false, null, 'scheduler');
      } catch (err) {
        console.error('[maintenance] scheduler job failed', job.key, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[maintenance] scheduler tick failed', err instanceof Error ? err.message : err);
  }
}

export function startMaintenanceScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => void tick(), 60_000);
  schedulerTimer.unref();
}

export async function listRuns(
  page: number,
  pageSize: number,
  jobKey?: string
): Promise<{ items: MaintenanceRun[]; total: number; page: number; pageSize: number }> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeSize = [10, 20, 50].includes(pageSize) ? pageSize : 10;
  const where = jobKey ? 'WHERE job_key = ?' : '';
  const params = jobKey ? [jobKey] : [];
  const [countRows, rows] = await Promise.all([
    query<RowDataPacket[]>(`SELECT COUNT(*) c FROM maintenance_runs ${where}`, params),
    query<RowDataPacket[]>(
      `SELECT id, job_key, scope, table_name, dry_run, status, rows_deleted,
              duration_ms, error, started_at, finished_at
         FROM maintenance_runs
         ${where}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      [...params, safeSize, (safePage - 1) * safeSize]
    )
  ]);
  return {
    items: rows.map(mapRun),
    total: Number(countRows[0]?.c ?? 0),
    page: safePage,
    pageSize: safeSize
  };
}
