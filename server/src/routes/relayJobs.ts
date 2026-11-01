import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { writeAudit } from '../lib/audit';
import { bulkBodySchema, emptyBulkResult, uniqueIds } from '../lib/bulk';
import { encryptSecret } from '../lib/crypto';
import { endpointKey } from '../lib/endpointKey';
import { asyncHandler, ApiError } from '../lib/http';
import { callGoInternal } from '../lib/internalApi';
import { dataUptime } from '../lib/dataUptime';
import {
  buildStatusTimeline,
  combinedRelayStatus,
  statusForLiveAge,
  TIMELINE_RANGES,
  timelineRange
} from '../lib/statusTimeline';
import { findCycle, RelayEdge } from '../lib/loopGuard';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import {
  assertRecordScope,
  ipFrom,
  listScope,
  pageFrom,
  requireBulkPermission,
  resolveWriteOwnership,
  scopeIdsFor
} from '../rbac/access';
import { TOMBSTONE_KEY_SQL } from '../lib/tombstone';

export const relayJobsRouter = Router();
relayJobsRouter.use(requireAuth);
relayJobsRouter.use(csrfProtection);

const credentialPatch = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512).optional()
});

const endpointSchema = z.object({
  host: z.string().min(1).max(190),
  port: z.number().int().min(1).max(65535).optional().default(1509),
  mount: z.string().min(1).max(128),
  proxy: z.string().max(255).optional().default(''),
  ssl: z.boolean().optional().default(false),
  ntripVersion: z.enum(['v1', 'v2']).optional().default('v2')
});

const createSchema = z.object({
  externalKey: z.string().max(128).nullable().optional(),
  name: z.string().min(1).max(160),
  enabled: z.boolean().optional().default(false),
  upstream: endpointSchema,
  downstream: endpointSchema,
  upstreamCredential: credentialPatch.nullable().optional(),
  downstreamCredential: credentialPatch.nullable().optional(),
  downstreamMode: z.enum(['auto', 'post', 'source']).optional().default('auto'),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  uaPrefix: z.string().max(100).optional().default(''),
  nmeaIntervalSec: z.number().int().min(0).max(3600).optional().default(0),
  origin: z.enum(['manual', 'import', 'discover']).optional().default('manual'),
  originRef: z.string().max(190).optional().default(''),
  tags: z.unknown().nullable().optional(),
  ownerWebUserId: z.number().int().positive().nullable().optional(),
  companyId: z.number().int().positive().nullable().optional()
});

const endpointPatch = z.object({
  host: z.string().min(1).max(190).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  mount: z.string().min(1).max(128).optional(),
  proxy: z.string().max(255).optional(),
  ssl: z.boolean().optional(),
  ntripVersion: z.enum(['v1', 'v2']).optional()
});

const updateSchema = z.object({
  externalKey: z.string().max(128).nullable().optional(),
  name: z.string().min(1).max(160).optional(),
  enabled: z.boolean().optional(),
  upstream: endpointPatch.optional(),
  downstream: endpointPatch.optional(),
  upstreamCredential: credentialPatch.nullable().optional(),
  downstreamCredential: credentialPatch.nullable().optional(),
  downstreamMode: z.enum(['auto', 'post', 'source']).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  uaPrefix: z.string().max(100).optional(),
  nmeaIntervalSec: z.number().int().min(0).max(3600).optional(),
  origin: z.enum(['manual', 'import', 'discover']).optional(),
  originRef: z.string().max(190).optional(),
  tags: z.unknown().nullable().optional(),
  ownerWebUserId: z.number().int().positive().nullable().optional(),
  companyId: z.number().int().positive().nullable().optional()
});

const JOB_SELECT = `
  SELECT j.*,
         uc.username AS upstream_credential_username,
         dc.username AS downstream_credential_username,
         u.display_name AS owner_name,
         c.name AS company_name
    FROM relay_jobs j
    LEFT JOIN relay_credentials uc ON uc.id = j.upstream_credential_id
    LEFT JOIN relay_credentials dc ON dc.id = j.downstream_credential_id
    LEFT JOIN web_users u ON u.id = j.owner_web_user_id
    LEFT JOIN companies c ON c.id = j.company_id`;

interface CredentialInput {
  username: string;
  password?: string;
}

function publicJob(row: any, state: any) {
  return {
    id: Number(row.id),
    externalKey: row.external_key,
    name: row.name,
    enabled: Boolean(row.enabled),
    locked: Boolean(row.locked),
    desiredRevision: Number(row.desired_revision),
    upstream: {
      host: row.upstream_host,
      port: Number(row.upstream_port),
      mount: row.upstream_mount,
      proxy: row.upstream_proxy,
      ssl: Boolean(row.upstream_ssl),
      ntripVersion: row.upstream_ntrip_version,
      key: row.upstream_key,
      credential: row.upstream_credential_id
        ? {
            id: Number(row.upstream_credential_id),
            username: row.upstream_credential_username ?? '',
            hasSecret: true
          }
        : null
    },
    downstream: {
      host: row.downstream_host,
      port: Number(row.downstream_port),
      mount: row.downstream_mount,
      proxy: row.downstream_proxy,
      ssl: Boolean(row.downstream_ssl),
      ntripVersion: row.downstream_ntrip_version,
      key: row.downstream_key,
      credential: row.downstream_credential_id
        ? {
            id: Number(row.downstream_credential_id),
            username: row.downstream_credential_username ?? '',
            hasSecret: true
          }
        : null
    },
    downstreamMode: row.downstream_mode,
    lat: row.lat === null ? null : Number(row.lat),
    lon: row.lon === null ? null : Number(row.lon),
    uaPrefix: row.ua_prefix,
    nmeaIntervalSec: Number(row.nmea_interval_sec),
    origin: row.origin,
    originRef: row.origin_ref,
    tags: row.tags ?? null,
    ownerWebUserId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
    ownerName: row.owner_name ?? null,
    companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
    companyName: row.company_name ?? null,
    importedAt: row.imported_at,
    sourceSha256: row.source_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    state: state
      ? {
          runtimeState: state.runtime_state,
          appliedRevision: Number(state.applied_revision),
          lastError: state.last_error,
          lastAppliedAt: state.last_applied_at,
          updatedAt: state.updated_at
        }
      : null
  };
}

async function getJobRow(id: number, conn?: any): Promise<any | null> {
  const runner = conn ?? adminPool;
  const [rows] = await runner.query(`${JOB_SELECT} WHERE j.id = ?`, [id]);
  return rows[0] ?? null;
}

async function getState(id: number): Promise<any | null> {
  const rows = await runtimeQuery('SELECT * FROM relay_job_state WHERE relay_job_id = ?', [id]);
  return rows[0] ?? null;
}

async function statesFor(ids: number[]): Promise<Map<number, any>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await runtimeQuery(
    `SELECT * FROM relay_job_state WHERE relay_job_id IN (${placeholders})`,
    ids
  );
  return new Map(rows.map((row: any) => [Number(row.relay_job_id), row]));
}

interface GoRelayMetrics {
  jobId: number;
  state: string;
  appliedRevision: number;
  bytesUp: number;
  bytesDown: number;
  frames: number;
  crcErrors: number;
  lastDataAt?: string;
  lastUpAt?: string;
  lastDownAt?: string;
  lastError?: string;
}

async function metricsFor(ids: number[]): Promise<Map<number, GoRelayMetrics>> {
  if (ids.length === 0) return new Map();
  try {
    const response = await callGoInternal<{ items: GoRelayMetrics[] }>(
      '/internal/snapshot',
      undefined,
      { method: 'GET', timeoutMs: 1500 }
    );
    const wanted = new Set(ids.map(Number));
    return new Map(
      (response?.items ?? [])
        .filter((item) => wanted.has(Number(item.jobId)))
        .map((item) => [Number(item.jobId), item])
    );
  } catch {
    return new Map();
  }
}

