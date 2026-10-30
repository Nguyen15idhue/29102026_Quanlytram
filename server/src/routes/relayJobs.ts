import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { writeAudit } from '../lib/audit';
import { encryptSecret } from '../lib/crypto';
import { endpointKey } from '../lib/endpointKey';
import { asyncHandler, ApiError } from '../lib/http';
import { callGoInternal } from '../lib/internalApi';
import { findCycle, RelayEdge } from '../lib/loopGuard';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { assertRecordScope, ipFrom, listScope, pageFrom, scopeIdsFor } from '../rbac/access';

export const relayJobsRouter = Router();
relayJobsRouter.use(requireAuth);
relayJobsRouter.use(csrfProtection);

const credentialPatch = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512).optional()
});

const endpointSchema = z.object({
  host: z.string().min(1).max(190),
  port: z.number().int().min(1).max(65535).optional().default(2101),
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
  ownerWebUserId: z.number().int().positive().nullable().optional()
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
  ownerWebUserId: z.number().int().positive().nullable().optional()
});

const JOB_SELECT = `
  SELECT j.*,
         uc.username AS upstream_credential_username,
         dc.username AS downstream_credential_username
    FROM relay_jobs j
    LEFT JOIN relay_credentials uc ON uc.id = j.upstream_credential_id
    LEFT JOIN relay_credentials dc ON dc.id = j.downstream_credential_id`;

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

async function resolveOwner(req: any, requested?: number | null): Promise<number> {
  const actor = req.auth!;
  if (!requested || Number(requested) === actor.id) return actor.id;
  if (req.permissionScope === 'own') {
    throw new ApiError(403, 'FORBIDDEN', 'Không được gán chủ sở hữu khác');
  }
  if (req.permissionScope === 'subtree') {
    const ids = await scopeIdsFor(req);
    if (!ids.includes(Number(requested))) {
      throw new ApiError(403, 'FORBIDDEN', 'Chủ sở hữu ngoài phạm vi quản lý');
    }
  }
  const exists = await query<RowDataPacket[]>('SELECT id FROM web_users WHERE id = ?', [requested]);
  if (exists.length === 0) throw new ApiError(400, 'INVALID_OWNER', 'Chủ sở hữu không tồn tại');
  return Number(requested);
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

async function upsertCredential(
  conn: any,
  input: CredentialInput | null | undefined,
  existingId: number | null,
  name: string,
  ownerId: number,
  actorId: number
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
    `INSERT INTO relay_credentials (name, username, password_enc, owner_web_user_id, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [name, input.username, encryptSecret(input.password), ownerId, actorId]
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
    const scope = listScope(req, ids, 'j.owner_web_user_id');
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const params: unknown[] = [...scope.params];
    let where = `${scope.sql} AND j.deleted_at IS NULL`;
    if (q) {
      where += ' AND (j.name LIKE ? OR j.external_key LIKE ? OR j.upstream_host LIKE ? OR j.downstream_host LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const [rows] = await adminPool.query<any[]>(
      `${JOB_SELECT} WHERE ${where} ORDER BY j.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<any[]>(
      `SELECT COUNT(*) AS total FROM relay_jobs j WHERE ${where}`,
      params
    );
    const stateMap = await statesFor(rows.map((row) => Number(row.id)));
    res.json({
      items: rows.map((row) => publicJob(row, stateMap.get(Number(row.id)))),
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
    await assertRecordScope(req, row.owner_web_user_id);
    res.json({ item: publicJob(row, await getState(Number(row.id))) });
  })
);

relayJobsRouter.post(
  '/',
  requirePermission('relay', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const ownerId = await resolveOwner(req, body.ownerWebUserId);
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
          req.auth!.id
        );
        const downstreamCredentialId = await upsertCredential(
          conn,
          body.downstreamCredential,
          null,
          `${body.name} downstream`,
          ownerId,
          req.auth!.id
        );
        const [result]: any = await conn.query(
          `INSERT INTO relay_jobs (
             external_key, name, enabled,
             upstream_host, upstream_port, upstream_mount, upstream_credential_id,
             upstream_proxy, upstream_ssl, upstream_ntrip_version,
             downstream_host, downstream_port, downstream_mount, downstream_credential_id,
             downstream_proxy, downstream_ssl, downstream_ntrip_version, downstream_mode,
             lat, lon, ua_prefix, nmea_interval_sec, origin, origin_ref, tags,
             desired_revision, upstream_key, downstream_key, owner_web_user_id, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
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
    await assertRecordScope(req, before.owner_web_user_id);
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
    await assertNoCycles({ id, upstreamKey, downstreamKey, enabled });

    const ownerId =
      body.ownerWebUserId === undefined
        ? Number(before.owner_web_user_id)
        : await resolveOwner(req, body.ownerWebUserId);

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
          req.auth!.id
        );
        const downstreamCredentialId = await upsertCredential(
          conn,
          body.downstreamCredential,
          before.downstream_credential_id === null
            ? null
            : Number(before.downstream_credential_id),
          `${body.name ?? before.name} downstream`,
          ownerId,
          req.auth!.id
        );
        await conn.query(
          `UPDATE relay_jobs SET
             external_key = ?, name = ?, enabled = ?,
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

relayJobsRouter.delete(
  '/:id',
  requirePermission('relay', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getJobRow(id);
    if (!before || before.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, before.owner_web_user_id);
    await adminPool.query(
      `UPDATE relay_jobs
          SET deleted_at = UTC_TIMESTAMP(3), enabled = 0,
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
  await assertRecordScope(req, before.owner_web_user_id);
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
        SET enabled = ?, desired_revision = desired_revision + 1
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

relayJobsRouter.post(
  '/:id/restart',
  requirePermission('relay', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getJobRow(id);
    if (!before || before.deleted_at !== null) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    }
    await assertRecordScope(req, before.owner_web_user_id);
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
    await assertRecordScope(req, row.owner_web_user_id);
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
