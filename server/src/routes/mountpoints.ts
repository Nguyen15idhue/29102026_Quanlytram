import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { assertRecordScope, ipFrom, listScope, pageFrom, scopeIdsFor } from '../rbac/access';
import { callGoInternal } from '../lib/internalApi';
import { publicConnection, type GoConnection } from '../lib/caster';
import { mountpointSourceState } from '../lib/mountpointExplorer';

export const mountpointsRouter = Router();
mountpointsRouter.use(requireAuth);
mountpointsRouter.use(csrfProtection);

const createSchema = z.object({
  name: z.string().min(1).max(128),
  station_id: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  requires_auth: z.boolean().optional().default(true),
  service_type: z.string().max(64).optional(),
  position_mode: z.string().max(64).optional(),
  satellite_systems: z.string().max(64).optional(),
  caster_interval: z.number().int().min(0).max(3600).optional(),
  code_protocol: z.string().max(64).optional(),
  code_type: z.string().max(64).optional(),
  description: z.string().max(500).optional(),
  owner_web_user_id: z.number().int().positive().nullable().optional()
});
const updateSchema = createSchema.partial();

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

async function getMountpoint(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM mountpoints WHERE id = ?', [id]);
  return rows[0] ?? null;
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

async function loadGoConnections(): Promise<{ available: boolean; items: GoConnection[] }> {
  try {
    const response = await callGoInternal<{ items: GoConnection[] }>(
      '/internal/caster/connections',
      undefined,
      { method: 'GET', timeoutMs: 2000 }
    );
    return { available: true, items: response?.items ?? [] };
  } catch {
    return { available: false, items: [] };
  }
}

async function enrichExplorer(rows: RowDataPacket[]): Promise<{
  items: any[];
  casterAvailable: boolean;
}> {
  if (rows.length === 0) {
    return { items: [], casterAvailable: (await loadGoConnections()).available };
  }
  const now = Date.now();
  const ids = rows.map((row) => Number(row.id));
  const names = rows.map((row) => String(row.name));
  const placeholdersForIds = placeholders(ids);
  const placeholdersForNames = placeholders(names);
  const fromHour = new Date(now - 60 * 60_000);

  const [qualityRows, messageRows, alertRows, relayRows, listenerRows, accountRows, go] =
    await Promise.all([
      runtimeQuery<RowDataPacket[]>(
        `SELECT mountpoint_id, score, state, ts FROM (
           SELECT mountpoint_id, score, state, ts, ROW_NUMBER() OVER (
             PARTITION BY mountpoint_id ORDER BY ts DESC, id DESC
           ) AS rn
             FROM quality_samples
            WHERE target_type = 'station' AND direction = 'ingest'
              AND mountpoint_id IN (${placeholdersForIds})
         ) ranked WHERE rn = 1`,
        ids
      ),
      runtimeQuery<RowDataPacket[]>(
        `SELECT mountpoint_id, SUM(bytes) AS total_bytes, SUM(count) AS total_count
           FROM rtcm_message_stats
          WHERE target_type = 'station' AND direction = 'ingest'
            AND hour_start_utc >= ? AND mountpoint_id IN (${placeholdersForIds})
          GROUP BY mountpoint_id`,
        [fromHour, ...ids]
      ),
      runtimeQuery<RowDataPacket[]>(
        `SELECT mountpoint_id, COUNT(*) AS total
           FROM quality_alerts
          WHERE resolved_at IS NULL AND mountpoint_id IN (${placeholdersForIds})
          GROUP BY mountpoint_id`,
        ids
      ),
      query<RowDataPacket[]>(
        `SELECT id, name, enabled, desired_revision, upstream_mount, upstream_host,
                upstream_port, upstream_ssl, upstream_ntrip_version,
                downstream_host, downstream_port, downstream_mount, downstream_ssl,
                downstream_ntrip_version, downstream_mode, origin, updated_at,
                upstream_credential_id, downstream_credential_id
           FROM relay_jobs
          WHERE deleted_at IS NULL AND upstream_mount IN (${placeholdersForNames})
          ORDER BY name`,
        names
      ),
      query<RowDataPacket[]>(
        `SELECT lm.mountpoint_id, l.id, l.name, l.port, l.enabled, l.role
           FROM caster_listener_mountpoints lm
           JOIN caster_listeners l ON l.id = lm.listener_id
          WHERE lm.mountpoint_id IN (${placeholdersForIds})
          ORDER BY l.port, l.name`,
        ids
      ),
      query<RowDataPacket[]>(
        `SELECT aa.mountpoint_id, a.id, a.username, a.enabled, a.max_connections
           FROM account_mountpoint_acl aa
           JOIN ntrip_accounts a ON a.id = aa.account_id
          WHERE aa.mountpoint_id IN (${placeholdersForIds})
          ORDER BY a.username`,
        ids
      ),
      loadGoConnections()
    ]);

  const relayIds = relayRows.map((row) => Number(row.id));
  const stateRows = relayIds.length
    ? await runtimeQuery<RowDataPacket[]>(
        `SELECT relay_job_id, applied_revision, runtime_state, last_applied_at, last_error
           FROM relay_job_state WHERE relay_job_id IN (${placeholders(relayIds)})`,
        relayIds
      )
    : [];
  const stateMap = new Map<number, any>();
  for (const row of stateRows) stateMap.set(Number(row.relay_job_id), row);

  const qualityMap = new Map<number, any>();
  for (const row of qualityRows) qualityMap.set(Number(row.mountpoint_id), row);
  const messageMap = new Map<number, any>();
  for (const row of messageRows) messageMap.set(Number(row.mountpoint_id), row);
  const alertMap = new Map<number, number>();
  for (const row of alertRows) alertMap.set(Number(row.mountpoint_id), Number(row.total));

  const relayMap = new Map<string, any[]>();
  for (const row of relayRows) {
    const state = stateMap.get(Number(row.id));
    const item = {
      id: Number(row.id),
      name: String(row.name),
      enabled: Boolean(row.enabled),
      desiredRevision: Number(row.desired_revision ?? 0),
      appliedRevision: state ? Number(state.applied_revision ?? 0) : null,
      runtimeState: state ? String(state.runtime_state) : 'unknown',
      lastAppliedAt: state?.last_applied_at ?? null,
      lastError: state?.last_error ?? null,
      upstream: {
        host: String(row.upstream_host),
        port: Number(row.upstream_port),
        mount: String(row.upstream_mount),
        ssl: Boolean(row.upstream_ssl),
        ntripVersion: String(row.upstream_ntrip_version)
      },
      downstream: {
        host: String(row.downstream_host),
        port: Number(row.downstream_port),
        mount: String(row.downstream_mount),
        ssl: Boolean(row.downstream_ssl),
        ntripVersion: String(row.downstream_ntrip_version),
        mode: String(row.downstream_mode)
      },
      hasCredential: {
        upstream: row.upstream_credential_id !== null,
        downstream: row.downstream_credential_id !== null
      },
      origin: String(row.origin ?? ''),
      updatedAt: row.updated_at
    };
    const key = String(row.upstream_mount).toLowerCase();
    const list = relayMap.get(key) ?? [];
    list.push(item);
    relayMap.set(key, list);
  }

  const listenerMap = new Map<number, any[]>();
  const listenerNames = new Map<number, string>();
  for (const row of listenerRows) {
    const mpId = Number(row.mountpoint_id);
    const item = {
      id: Number(row.id),
      name: String(row.name),
      port: Number(row.port),
      enabled: Boolean(row.enabled),
      role: String(row.role)
    };
    const list = listenerMap.get(mpId) ?? [];
    list.push(item);
    listenerMap.set(mpId, list);
    listenerNames.set(Number(row.id), String(row.name));
  }

  const accountMap = new Map<number, any[]>();
  const accountNames = new Map<number, string>();
  for (const row of accountRows) {
    const mpId = Number(row.mountpoint_id);
    const item = {
      id: Number(row.id),
      username: String(row.username),
      enabled: Boolean(row.enabled),
      maxConnections: Number(row.max_connections)
    };
    const list = accountMap.get(mpId) ?? [];
    list.push(item);
    accountMap.set(mpId, list);
    accountNames.set(Number(row.id), String(row.username));
  }

  const mountpointNames = new Map<number, string>();
  for (const row of rows) mountpointNames.set(Number(row.id), String(row.name));
  const onlineByMountpoint = new Map<number, any[]>();
  for (const connection of go.items) {
    const mpId = Number(connection.mountpointId);
    if (!mountpointNames.has(mpId)) continue;
    const item = publicConnection(
      connection,
      listenerNames.get(Number(connection.listenerId)),
      mountpointNames.get(mpId),
      connection.accountId === null ? undefined : accountNames.get(Number(connection.accountId))
    );
    const list = onlineByMountpoint.get(mpId) ?? [];
    list.push(item);
    onlineByMountpoint.set(mpId, list);
  }

  const items = rows.map((row) => {
    const id = Number(row.id);
    const latest = qualityMap.get(id) ?? null;
    const ageSec = latest?.ts
      ? Math.max(0, Math.round((now - new Date(latest.ts).getTime()) / 1000))
      : null;
    const totalBytes = Number(messageMap.get(id)?.total_bytes ?? 0);
    const totalCount = Number(messageMap.get(id)?.total_count ?? 0);
    const online = onlineByMountpoint.get(id) ?? [];
    return {
      id,
      name: String(row.name),
      enabled: Boolean(row.enabled),
      requiresAuth: Boolean(row.requires_auth),
      serviceType: String(row.service_type ?? ''),
      positionMode: String(row.position_mode ?? ''),
      satelliteSystems: String(row.satellite_systems ?? ''),
      casterInterval: Number(row.caster_interval ?? 0),
      codeProtocol: String(row.code_protocol ?? ''),
      codeType: String(row.code_type ?? ''),
      description: String(row.description ?? ''),
      stationId: row.station_id === null ? null : Number(row.station_id),
      stationCode: row.station_code ?? null,
      stationName: row.station_name ?? null,
      ownerWebUserId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
      ownerName: row.owner_name ?? null,
      sourceState: mountpointSourceState({ enabled: Boolean(row.enabled), latest, now }),
      quality: latest
        ? {
            score: Number(latest.score ?? 0),
            state: String(latest.state ?? 'unknown'),
            lastSampleAt: latest.ts,
            ageSec,
            bitrateBps: totalBytes > 0 ? (totalBytes * 8) / 3600 : 0,
            messageRatePerMinute: totalCount > 0 ? totalCount / 60 : 0
          }
        : null,
      bitrateBps: totalBytes > 0 ? (totalBytes * 8) / 3600 : 0,
      messageRatePerMinute: totalCount > 0 ? totalCount / 60 : 0,
      relays: relayMap.get(String(row.name).toLowerCase()) ?? [],
      listeners: listenerMap.get(id) ?? [],
      accounts: accountMap.get(id) ?? [],
      onlineConnections: online,
      onlineCount: online.length,
      alertsOpen: alertMap.get(id) ?? 0
    };
  });

  return { items, casterAvailable: go.available };
}

async function assertStationScope(req: any, stationId: number | null | undefined): Promise<void> {
  if (stationId === null || stationId === undefined) return;
  const rows = await query<RowDataPacket[]>('SELECT owner_web_user_id FROM stations WHERE id = ?', [
    stationId
  ]);
  if (rows.length === 0) throw new ApiError(400, 'INVALID_STATION', 'Trạm không tồn tại');
  await assertRecordScope(req, rows[0].owner_web_user_id);
}

mountpointsRouter.get(
  '/',
  requirePermission('mountpoints', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'm.owner_web_user_id');
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (q) {
      where += ' AND m.name LIKE ?';
      params.push(`%${q}%`);
    }
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT m.*, s.code AS station_code, s.name AS station_name
         FROM mountpoints m LEFT JOIN stations s ON s.id = m.station_id
        WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM mountpoints m WHERE ${where}`,
      params
    );
    res.json({ items: rows, total: Number(countRows[0].total), pageSize, offset });
  })
);

mountpointsRouter.get(
  '/explorer',
  requirePermission('mountpoints', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'm.owner_web_user_id');
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    const q = String(req.query.q || '').trim();
    if (q) {
      where += ' AND (m.name LIKE ? OR s.code LIKE ? OR s.name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const stationId = Number(req.query.stationId || 0);
    if (Number.isInteger(stationId) && stationId > 0) {
      where += ' AND m.station_id = ?';
      params.push(stationId);
    }
    const ownerId = Number(req.query.ownerId || 0);
    if (Number.isInteger(ownerId) && ownerId > 0) {
      where += ' AND m.owner_web_user_id = ?';
      params.push(ownerId);
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT m.*, s.code AS station_code, s.name AS station_name,
              u.username AS owner_name
         FROM mountpoints m
         LEFT JOIN stations s ON s.id = m.station_id
         LEFT JOIN web_users u ON u.id = m.owner_web_user_id
        WHERE ${where}
        ORDER BY m.name`,
      params
    );
    const enriched = await enrichExplorer(rows);
    const state = String(req.query.state || '').trim();
    const alertsOnly = String(req.query.alerts || '') === '1';
    const filtered = enriched.items.filter((item) => {
      if (state && item.sourceState !== state) return false;
      if (alertsOnly && item.alertsOpen === 0) return false;
      return true;
    });
    const { pageSize, offset } = pageFrom(req);
    res.json({
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      pageSize,
      offset,
      casterAvailable: enriched.casterAvailable,
      filters: {
        q,
        stationId: stationId > 0 ? stationId : null,
        ownerId: ownerId > 0 ? ownerId : null,
        state: state || null,
        alerts: alertsOnly
      }
    });
  })
);