function dataAgeMs(value: string | undefined | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Date.now() - ts);
}

function relayDirectionStatus(
  row: any,
  metrics: GoRelayMetrics | undefined,
  direction: 'upstream' | 'downstream'
): 'online' | 'offline' | 'no_data' {
  if (row.locked || !row.enabled) return 'offline';
  const value =
    direction === 'upstream'
      ? metrics?.lastUpAt ?? metrics?.lastDataAt
      : metrics?.lastDownAt;
  return statusForLiveAge(dataAgeMs(value));
}

function relayStreamStatus(
  row: any,
  state: any,
  metrics: GoRelayMetrics | undefined
): 'online' | 'offline' | 'no_data' | null {
  if (row.locked) return null;
  if (!row.enabled) return 'offline';
  const runtime = String(metrics?.state ?? state?.runtime_state ?? '');
  if (runtime !== 'streaming') return 'offline';
  return combinedRelayStatus(
    relayDirectionStatus(row, metrics, 'upstream'),
    relayDirectionStatus(row, metrics, 'downstream')
  );
}

function attachRuntime(row: any, state: any, metrics: GoRelayMetrics | undefined) {
  return {
    ...publicJob(row, state),
    streamStatus: relayStreamStatus(row, state, metrics),
    directionStatus: {
      upstream: relayDirectionStatus(row, metrics, 'upstream'),
      downstream: relayDirectionStatus(row, metrics, 'downstream')
    },
    metrics: metrics
      ? {
          state: metrics.state,
          bytesUp: Number(metrics.bytesUp ?? 0),
          bytesDown: Number(metrics.bytesDown ?? 0),
          frames: Number(metrics.frames ?? 0),
          crcErrors: Number(metrics.crcErrors ?? 0),
          lastDataAt: metrics.lastDataAt ?? null,
          lastUpAt: metrics.lastUpAt ?? null,
          lastDownAt: metrics.lastDownAt ?? null,
          lastError: metrics.lastError ?? null
        }
      : null
  };
}

