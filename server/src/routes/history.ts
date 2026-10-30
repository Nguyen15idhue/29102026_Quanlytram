import { Router, type Request } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { asyncHandler, ApiError } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { listScope, pageFrom, scopeIdsFor } from '../rbac/access';

export const historyRouter = Router();
historyRouter.use(requireAuth);
historyRouter.use(csrfProtection);

interface AllowedJobs {
  ids: number[];
  names: Map<number, string>;
  selected: number | null;
}

function parseDate(value: unknown, label: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label} không hợp lệ`);
  }
  return date;
}

async function allowedJobs(req: Request): Promise<AllowedJobs> {
  const ids = await scopeIdsFor(req);
  const scope = listScope(req, ids, 'owner_web_user_id');
  const [rows] = await adminPool.query<any[]>(
    `SELECT id, name FROM relay_jobs WHERE ${scope.sql}`,
    scope.params
  );
  const names = new Map<number, string>();
  for (const row of rows) names.set(Number(row.id), String(row.name));
  const allIds = [...names.keys()];

  const requested = Number(req.query.jobId ?? 0);
  if (requested > 0) {
    if (!names.has(requested)) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job trong phạm vi');
    }
    return { ids: [requested], names, selected: requested };
  }
  return { ids: allIds, names, selected: null };
}

function placeholders(ids: number[]): string {
  return ids.map(() => '?').join(',');
}

historyRouter.get(
  '/sessions',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const allowed = await allowedJobs(req);
    if (allowed.ids.length === 0) {
      res.json({ items: [], total: 0, pageSize, offset });
      return;
    }
    const from = parseDate(req.query.from, 'Từ ngày');
    const to = parseDate(req.query.to, 'Đến ngày');
    const params: unknown[] = [...allowed.ids];
    let where = `relay_job_id IN (${placeholders(allowed.ids)})`;
    if (from) {
      where += ' AND start_ts >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND start_ts <= ?';
      params.push(to);
    }
    const rows = await runtimeQuery<RowDataPacket[]>(
      `SELECT id, relay_job_id, start_ts, end_ts, duration_sec, result, close_reason, message
         FROM relay_sessions
        WHERE ${where}
        ORDER BY start_ts DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const countRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM relay_sessions WHERE ${where}`,
      params
    );
    res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        jobId: Number(row.relay_job_id),
        jobName: allowed.names.get(Number(row.relay_job_id)) ?? '',
        startTs: row.start_ts,
        endTs: row.end_ts,
        durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
        result: String(row.result ?? ''),
        closeReason: String(row.close_reason ?? ''),
        message: String(row.message ?? '')
      })),
      total: Number(countRows[0]?.total ?? 0),
      pageSize,
      offset
    });
  })
);

historyRouter.get(
  '/events',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const allowed = await allowedJobs(req);
    if (allowed.ids.length === 0) {
      res.json({ items: [], total: 0, pageSize, offset });
      return;
    }
    const from = parseDate(req.query.from, 'Từ ngày');
    const to = parseDate(req.query.to, 'Đến ngày');
    const type = String(req.query.type || '').trim();
    const params: unknown[] = [...allowed.ids];
    let where = `relay_job_id IN (${placeholders(allowed.ids)})`;
    if (from) {
      where += ' AND ts >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND ts <= ?';
      params.push(to);
    }
    if (type) {
      where += ' AND type = ?';
      params.push(type);
    }
    const rows = await runtimeQuery<RowDataPacket[]>(
      `SELECT id, relay_job_id, ts, type, message, duration_sec
         FROM relay_events
        WHERE ${where}
        ORDER BY ts DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const countRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM relay_events WHERE ${where}`,
      params
    );
    res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        jobId: Number(row.relay_job_id),
        jobName: allowed.names.get(Number(row.relay_job_id)) ?? '',
        ts: row.ts,
        type: String(row.type ?? ''),
        message: String(row.message ?? ''),
        durationSec: row.duration_sec === null ? null : Number(row.duration_sec)
      })),
      total: Number(countRows[0]?.total ?? 0),
      pageSize,
      offset
    });
  })
);

historyRouter.get(
  '/hourly',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const allowed = await allowedJobs(req);
    if (allowed.ids.length === 0) {
      res.json({ items: [], total: 0, pageSize, offset });
      return;
    }
    const from = parseDate(req.query.from, 'Từ ngày');
    const to = parseDate(req.query.to, 'Đến ngày');
    const params: unknown[] = [...allowed.ids];
    let where = `relay_job_id IN (${placeholders(allowed.ids)})`;
    if (from) {
      where += ' AND hour_start_utc >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND hour_start_utc <= ?';
      params.push(to);
    }
    const rows = await runtimeQuery<RowDataPacket[]>(
      `SELECT relay_job_id, hour_start_utc, online_sec, sessions, errors, timeouts,
              auth_errors, proxy_errors, nmea_errors, retries
         FROM relay_hourly
        WHERE ${where}
        ORDER BY hour_start_utc DESC, relay_job_id ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const countRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM relay_hourly WHERE ${where}`,
      params
    );
    res.json({
      items: rows.map((row) => ({
        jobId: Number(row.relay_job_id),
        jobName: allowed.names.get(Number(row.relay_job_id)) ?? '',
        hourStartUtc: row.hour_start_utc,
        onlineSec: Number(row.online_sec ?? 0),
        sessions: Number(row.sessions ?? 0),
        errors: Number(row.errors ?? 0),
        timeouts: Number(row.timeouts ?? 0),
        authErrors: Number(row.auth_errors ?? 0),
        proxyErrors: Number(row.proxy_errors ?? 0),
        nmeaErrors: Number(row.nmea_errors ?? 0),
        retries: Number(row.retries ?? 0)
      })),
      total: Number(countRows[0]?.total ?? 0),
      pageSize,
      offset
    });
  })
);