mountpointsRouter.get(
  '/:id/explorer',
  requirePermission('mountpoints', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await query<RowDataPacket[]>(
      `SELECT m.*, s.code AS station_code, s.name AS station_name,
              u.username AS owner_name
         FROM mountpoints m
         LEFT JOIN stations s ON s.id = m.station_id
         LEFT JOIN web_users u ON u.id = m.owner_web_user_id
        WHERE m.id = ?`,
      [id]
    );
    if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    await assertRecordScope(req, rows[0].owner_web_user_id);
    const enriched = await enrichExplorer(rows);
    res.json({ item: enriched.items[0], casterAvailable: enriched.casterAvailable });
  })
);

mountpointsRouter.get(
  '/:id',
  requirePermission('mountpoints', 'view'),
  asyncHandler(async (req, res) => {
    const item = await getMountpoint(Number(req.params.id));
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    await assertRecordScope(req, item.owner_web_user_id);
    res.json({ item });
  })
);

mountpointsRouter.post(
  '/',
  requirePermission('mountpoints', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    await assertStationScope(req, body.station_id);
    const ownerId = await resolveOwner(req, body.owner_web_user_id);
    const [result] = await adminPool.query<any>(
      `INSERT INTO mountpoints
         (name, station_id, enabled, requires_auth, service_type, position_mode,
          satellite_systems, caster_interval, code_protocol, code_type, description,
          owner_web_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name, body.station_id ?? null, body.enabled, body.requires_auth,
        body.service_type ?? 'rtcm', body.position_mode ?? 'normal',
        body.satellite_systems ?? '', body.caster_interval ?? 0,
        body.code_protocol ?? '', body.code_type ?? '', body.description ?? '',
        ownerId, req.auth!.id
      ]
    );
    const item = await getMountpoint(Number(result.insertId));
    await writeAudit(adminPool, req.auth!.id, 'create', 'mountpoint', result.insertId, null, item, ipFrom(req));
    res.status(201).json({ item });
  })
);

mountpointsRouter.patch(
  '/:id',
  requirePermission('mountpoints', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getMountpoint(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    await assertRecordScope(req, before.owner_web_user_id);
    const body = updateSchema.parse(req.body);
    if (body.station_id !== undefined) await assertStationScope(req, body.station_id);
    const ownerId =
      body.owner_web_user_id === undefined
        ? Number(before.owner_web_user_id)
        : await resolveOwner(req, body.owner_web_user_id);
    await adminPool.query(
      `UPDATE mountpoints SET name=?, station_id=?, enabled=?, requires_auth=?,
         service_type=?, position_mode=?, satellite_systems=?, caster_interval=?,
         code_protocol=?, code_type=?, description=?, owner_web_user_id=? WHERE id=?`,
      [
        body.name ?? before.name,
        body.station_id === undefined ? before.station_id : body.station_id,
        body.enabled === undefined ? before.enabled : body.enabled,
        body.requires_auth === undefined ? before.requires_auth : body.requires_auth,
        body.service_type ?? before.service_type,
        body.position_mode ?? before.position_mode,
        body.satellite_systems ?? before.satellite_systems,
        body.caster_interval ?? before.caster_interval,
        body.code_protocol ?? before.code_protocol,
        body.code_type ?? before.code_type,
        body.description ?? before.description,
        ownerId,
        id
      ]
    );
    const after = await getMountpoint(id);
    await writeAudit(adminPool, req.auth!.id, 'update', 'mountpoint', id, before, after, ipFrom(req));
    res.json({ item: after });
  })
);

mountpointsRouter.delete(
  '/:id',
  requirePermission('mountpoints', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getMountpoint(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    await assertRecordScope(req, before.owner_web_user_id);
    await adminPool.query('DELETE FROM mountpoints WHERE id = ?', [id]);
    await writeAudit(adminPool, req.auth!.id, 'delete', 'mountpoint', id, before, null, ipFrom(req));
    res.status(204).send();
  })
);