async function upsertCredential(
  conn: any,
  input: CredentialInput | null | undefined,
  existingId: number | null,
  name: string,
  ownerId: number,
  actorId: number,
  companyId: number | null = null
): Promise<number | null> {
  if (input === undefined) return existingId;
  if (input === null) return null;

  if (existingId) {
    const [rows] = await conn.query('SELECT id FROM relay_credentials WHERE id = ?', [existingId]);
    if (rows.length > 0) {
      if (input.password) {
        await conn.query(
          'UPDATE relay_credentials SET name = ?, username = ?, password_enc = ? WHERE id = ?',
          [name, input.username, encryptSecret(input.password), existingId]
        );
      } else {
        await conn.query('UPDATE relay_credentials SET name = ?, username = ? WHERE id = ?', [
          name,
          input.username,
          existingId
        ]);
      }
      return existingId;
    }
  }

  if (!input.password) {
    throw new ApiError(400, 'CREDENTIAL_PASSWORD_REQUIRED', 'Cần mật khẩu cho credential mới');
  }
  const [result]: any = await conn.query(
    `INSERT INTO relay_credentials (name, username, password_enc, owner_web_user_id, company_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, input.username, encryptSecret(input.password), ownerId, companyId, actorId]
  );
  return Number(result.insertId);
}

async function assertNoCycles(proposed: {
  id: number | null;
  upstreamKey: string;
  downstreamKey: string;
  enabled: boolean;
}): Promise<void> {
  if (proposed.upstreamKey === proposed.downstreamKey) {
    throw new ApiError(409, 'SELF_LOOP', 'Upstream và downstream trùng endpoint');
  }
  if (!proposed.enabled) return;

  const rows = await query<RowDataPacket[]>(
    `SELECT id, upstream_key, downstream_key FROM relay_jobs
      WHERE deleted_at IS NULL AND enabled = 1${proposed.id ? ' AND id <> ?' : ''}`,
    proposed.id ? [proposed.id] : []
  );

  const edges: RelayEdge[] = rows.map((row) => ({
    upstreamKey: String(row.upstream_key),
    downstreamKey: String(row.downstream_key)
  }));
  edges.push({
    upstreamKey: proposed.upstreamKey,
    downstreamKey: proposed.downstreamKey
  });
  if (findCycle(edges)) {
    throw new ApiError(409, 'LOOP_DETECTED', 'Cấu hình tạo vòng lặp relay nội bộ');
  }
}

async function requestReconcile(jobId: number): Promise<void> {
  try {
    await callGoInternal('/internal/reconcile', { jobIds: [jobId] });
  } catch (err) {
    console.warn(
      '[relay] reconcile request failed',
      err instanceof Error ? err.message : 'unknown'
    );
  }
}

function duplicateGuard(err: unknown): never {
  if (err && typeof err === 'object' && (err as any).code === 'ER_DUP_ENTRY') {
    throw new ApiError(409, 'DUPLICATE_ENDPOINT', 'Cặp endpoint hoặc externalKey đã tồn tại');
  }
  throw err;
}

relayJobsRouter.get(
  '/',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'j.owner_web_user_id', { companyColumn: 'j.company_id' });
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const params: unknown[] = [...scope.params];
    let where = `${scope.sql} AND j.deleted_at IS NULL`;
    if (q) {
      where += ' AND (j.name LIKE ? OR j.external_key LIKE ? OR j.upstream_host LIKE ? OR j.downstream_host LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const enabled = String(req.query.enabled || '').trim();
    if (enabled === '0' || enabled === '1') {
      where += ' AND j.enabled = ?';
      params.push(Number(enabled));
    }
    const companyId = Number(req.query.companyId || 0);
    if (req.auth?.roleCode === 'super_admin' && Number.isInteger(companyId) && companyId > 0) {
      where += ' AND j.company_id = ?';
      params.push(companyId);
    }
    const [rows] = await adminPool.query<any[]>(
      `${JOB_SELECT} WHERE ${where} ORDER BY j.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<any[]>(
      `SELECT COUNT(*) AS total FROM relay_jobs j WHERE ${where}`,
      params
    );
    const idsForRuntime = rows.map((row) => Number(row.id));
    const [stateMap, metricMap] = await Promise.all([
      statesFor(idsForRuntime),
      metricsFor(idsForRuntime)
    ]);
    res.json({
      items: rows.map((row) =>
        attachRuntime(
          row,
          stateMap.get(Number(row.id)),
          metricMap.get(Number(row.id))
        )
      ),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

relayJobsRouter.get(
  '/:id',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const row = await getJobRow(Number(req.params.id));
    if (!row || row.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    const state = await getState(Number(row.id));
    const metrics = await metricsFor([Number(row.id)]);
    res.json({ item: attachRuntime(row, state, metrics.get(Number(row.id))) });
  })
);

relayJobsRouter.get(
  '/:id/status',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await getJobRow(id);
    if (!row || row.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    const state = await getState(id);
    const metrics = (await metricsFor([id])).get(id);
    const [sessions, hourly] = await Promise.all([
      runtimeQuery<RowDataPacket[]>(
        `SELECT id, start_ts, end_ts, duration_sec, result, close_reason, message
           FROM relay_sessions
          WHERE relay_job_id = ?
          ORDER BY id DESC
          LIMIT 20`,
        [id]
      ),
      runtimeQuery<RowDataPacket[]>(
        `SELECT hour_start_utc, online_sec, sessions, errors, timeouts,
                auth_errors, proxy_errors, nmea_errors, retries
           FROM relay_hourly
          WHERE relay_job_id = ?
            AND hour_start_utc >= UTC_TIMESTAMP(3) - INTERVAL 24 HOUR
          ORDER BY hour_start_utc`,
        [id]
      )
    ]);
    const onlineSec = hourly.reduce((sum, item) => sum + Number(item.online_sec ?? 0), 0);
    const totalSec = 24 * 3600;
    const sampleUptime = await dataUptime({
      targetType: 'relay_job',
      targetId: id,
      hours: 24
    });
    const errorSessions = sessions.filter((item) =>
      ['auth_failed', 'timeout', 'network', 'proxy'].includes(String(item.close_reason))
    );
    const errorSummary = {
      authFailed: sessions.filter((item) => item.close_reason === 'auth_failed').length,
      timeout: sessions.filter((item) => item.close_reason === 'timeout').length,
      network: sessions.filter((item) => item.close_reason === 'network').length,
      proxy: sessions.filter((item) =>
        String(item.message ?? '').toLowerCase().includes('proxy')
      ).length
    };
    res.json({
      item: attachRuntime(row, state, metrics),
      uptime: {
        windowSec: totalSec,
        onlineSec,
        uptimePct: Math.min(100, (onlineSec / totalSec) * 100),
        buckets: hourly.map((item) => ({
          hourStartUtc: item.hour_start_utc,
          onlineSec: Number(item.online_sec ?? 0),
          sessions: Number(item.sessions ?? 0),
          errors: Number(item.errors ?? 0),
          timeouts: Number(item.timeouts ?? 0),
          authErrors: Number(item.auth_errors ?? 0),
          proxyErrors: Number(item.proxy_errors ?? 0),
          retries: Number(item.retries ?? 0)
        }))
      },
      sessions: sessions.map((item) => ({
        id: Number(item.id),
        startTs: item.start_ts,
        endTs: item.end_ts,
        durationSec: item.duration_sec === null ? null : Number(item.duration_sec),
        result: String(item.result ?? ''),
        closeReason: String(item.close_reason ?? ''),
        message: String(item.message ?? '')
      })),
      errorSummary,
      dataUptime: sampleUptime,
      recentErrors: errorSessions.map((item) => ({
        id: Number(item.id),
        at: item.start_ts,
        closeReason: String(item.close_reason ?? ''),
        message: String(item.message ?? '')
      }))
    });
  })
);

const ACTIVITY_RANGES = {
  '24h': { hours: 24, slotSec: 60, seriesBucketSec: 300 },
  '7d': { hours: 24 * 7, slotSec: 300, seriesBucketSec: 1800 },
  '30d': { hours: 24 * 30, slotSec: 1800, seriesBucketSec: 7200 }
} as const;

type ActivityRange = keyof typeof ACTIVITY_RANGES;

function activityRange(value: string): ActivityRange {
  return value === '7d' || value === '30d' ? value : '24h';
}

function isOutageReason(value: string): boolean {
  const reason = value.trim().toLowerCase();
  if (!reason) return false;
  return ![
    'manual',
    'normal',
    'source_disconnected',
    'service_restart',
    'rover_disconnected'
  ].includes(reason);
}

function historyLevelForReason(value: string): 'critical' | 'warning' | 'info' {
  const reason = value.trim().toLowerCase();
  if (['auth_failed', 'timeout', 'network', 'proxy'].includes(reason)) return 'critical';
  return isOutageReason(reason) ? 'warning' : 'info';
}

async function buildRelayActivity(
  jobId: number,
  requestedRange: string,
  requestedDirection: string
) {
  const range = activityRange(requestedRange);
  const direction = requestedDirection === 'downstream' ? 'downstream' : 'upstream';
  const { hours } = ACTIVITY_RANGES[range];
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);

  const [sessionRows, minuteRows] = await Promise.all([
    runtimeQuery<RowDataPacket[]>(
      `SELECT id, start_ts, end_ts, close_reason, result
         FROM relay_sessions
        WHERE relay_job_id = ?
          AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
        ORDER BY start_ts`,
      [jobId, start, end]
    ),
    runtimeQuery<RowDataPacket[]>(
      `SELECT UNIX_TIMESTAMP(ts) DIV 60 AS minute
         FROM quality_samples
        WHERE target_type = 'relay_job' AND target_id = ? AND direction = ?
          AND ts >= ? AND ts <= ? AND state = 'streaming'
        GROUP BY minute`,
      [jobId, direction, start, end]
    )
  ]);

  const sessions = sessionRows.map((row) => ({
    id: Number(row.id),
    startedAt: new Date(row.start_ts),
    endedAt: row.end_ts ? new Date(row.end_ts) : null,
    reason: String(row.close_reason ?? row.result ?? '')
  }));

  const observed = [
    ...(direction === 'upstream'
      ? sessions.map((session) => Math.max(session.startedAt.getTime(), start.getTime()))
      : []),
    ...minuteRows.map((row) => Number(row.minute) * 60_000)
  ].filter((value) => Number.isFinite(value));
  const firstObserved = observed.length > 0 ? Math.min(...observed) : start.getTime();
  const analysisStart = new Date(Math.max(start.getTime(), Math.min(firstObserved, end.getTime())));
  const totalSec = Math.round((end.getTime() - analysisStart.getTime()) / 1000);
  const startMs = Math.floor(analysisStart.getTime() / 60_000) * 60_000;
  const endMs = Math.ceil(end.getTime() / 60_000) * 60_000;
  const totalMinutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
  const onlineMinutes = new Uint8Array(totalMinutes);
  const markOnline = (from: number, to: number) => {
    const first = Math.max(0, Math.floor((from - startMs) / 60_000));
    const last = Math.min(totalMinutes, Math.ceil((to - startMs) / 60_000));
    for (let index = first; index < last; index += 1) onlineMinutes[index] = 1;
  };
  if (direction === 'upstream') {
    for (const session of sessions) {
      const from = Math.max(session.startedAt.getTime(), analysisStart.getTime());
      const to = Math.min((session.endedAt ?? end).getTime(), end.getTime());
      if (to > from) markOnline(from, to);
    }
  }
  for (const row of minuteRows) {
    const index = Number(row.minute) - Math.floor(startMs / 60_000);
    if (index >= 0 && index < totalMinutes) onlineMinutes[index] = 1;
  }
  const onlineMinuteCount = onlineMinutes.reduce((sum, value) => sum + value, 0);
  const onlineSec = Math.min(totalSec, onlineMinuteCount * 60);

  const slotMs = ACTIVITY_RANGES[range].slotSec * 1000;
  const slotCount = Math.max(1, Math.ceil((end.getTime() - analysisStart.getTime()) / slotMs));
  const segments: Array<{ from: string; to: string; status: 'up' | 'down' }> = [];
  for (let index = 0; index < slotCount; index += 1) {
    const from = analysisStart.getTime() + index * slotMs;
    const to = Math.min(end.getTime(), from + slotMs);
    const first = Math.max(0, Math.floor((from - startMs) / 60_000));
    const last = Math.min(totalMinutes, Math.ceil((to - startMs) / 60_000));
    let online = 0;
    let total = 0;
    for (let minute = first; minute < last; minute += 1) {
      total += 1;
      online += onlineMinutes[minute];
    }
    const status = total > 0 && online / total >= 0.75 ? 'up' : 'down';
    const previous = segments[segments.length - 1];
    if (previous && previous.status === status) {
      previous.to = new Date(to).toISOString();
    } else {
      segments.push({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        status
      });
    }
  }

  const events = segments
    .filter((segment) => segment.status === 'down')
    .map((segment) => {
      const from = new Date(segment.from).getTime();
      const to = new Date(segment.to).getTime();
      const nearby = sessions.find(
        (session) =>
          session.endedAt &&
          isOutageReason(session.reason) &&
          Math.abs(session.endedAt.getTime() - from) < 5 * 60_000
      );
      return {
        id: `${segment.from}-${segment.to}`,
        at: segment.from,
        source: 'relay' as const,
        reason: nearby?.reason || 'Không có dữ liệu',
        durationSec: Math.max(0, Math.round((to - from) / 1000))
      };
    })
    .slice(0, 50);

  const qualityRows = await runtimeQuery<RowDataPacket[]>(
    `SELECT MIN(ts) AS ts,
            AVG(satellites) AS satellites,
            AVG(avg_cnr) AS avg_cnr,
            AVG(msm_epochs) AS msm_epochs,
            AVG(gaps) AS gaps,
            AVG(age_ms) AS age_ms
       FROM quality_samples
      WHERE target_type = 'relay_job' AND target_id = ? AND direction = ?
        AND state = 'streaming' AND ts >= ? AND ts <= ?
      GROUP BY FLOOR(UNIX_TIMESTAMP(ts) / ?)
      ORDER BY ts ASC`,
    [jobId, direction, analysisStart, end, ACTIVITY_RANGES[range].seriesBucketSec]
  );
  const series = qualityRows.map((row) => ({
    at: new Date(row.ts).toISOString(),
    satellites: row.satellites === null ? null : Math.round(Number(row.satellites)),
    avgCnr: row.avg_cnr === null ? null : Math.round(Number(row.avg_cnr) * 10) / 10,
    msmEpochs: row.msm_epochs === null ? null : Math.round(Number(row.msm_epochs)),
    gaps: row.gaps === null ? null : Math.round(Number(row.gaps) * 10) / 10,
    ageMs: row.age_ms === null ? null : Math.round(Number(row.age_ms))
  }));

  return {
    relayJobId: jobId,
    direction,
    range,
    from: analysisStart.toISOString(),
    to: end.toISOString(),
    totalSec,
    onlineSec,
    uptimePct: totalSec > 0 ? Math.min(100, (onlineSec / totalSec) * 100) : 0,
    events,
    segments,
    series
  };
}

relayJobsRouter.get(
  '/:id/activity',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await getJobRow(id);
    if (!row || row.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    res.json(
      await buildRelayActivity(
        id,
        String(req.query.range ?? '24h'),
        String(req.query.direction ?? 'upstream')
      )
    );
  })
);

async function relayConnectionIntervals(
  jobId: number,
  from: Date,
  to: Date
): Promise<Array<{ from: Date; to: Date | null }>> {
  const rows = await runtimeQuery<RowDataPacket[]>(
    `SELECT start_ts, end_ts FROM relay_sessions
      WHERE relay_job_id = ? AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
      ORDER BY start_ts`,
    [jobId, from, to]
  );
  return rows.map((row) => ({
    from: new Date(row.start_ts),
    to: row.end_ts ? new Date(row.end_ts) : null
  }));
}

function relayLiveStatus(
  ageMs: number | null,
  connections: Array<{ from: Date; to: Date | null }>,
  now: Date
): 'online' | 'offline' | 'no_data' {
  const nowMs = now.getTime();
  const connected = connections.some(
    (item) => item.from.getTime() <= nowMs && (item.to === null || nowMs < item.to.getTime())
  );
  if (connected) return statusForLiveAge(ageMs, { connected: true });
  if (connections.length === 0) return statusForLiveAge(ageMs, { everConnected: false });
  const lastEnd = Math.max(
    ...connections
      .filter((item) => item.to !== null)
      .map((item) => (item.to as Date).getTime())
  );
  if (!Number.isFinite(lastEnd)) return statusForLiveAge(ageMs, { everConnected: false });
  return statusForLiveAge(ageMs, {
    connected: false,
    disconnectAgeMs: Math.max(0, nowMs - lastEnd)
  });
}

relayJobsRouter.get(
  '/:id/timeline',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await getJobRow(id);
    if (!row || row.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    const direction = String(req.query.direction) === 'downstream' ? 'downstream' : 'upstream';
    const range = timelineRange(req.query.range);
    const { hours, bucketSec, resolutionSec, seriesBucketSec } = TIMELINE_RANGES[range];
    const now = new Date();
    const from = new Date(now.getTime() - hours * 3600_000);
    const rows = await runtimeQuery<RowDataPacket[]>(
      `SELECT ts, state, age_ms, satellites, avg_cnr, msm_epochs, gaps
         FROM quality_samples
        WHERE target_type = 'relay_job' AND target_id = ? AND direction = ?
          AND ts >= ? AND ts <= ?
        ORDER BY ts ASC`,
      [id, direction, from, now]
    );
    const samples = rows.map((sample) => ({
      ts: new Date(sample.ts),
      state: String(sample.state ?? ''),
      ageMs: Number(sample.age_ms ?? 0)
    }));
    const rawConnections = await relayConnectionIntervals(id, from, now);
    const hasConnectionInfo = rawConnections.length > 0 || samples.length === 0;
    const connections = hasConnectionInfo ? rawConnections : [];
    const metrics = (await metricsFor([id])).get(id);
    let liveAge: number | null =
      direction === 'upstream'
        ? dataAgeMs(metrics?.lastUpAt ?? metrics?.lastDataAt)
        : dataAgeMs(metrics?.lastDownAt);
    if (liveAge === null && samples.length > 0) {
      const last = samples[samples.length - 1];
      liveAge = now.getTime() - (last.ts.getTime() - last.ageMs);
    }
    const currentStatus: 'online' | 'offline' | 'no_data' =
      row.locked || !row.enabled
        ? 'offline'
        : hasConnectionInfo
          ? relayLiveStatus(liveAge, connections, now)
          : statusForLiveAge(liveAge);
    const timeline = buildStatusTimeline({
      createdAt: row.created_at ? new Date(row.created_at) : null,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      rangeFrom: from,
      now,
      bucketSec,
      resolutionSec,
      samples,
      connections,
      hasConnectionInfo,
      currentStatus
    });
    const seriesBucketMs = seriesBucketSec * 1000;
    const series = [];
    for (
      let seriesStart = from.getTime();
      seriesStart < now.getTime();
      seriesStart += seriesBucketMs
    ) {
      const seriesEnd = Math.min(seriesStart + seriesBucketMs, now.getTime());
      const bucketRows = rows.filter((sample) => {
        const ts = new Date(sample.ts).getTime();
        return (
          ts >= seriesStart &&
          ts < seriesEnd &&
          String(sample.state ?? '') === 'streaming'
        );
      });
      const average = (key: string) => {
        const values = bucketRows
          .map((sample) => Number(sample[key]))
          .filter((value) => Number.isFinite(value));
        if (values.length === 0) return null;
        return (
          Math.round(
            (values.reduce((sum, value) => sum + value, 0) / values.length) * 10
          ) / 10
        );
      };
      const averageInt = (key: string) => {
        const value = average(key);
        return value === null ? null : Math.round(value);
      };
      series.push({
        at: new Date(seriesStart).toISOString(),
        satellites: averageInt('satellites'),
        avgCnr: average('avg_cnr'),
        msmEpochs: averageInt('msm_epochs'),
        gaps: averageInt('gaps'),
        ageMs: averageInt('age_ms')
      });
    }
    res.json({ ...timeline, series, direction, bucketSec, seriesBucketSec, range });
  })
);

relayJobsRouter.get(
  '/:id/history',
  requirePermission('relay', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await getJobRow(id);
    if (!row || row.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    const { pageSize, offset } = pageFrom(req);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from
      ? new Date(String(req.query.from))
      : new Date(to.getTime() - 24 * 3600_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'from/to không hợp lệ');
    }
    if (from.getTime() > to.getTime()) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Từ ngày phải trước đến ngày');
    }

    const events: Array<{
      id: string;
      source: 'quality' | 'relay' | 'audit';
      type: string;
      at: string;
      title: string;
      detail: string;
      level: string;
    }> = [];

    const [sessionRows, eventRows, qualityRows, auditRows] = await Promise.all([
      runtimeQuery<RowDataPacket[]>(
        `SELECT id, start_ts, end_ts, duration_sec, result, close_reason, message
           FROM relay_sessions
          WHERE relay_job_id = ?
            AND start_ts <= ? AND (end_ts IS NULL OR end_ts >= ?)
          ORDER BY start_ts DESC
          LIMIT 1000`,
        [id, to, from]
      ),
      runtimeQuery<RowDataPacket[]>(
        `SELECT id, ts, type, message, duration_sec
           FROM relay_events
          WHERE relay_job_id = ? AND ts >= ? AND ts <= ?
          ORDER BY ts DESC
          LIMIT 1000`,
        [id, from, to]
      ),
      runtimeQuery<RowDataPacket[]>(
        `SELECT ts, score, state
           FROM quality_samples
          WHERE target_type = 'relay_job' AND target_id = ?
            AND ts >= ? AND ts <= ?
          ORDER BY ts ASC
          LIMIT 5000`,
        [id, from, to]
      ),
      query<RowDataPacket[]>(
        `SELECT a.id, a.action, a.created_at, u.username AS actor_name
           FROM audit_logs a
           LEFT JOIN web_users u ON u.id = a.actor_web_user_id
          WHERE a.entity_type = 'relay_job' AND a.entity_id = ?
            AND a.created_at >= ? AND a.created_at <= ?
          ORDER BY a.created_at DESC
          LIMIT 500`,
        [String(id), from, to]
      )
    ]);

    for (const session of sessionRows) {
      const startAt = session.start_ts ? new Date(session.start_ts).toISOString() : null;
      if (startAt && new Date(startAt) >= from && new Date(startAt) <= to) {
        events.push({
          id: `relay:${Number(session.id)}:start`,
          source: 'relay',
          type: 'relay_start',
          at: startAt,
          title: 'Relay bắt đầu kết nối',
          detail: `${String(session.result || 'streaming')}${
            session.message ? ` · ${String(session.message)}` : ''
          }`,
          level: 'info'
        });
      }
      const endAt = session.end_ts ? new Date(session.end_ts).toISOString() : null;
      if (endAt && new Date(endAt) >= from && new Date(endAt) <= to) {
        const reason = String(session.close_reason || session.result || 'unknown');
        events.push({
          id: `relay:${Number(session.id)}:end`,
          source: 'relay',
          type: 'relay_end',
          at: endAt,
          title: `Relay kết thúc · ${reason}`,
          detail: `${Number(session.duration_sec ?? 0)} giây${
            session.message ? ` · ${String(session.message)}` : ''
          }`,
          level: historyLevelForReason(reason)
        });
      }
    }

    for (const item of eventRows) {
      const at = item.ts ? new Date(item.ts).toISOString() : null;
      if (!at) continue;
      events.push({
        id: `relay-event:${Number(item.id)}`,
        source: 'relay',
        type: String(item.type ?? 'relay_event'),
        at,
        title: `Relay ${String(item.type ?? 'event')}`,
        detail: `${String(item.message ?? '')}${
          item.duration_sec === null ? '' : ` · ${Number(item.duration_sec)} giây`
        }`,
        level: isOutageReason(String(item.message ?? '')) ? 'warning' : 'info'
      });
    }

    let previous: RowDataPacket | null = null;
    qualityRows.forEach((sample, index) => {
      const at = sample.ts ? new Date(sample.ts).toISOString() : null;
      if (!at) return;
      const state = String(sample.state ?? 'unknown');
      const score = Number(sample.score ?? 0);
      if (!previous) {
        events.push({
          id: `quality:${index}:${at}`,
          source: 'quality',
          type: 'quality_start',
          at,
          title: 'Bắt đầu có dữ liệu chất lượng',
          detail: `Score ${score} · ${state}`,
          level: state === 'error' ? 'critical' : state === 'stale' ? 'warning' : 'info'
        });
      } else if (state !== String(previous.state ?? 'unknown')) {
        events.push({
          id: `quality:${index}:${at}`,
          source: 'quality',
          type: 'quality_state',
          at,
          title: `Chất lượng đổi trạng thái: ${String(previous.state)} → ${state}`,
          detail: `Score ${score}`,
          level: state === 'error' ? 'critical' : state === 'stale' ? 'warning' : 'info'
        });
      }
      previous = sample;
    });

    const scoreAlertRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT id, code, level, first_seen, resolved_at
         FROM quality_alerts
        WHERE target_type = 'relay_job' AND target_id = ?
          AND code IN ('quality.score_low', 'quality.score_zero')
          AND (first_seen >= ? OR resolved_at >= ?)
        ORDER BY last_seen DESC
        LIMIT 500`,
      [id, from, to, from]
    );
    for (const alert of scoreAlertRows) {
      const firstAt = alert.first_seen ? new Date(alert.first_seen).toISOString() : null;
      if (firstAt && new Date(firstAt) >= from && new Date(firstAt) <= to) {
        events.push({
          id: `alert:${Number(alert.id)}:open`,
          source: 'quality',
          type: 'quality_score_alert',
          at: firstAt,
          title:
            alert.code === 'quality.score_zero'
              ? 'Điểm chất lượng về 0'
              : 'Điểm chất lượng dưới 30',
          detail: `Mức ${String(alert.level)}`,
          level: alert.code === 'quality.score_zero' ? 'critical' : 'warning'
        });
      }
      const resolvedAt = alert.resolved_at
        ? new Date(alert.resolved_at).toISOString()
        : null;
      if (resolvedAt && new Date(resolvedAt) >= from && new Date(resolvedAt) <= to) {
        events.push({
          id: `alert:${Number(alert.id)}:resolved`,
          source: 'quality',
          type: 'quality_score_recovered',
          at: resolvedAt,
          title: 'Chất lượng phục hồi',
          detail: 'Điểm trở lại từ 30 trở lên',
          level: 'info'
        });
      }
    }

    for (const audit of auditRows) {
      const at = audit.created_at ? new Date(audit.created_at).toISOString() : null;
      if (!at) continue;
      events.push({
        id: `audit:${Number(audit.id)}`,
        source: 'audit',
        type: 'audit',
        at,
        title: `Cấu hình relay · ${String(audit.action)}`,
        detail: `Bởi ${String(audit.actor_name || 'hệ thống')}`,
        level: 'info'
      });
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const levelFilter = String(req.query.level ?? '').trim();
    const levels =
      levelFilter === 'error'
        ? ['critical', 'error']
        : levelFilter === 'warning'
          ? ['warning', 'warn']
          : levelFilter === 'info'
            ? ['info']
            : null;
    const filtered = levels ? events.filter((event) => levels.includes(event.level)) : events;
    res.json({
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      pageSize,
      offset,
      from: from.toISOString(),
      to: to.toISOString(),
      sources: {
        quality: filtered.filter((event) => event.source === 'quality').length,
        caster: 0,
        relay: filtered.filter((event) => event.source === 'relay').length,
        audit: filtered.filter((event) => event.source === 'audit').length
      }
    });
  })
);

relayJobsRouter.post(
  '/',
  requirePermission('relay', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const ownership = await resolveWriteOwnership(req, body.ownerWebUserId, body.companyId);
    const ownerId = ownership.ownerId;
    const companyId = ownership.companyId;
    const upstreamKey = endpointKey(body.upstream);
    const downstreamKey = endpointKey(body.downstream);
    await assertNoCycles({
      id: null,
      upstreamKey,
      downstreamKey,
      enabled: body.enabled
    });

    let jobId: number;
    try {
      jobId = await withTransaction(async (conn) => {
        const upstreamCredentialId = await upsertCredential(
          conn,
          body.upstreamCredential,
          null,
          `${body.name} upstream`,
          ownerId,
          req.auth!.id,
          companyId
        );
        const downstreamCredentialId = await upsertCredential(
          conn,
          body.downstreamCredential,
          null,
          `${body.name} downstream`,
          ownerId,
          req.auth!.id,
          companyId
        );
        const [result]: any = await conn.query(
          `INSERT INTO relay_jobs (
             external_key, name, enabled,
             upstream_host, upstream_port, upstream_mount, upstream_credential_id,
             upstream_proxy, upstream_ssl, upstream_ntrip_version,
             downstream_host, downstream_port, downstream_mount, downstream_credential_id,
             downstream_proxy, downstream_ssl, downstream_ntrip_version, downstream_mode,
             lat, lon, ua_prefix, nmea_interval_sec, origin, origin_ref, tags,
             desired_revision, upstream_key, downstream_key, owner_web_user_id, company_id, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [
            body.externalKey ?? null,
            body.name,
            body.enabled,
            body.upstream.host,
            body.upstream.port,
            body.upstream.mount,
            upstreamCredentialId,
            body.upstream.proxy,
            body.upstream.ssl,
            body.upstream.ntripVersion,
            body.downstream.host,
            body.downstream.port,
            body.downstream.mount,
            downstreamCredentialId,
            body.downstream.proxy,
            body.downstream.ssl,
            body.downstream.ntripVersion,
            body.downstreamMode,
            body.lat ?? null,
            body.lon ?? null,
            body.uaPrefix,
            body.nmeaIntervalSec,
            body.origin,
            body.originRef,
            body.tags === undefined || body.tags === null ? null : JSON.stringify(body.tags),
            upstreamKey,
            downstreamKey,
            ownerId,
            companyId,
            req.auth!.id
          ]
        );
        return Number(result.insertId);
      });
    } catch (err) {
      duplicateGuard(err);
    }

    const row = await getJobRow(jobId);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'create',
      'relay_job',
      jobId,
      null,
      publicJob(row, null),
      ipFrom(req)
    );
    await requestReconcile(jobId);
    res.status(201).json({ item: publicJob(row, await getState(jobId)) });
  })
);

relayJobsRouter.patch(
  '/:id',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getJobRow(id);
    if (!before || before.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    const body = updateSchema.parse(req.body);

    const upstream = {
      host: body.upstream?.host ?? before.upstream_host,
      port: body.upstream?.port ?? Number(before.upstream_port),
      mount: body.upstream?.mount ?? before.upstream_mount,
      proxy: body.upstream?.proxy ?? before.upstream_proxy,
      ssl: body.upstream?.ssl ?? Boolean(before.upstream_ssl),
      ntripVersion: body.upstream?.ntripVersion ?? before.upstream_ntrip_version
    };
    const downstream = {
      host: body.downstream?.host ?? before.downstream_host,
      port: body.downstream?.port ?? Number(before.downstream_port),
      mount: body.downstream?.mount ?? before.downstream_mount,
      proxy: body.downstream?.proxy ?? before.downstream_proxy,
      ssl: body.downstream?.ssl ?? Boolean(before.downstream_ssl),
      ntripVersion: body.downstream?.ntripVersion ?? before.downstream_ntrip_version
    };
    const upstreamKey = endpointKey(upstream);
    const downstreamKey = endpointKey(downstream);
    const enabled = body.enabled ?? Boolean(before.enabled);
    const paused =
      before.paused_by_station_id !== null || before.paused_by_mountpoint_id !== null;
    if (body.enabled === true && paused) {
      throw new ApiError(
        409,
        'RESOURCE_PAUSED',
        'Relay job đang bị tạm dừng bởi trạm hoặc mountpoint'
      );
    }
    const clearPause = body.enabled === false;
    await assertNoCycles({ id, upstreamKey, downstreamKey, enabled });

    const ownerId =
      body.ownerWebUserId === undefined
        ? Number(before.owner_web_user_id)
        : (await resolveWriteOwnership(
            req,
            body.ownerWebUserId,
            before.company_id === null ? null : Number(before.company_id)
          )).ownerId;
    const companyId = before.company_id === null ? null : Number(before.company_id);
    if (
      body.companyId !== undefined &&
      Number(body.companyId) !== companyId
    ) {
      throw new ApiError(400, 'COMPANY_IMMUTABLE', 'Không được đổi công ty của relay job');
    }

    try {
      await withTransaction(async (conn) => {
        const upstreamCredentialId = await upsertCredential(
          conn,
          body.upstreamCredential,
          before.upstream_credential_id === null
            ? null
            : Number(before.upstream_credential_id),
          `${body.name ?? before.name} upstream`,
          ownerId,
          req.auth!.id,
          companyId
        );
        const downstreamCredentialId = await upsertCredential(
          conn,
          body.downstreamCredential,
          before.downstream_credential_id === null
            ? null
            : Number(before.downstream_credential_id),
          `${body.name ?? before.name} downstream`,
          ownerId,
          req.auth!.id,
          companyId
        );
        await conn.query(
          `UPDATE relay_jobs SET
             external_key = ?, name = ?, enabled = ?,
             paused_by_station_id = ?, paused_by_mountpoint_id = ?,
             upstream_host = ?, upstream_port = ?, upstream_mount = ?, upstream_credential_id = ?,
             upstream_proxy = ?, upstream_ssl = ?, upstream_ntrip_version = ?,
             downstream_host = ?, downstream_port = ?, downstream_mount = ?, downstream_credential_id = ?,
             downstream_proxy = ?, downstream_ssl = ?, downstream_ntrip_version = ?, downstream_mode = ?,
             lat = ?, lon = ?, ua_prefix = ?, nmea_interval_sec = ?, origin = ?, origin_ref = ?, tags = ?,
             upstream_key = ?, downstream_key = ?, owner_web_user_id = ?,
             desired_revision = desired_revision + 1
           WHERE id = ?`,
          [
            body.externalKey === undefined ? before.external_key : body.externalKey,
            body.name ?? before.name,
            enabled,
            clearPause ? null : before.paused_by_station_id,
            clearPause ? null : before.paused_by_mountpoint_id,
            upstream.host,
            upstream.port,
            upstream.mount,
            upstreamCredentialId,
            upstream.proxy,
            upstream.ssl,
            upstream.ntripVersion,
            downstream.host,
            downstream.port,
            downstream.mount,
            downstreamCredentialId,
            downstream.proxy,
            downstream.ssl,
            downstream.ntripVersion,
            body.downstreamMode ?? before.downstream_mode,
            body.lat === undefined ? before.lat : body.lat,
            body.lon === undefined ? before.lon : body.lon,
            body.uaPrefix ?? before.ua_prefix,
            body.nmeaIntervalSec ?? Number(before.nmea_interval_sec),
            body.origin ?? before.origin,
            body.originRef ?? before.origin_ref,
            body.tags === undefined
              ? before.tags
              : body.tags === null
                ? null
                : JSON.stringify(body.tags),
            upstreamKey,
            downstreamKey,
            ownerId,
            id
          ]
        );
      });
    } catch (err) {
      duplicateGuard(err);
    }

    const after = await getJobRow(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update',
      'relay_job',
      id,
      publicJob(before, null),
      publicJob(after, null),
      ipFrom(req)
    );
    await requestReconcile(id);
    res.json({ item: publicJob(after, await getState(id)) });
  })
);

relayJobsRouter.post(
  '/bulk',
  requireBulkPermission('relay', {
    enable: 'edit',
    disable: 'edit',
    lock: 'edit',
    unlock: 'edit',
    restart: 'edit',
    delete: 'delete'
  }),
  asyncHandler(async (req, res) => {
    const body = bulkBodySchema.parse(req.body);
    const ids = uniqueIds(body.ids);
    const result = emptyBulkResult();
    const allowed: any[] = [];
    for (const id of ids) {
      const row = await getJobRow(id);
      if (!row || row.deleted_at !== null) {
        result.notFound += 1;
        continue;
      }
      try {
        await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
        if ((body.action === 'enable' || body.action === 'disable') && row.locked) {
          throw new ApiError(409, 'RELAY_LOCKED', 'Relay job đang khóa');
        }
        if (body.action === 'lock' && row.enabled) {
          throw new ApiError(409, 'RELAY_ENABLED', 'Phải tắt relay job trước khi khóa');
        }
        if (body.action === 'unlock' && !row.locked) {
          throw new ApiError(409, 'RELAY_UNLOCKED', 'Relay job không ở trạng thái khóa');
        }
        if (
          body.action === 'enable' &&
          (row.paused_by_station_id !== null || row.paused_by_mountpoint_id !== null)
        ) {
          throw new ApiError(409, 'RESOURCE_PAUSED', 'Relay job đang bị tạm dừng');
        }
        if (body.action === 'enable') {
          await assertNoCycles({
            id,
            upstreamKey: String(row.upstream_key),
            downstreamKey: String(row.downstream_key),
            enabled: true
          });
        }
        allowed.push(row);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) result.forbidden += 1;
        else if (err instanceof ApiError && err.status === 409) result.skipped += 1;
        else throw err;
      }
    }
    await withTransaction(async (conn) => {
      for (const row of allowed) {
        if (body.action === 'delete') {
          await conn.query(
            `UPDATE relay_jobs
                SET deleted_at = UTC_TIMESTAMP(3), enabled = 0, ${TOMBSTONE_KEY_SQL},
                    desired_revision = desired_revision + 1
              WHERE id = ?`,
            [row.id]
          );
        } else if (body.action === 'restart') {
          await conn.query(
            `UPDATE relay_jobs
                SET desired_revision = desired_revision + 1
              WHERE id = ?`,
            [row.id]
          );
        } else if (body.action === 'lock' || body.action === 'unlock') {
          await conn.query(
            `UPDATE relay_jobs
                SET locked = ?,
                    enabled = 0,
                    paused_by_station_id = NULL,
                    paused_by_mountpoint_id = NULL,
                    desired_revision = desired_revision + 1
              WHERE id = ?`,
            [body.action === 'lock' ? 1 : 0, row.id]
          );
        } else {
          await conn.query(
            `UPDATE relay_jobs
                SET enabled = ?,
                    paused_by_station_id = NULL,
                    paused_by_mountpoint_id = NULL,
                    desired_revision = desired_revision + 1
              WHERE id = ?`,
            [body.action === 'enable' ? 1 : 0, row.id]
          );
        }
      }
    });
    result.updated = allowed.length;
    await writeAudit(
      adminPool,
      req.auth!.id,
      `bulk_${body.action}`,
      'relay_job',
      `bulk:${ids.length}`,
      null,
      { ids, result },
      ipFrom(req)
    );
    res.json({ result });
  })
);

const importJobSchema = z.object({
  data: z.unknown(),
  dryRun: z.boolean().default(true)
});

function normalizeImportItem(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.upstream && raw.downstream) return raw;
  const credential = (username: unknown, password: unknown) =>
    username ? { username: String(username), ...(password ? { password: String(password) } : {}) } : null;
  return {
    id: raw.id,
    externalKey: raw.external_key ?? raw.externalKey ?? null,
    name: raw.name ?? raw.external_key ?? `Import ${Date.now()}`,
    enabled: Boolean(raw.enabled ?? false),
    upstream: {
      host: String(raw.src_host ?? ''),
      port: Number(raw.src_port ?? 1509),
      mount: String(raw.src_mount ?? ''),
      proxy: String(raw.src_proxy ?? ''),
      ssl: Boolean(raw.src_ssl ?? false),
      ntripVersion: String(raw.src_ntrip_version ?? raw.src_version ?? 'v2')
    },
    downstream: {
      host: String(raw.dst_host ?? ''),
      port: Number(raw.dst_port ?? 1509),
      mount: String(raw.dst_mount ?? ''),
      proxy: String(raw.dst_proxy ?? ''),
      ssl: Boolean(raw.dst_ssl ?? false),
      ntripVersion: String(raw.dst_ntrip_version ?? raw.dst_version ?? 'v2')
    },
    upstreamCredential: credential(raw.src_user ?? raw.src_username, raw.src_pass ?? raw.src_password),
    downstreamCredential: credential(raw.dst_user ?? raw.dst_username, raw.dst_pass ?? raw.dst_password),
    downstreamMode: raw.dst_mode ?? raw.downstreamMode ?? 'auto',
    lat: raw.lat ?? null,
    lon: raw.lon ?? null,
    uaPrefix: raw.ua_prefix ?? raw.uaPrefix ?? '',
    nmeaIntervalSec: Number(raw.nmea_interval_sec ?? raw.nmeaIntervalSec ?? 0),
    origin: 'import',
    originRef: String(raw.id ?? raw.external_key ?? ''),
    tags: raw.tags ?? null
  };
}

relayJobsRouter.post(
  '/import',
  requirePermission('relay', 'add'),
  asyncHandler(async (req, res) => {
    const body = importJobSchema.parse(req.body);
    const rawItems = Array.isArray(body.data) ? body.data : [body.data];
    const items: any[] = [];
    const errors: string[] = [];
    for (const [index, raw] of rawItems.entries()) {
      try {
        const item = createSchema.parse(normalizeImportItem(raw));
        const id = raw && typeof raw === 'object' ? Number((raw as any).id ?? 0) : 0;
        if (id > 0) {
          const existing = await getJobRow(id);
          if (!existing || existing.deleted_at !== null) {
            throw new ApiError(404, 'NOT_FOUND', 'Relay job không tồn tại');
          }
          await assertRecordScope(req, existing.owner_web_user_id, 'owner_web_user_id', existing.company_id);
        }
        await assertNoCycles({
          id: id > 0 ? id : null,
          upstreamKey: endpointKey(item.upstream),
          downstreamKey: endpointKey(item.downstream),
          enabled: item.enabled
        });
        items.push({ ...item, id: id > 0 ? id : null });
      } catch (err) {
        errors.push(
          `Dòng ${index + 1}: ${err instanceof Error ? err.message : 'dữ liệu không hợp lệ'}`
        );
      }
    }
    let created = 0;
    let updated = 0;
    const touchedIds: number[] = [];
    if (!body.dryRun && errors.length === 0) {
      await withTransaction(async (conn) => {
        for (const bodyItem of items) {
          const upstreamKey = endpointKey(bodyItem.upstream);
          const downstreamKey = endpointKey(bodyItem.downstream);
          const existingRows = bodyItem.id
            ? await conn.query(
                'SELECT upstream_credential_id, downstream_credential_id, owner_web_user_id, company_id FROM relay_jobs WHERE id = ?',
                [bodyItem.id]
              )
            : null;
          const existing = (existingRows as any[] | null)?.[0]?.[0] ?? null;
          let ownerId = existing?.owner_web_user_id
            ? Number(existing.owner_web_user_id)
            : Number(req.auth!.id);
          let companyId = existing?.company_id === null || existing?.company_id === undefined
            ? null
            : Number(existing.company_id);
          if (!bodyItem.id) {
            const ownership = await resolveWriteOwnership(
              req,
              bodyItem.ownerWebUserId,
              bodyItem.companyId
            );
            ownerId = ownership.ownerId;
            companyId = ownership.companyId;
          }
          const upstreamCredentialId = await upsertCredential(
            conn,
            bodyItem.upstreamCredential,
            existing?.upstream_credential_id
              ? Number(existing.upstream_credential_id)
              : null,
            `${bodyItem.name} upstream`,
            ownerId,
            req.auth!.id,
            companyId
          );
          const downstreamCredentialId = await upsertCredential(
            conn,
            bodyItem.downstreamCredential,
            existing?.downstream_credential_id
              ? Number(existing.downstream_credential_id)
              : null,
            `${bodyItem.name} downstream`,
            ownerId,
            req.auth!.id,
            companyId
          );
          if (bodyItem.id) {
            await conn.query(
              `UPDATE relay_jobs SET
                 external_key=?, name=?, enabled=?, upstream_host=?, upstream_port=?,
                 upstream_mount=?, upstream_credential_id=?, upstream_proxy=?, upstream_ssl=?,
                 upstream_ntrip_version=?, downstream_host=?, downstream_port=?,
                 downstream_mount=?, downstream_credential_id=?, downstream_proxy=?,
                 downstream_ssl=?, downstream_ntrip_version=?, downstream_mode=?, lat=?, lon=?,
                 ua_prefix=?, nmea_interval_sec=?, origin='import', origin_ref=?, tags=?,
                 upstream_key=?, downstream_key=?, desired_revision=desired_revision+1
               WHERE id=?`,
              [
                bodyItem.externalKey, bodyItem.name, bodyItem.enabled ? 1 : 0,
                bodyItem.upstream.host, bodyItem.upstream.port, bodyItem.upstream.mount,
                upstreamCredentialId, bodyItem.upstream.proxy, bodyItem.upstream.ssl ? 1 : 0,
                bodyItem.upstream.ntripVersion, bodyItem.downstream.host, bodyItem.downstream.port,
                bodyItem.downstream.mount, downstreamCredentialId, bodyItem.downstream.proxy,
                bodyItem.downstream.ssl ? 1 : 0, bodyItem.downstream.ntripVersion,
                bodyItem.downstreamMode, bodyItem.lat, bodyItem.lon, bodyItem.uaPrefix,
                bodyItem.nmeaIntervalSec, bodyItem.originRef,
                bodyItem.tags === null ? null : JSON.stringify(bodyItem.tags),
                upstreamKey, downstreamKey, bodyItem.id
              ]
            );
            updated += 1;
            touchedIds.push(bodyItem.id);
          } else {
            const [result]: any = await conn.query(
              `INSERT INTO relay_jobs (
                 external_key, name, enabled, upstream_host, upstream_port, upstream_mount,
                 upstream_credential_id, upstream_proxy, upstream_ssl, upstream_ntrip_version,
                 downstream_host, downstream_port, downstream_mount, downstream_credential_id,
                 downstream_proxy, downstream_ssl, downstream_ntrip_version, downstream_mode,
                 lat, lon, ua_prefix, nmea_interval_sec, origin, origin_ref, tags,
                 desired_revision, upstream_key, downstream_key, owner_web_user_id, company_id, created_by
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, 1, ?, ?, ?, ?, ?)`,
              [
                bodyItem.externalKey, bodyItem.name, bodyItem.enabled ? 1 : 0,
                bodyItem.upstream.host, bodyItem.upstream.port, bodyItem.upstream.mount,
                upstreamCredentialId, bodyItem.upstream.proxy, bodyItem.upstream.ssl ? 1 : 0,
                bodyItem.upstream.ntripVersion, bodyItem.downstream.host, bodyItem.downstream.port,
                bodyItem.downstream.mount, downstreamCredentialId, bodyItem.downstream.proxy,
                bodyItem.downstream.ssl ? 1 : 0, bodyItem.downstream.ntripVersion,
                bodyItem.downstreamMode, bodyItem.lat, bodyItem.lon, bodyItem.uaPrefix,
                bodyItem.nmeaIntervalSec, bodyItem.originRef,
                bodyItem.tags === null ? null : JSON.stringify(bodyItem.tags),
                upstreamKey, downstreamKey, ownerId, companyId, req.auth!.id
              ]
            );
            created += 1;
            touchedIds.push(Number(result.insertId));
          }
        }
      });
      await writeAudit(
        adminPool,
        req.auth!.id,
        'import',
        'relay_job',
        `bulk:${items.length}`,
        null,
        { created, updated },
        ipFrom(req)
      );
      for (const id of touchedIds) await requestReconcile(id);
    }
    res.json({ dryRun: body.dryRun, created, updated, errors, items: items.length });
  })
);

relayJobsRouter.delete(
  '/:id',
  requirePermission('relay', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getJobRow(id);
    if (!before || before.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    await adminPool.query(
      `UPDATE relay_jobs
          SET deleted_at = UTC_TIMESTAMP(3), enabled = 0,
              ${TOMBSTONE_KEY_SQL},
              desired_revision = desired_revision + 1
        WHERE id = ?`,
      [id]
    );
    const after = await getJobRow(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'delete',
      'relay_job',
      id,
      publicJob(before, null),
      publicJob(after, null),
      ipFrom(req)
    );
    await requestReconcile(id);
    res.status(204).send();
  })
);

async function setEnabled(req: any, enabled: boolean) {
  const id = Number(req.params.id);
  const before = await getJobRow(id);
  if (!before || before.deleted_at !== null) {
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
  }
  await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
  if (before.locked) {
    throw new ApiError(409, 'RELAY_LOCKED', 'Relay job đang khóa, phải mở khóa trước');
  }
  if (
    enabled &&
    (before.paused_by_station_id !== null || before.paused_by_mountpoint_id !== null)
  ) {
    throw new ApiError(
      409,
      'RESOURCE_PAUSED',
      'Relay job đang bị tạm dừng bởi trạm hoặc mountpoint'
    );
  }
  if (enabled) {
    await assertNoCycles({
      id,
      upstreamKey: String(before.upstream_key),
      downstreamKey: String(before.downstream_key),
      enabled: true
    });
  }
  await adminPool.query(
    `UPDATE relay_jobs
        SET enabled = ?,
            paused_by_station_id = NULL,
            paused_by_mountpoint_id = NULL,
            desired_revision = desired_revision + 1
      WHERE id = ?`,
    [enabled, id]
  );
  const after = await getJobRow(id);
  await writeAudit(
    adminPool,
    req.auth!.id,
    enabled ? 'enable' : 'disable',
    'relay_job',
    id,
    publicJob(before, null),
    publicJob(after, null),
    ipFrom(req)
  );
  await requestReconcile(id);
  return publicJob(after, await getState(id));
}

relayJobsRouter.post(
  '/:id/enable',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setEnabled(req, true) });
  })
);

relayJobsRouter.post(
  '/:id/disable',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setEnabled(req, false) });
  })
);

async function setLocked(req: any, locked: boolean) {
  const id = Number(req.params.id);
  const before = await getJobRow(id);
  if (!before || before.deleted_at !== null) {
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
  }
  await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
  if (locked && before.enabled) {
    throw new ApiError(400, 'RELAY_ENABLED', 'Phải tắt relay job trước khi khóa');
  }
  await adminPool.query(
    `UPDATE relay_jobs
        SET locked = ?,
            enabled = 0,
            paused_by_station_id = NULL,
            paused_by_mountpoint_id = NULL,
            desired_revision = desired_revision + 1
      WHERE id = ?`,
    [locked ? 1 : 0, id]
  );
  const after = await getJobRow(id);
  await writeAudit(
    adminPool,
    req.auth!.id,
    locked ? 'lock' : 'unlock',
    'relay_job',
    id,
    publicJob(before, null),
    publicJob(after, null),
    ipFrom(req)
  );
  await requestReconcile(id);
  return publicJob(after, await getState(id));
}

relayJobsRouter.post(
  '/:id/lock',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setLocked(req, true) });
  })
);

relayJobsRouter.post(
  '/:id/unlock',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setLocked(req, false) });
  })
);

relayJobsRouter.post(
  '/:id/restart',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getJobRow(id);
    if (!before || before.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    await adminPool.query(
      'UPDATE relay_jobs SET desired_revision = desired_revision + 1 WHERE id = ?',
      [id]
    );
    const after = await getJobRow(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'restart',
      'relay_job',
      id,
      publicJob(before, null),
      publicJob(after, null),
      ipFrom(req)
    );
    await requestReconcile(id);
    res.json({ item: publicJob(after, await getState(id)) });
  })
);

relayJobsRouter.post(
  '/:id/test',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await getJobRow(id);
    if (!row || row.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    try {
      const result = await callGoInternal('/internal/test', { jobId: id }, { timeoutMs: 10000 });
      res.json({ result });
    } catch (err) {
      throw new ApiError(
        502,
        'RELAY_TEST_FAILED',
        err instanceof Error ? err.message : 'Không gọi được dịch vụ relay'
      );
    }
  })
);
