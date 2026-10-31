import { Router, type Request } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { bulkBodySchema, emptyBulkResult, uniqueIds } from '../lib/bulk';
import {
  GoConnection,
  listenerCreateSchema,
  listenerMountpointsSchema,
  listenerUpdateSchema,
  publicConnection,
  publicListener
} from '../lib/caster';
import { asyncHandler, ApiError } from '../lib/http';
import { callGoInternal } from '../lib/internalApi';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import {
  assertRecordScope,
  ipFrom,
  listScope,
  pageFrom,
  requireBulkPermission,
  scopeIdsFor
} from '../rbac/access';
import { inScope } from '../rbac/scope';

export const casterRouter = Router();
castorGuard(casterRouter);

export const casterConnectionsRouter = Router();
castorGuard(casterConnectionsRouter);

function castorGuard(router: Router): void {
  router.use(requireAuth);
  router.use(csrfProtection);
}

const LISTENER_SELECT = `
  SELECT l.*,
         (SELECT COUNT(*) FROM caster_listener_mountpoints m WHERE m.listener_id = l.id) AS mountpoint_count
    FROM caster_listeners l`;

async function getListenerRow(id: number): Promise<any | null> {
  const [rows] = await adminPool.query<any[]>(`${LISTENER_SELECT} WHERE l.id = ?`, [id]);
  return rows[0] ?? null;
}

async function listenerMountpointIds(id: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    'SELECT mountpoint_id FROM caster_listener_mountpoints WHERE listener_id = ? ORDER BY mountpoint_id',
    [id]
  );
  return rows.map((row) => Number(row.mountpoint_id));
}

async function requestCasterReconcile(): Promise<void> {
  try {
    await callGoInternal('/internal/caster/reconcile', {});
  } catch (err) {
    console.warn(
      '[caster] reconcile request failed',
      err instanceof Error ? err.message : 'unknown'
    );
  }
}

function duplicateGuard(err: unknown): never {
  if (err && typeof err === 'object' && (err as any).code === 'ER_DUP_ENTRY') {
    throw new ApiError(409, 'DUPLICATE_PORT', 'Cổng listener đã được sử dụng');
  }
  throw err;
}

function validateMountpointIds(ids: number[]): number[] {
  return [...new Set(ids)];
}

async function assertMountpointsExist(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM mountpoints WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  if (rows.length !== ids.length) {
    throw new ApiError(400, 'INVALID_MOUNTPOINT', 'Mountpoint không tồn tại');
  }
}

async function writableMountpointIds(req: Request): Promise<Set<number> | null> {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  if (req.permissionScope === 'all') return null;
  const subtree = req.permissionScope === 'subtree' ? await scopeIdsFor(req) : [];
  const rows = await query<RowDataPacket[]>('SELECT id, owner_web_user_id FROM mountpoints');
  const allowed = new Set<number>();
  for (const row of rows) {
    if (inScope(req.permissionScope, req.auth.id, subtree, row.owner_web_user_id)) {
      allowed.add(Number(row.id));
    }
  }
  return allowed;
}

async function fetchConnections(): Promise<GoConnection[]> {
  try {
    const response = await callGoInternal<{ items: GoConnection[] }>(
      '/internal/caster/connections',
      undefined,
      { method: 'GET' }
    );
    return response?.items ?? [];
  } catch (err) {
    throw new ApiError(
      502,
      'CASTER_UNAVAILABLE',
      err instanceof Error ? err.message : 'Không gọi được caster'
    );
  }
}

casterRouter.get(
  '/listeners',
  requirePermission('caster', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'l.owner_web_user_id');
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (q) {
      where += ' AND (l.name LIKE ? OR l.description LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await adminPool.query<any[]>(
      `${LISTENER_SELECT} WHERE ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<any[]>(
      `SELECT COUNT(*) AS total FROM caster_listeners l WHERE ${where}`,
      params
    );
    res.json({
      items: rows.map(publicListener),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

casterRouter.get(
  '/listeners/:id',
  requirePermission('caster', 'view'),
  asyncHandler(async (req, res) => {
    const row = await getListenerRow(Number(req.params.id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy listener');
    await assertRecordScope(req, row.owner_web_user_id);
    res.json({
      item: { ...publicListener(row), mountpointIds: await listenerMountpointIds(Number(row.id)) }
    });
  })
);

casterRouter.post(
  '/listeners',
  requirePermission('caster', 'add'),
  asyncHandler(async (req, res) => {
    const body = listenerCreateSchema.parse(req.body);
    const mountpointIds = validateMountpointIds(body.mountpointIds ?? []);
    await assertMountpointsExist(mountpointIds);
    const writable = await writableMountpointIds(req);
    if (writable && mountpointIds.some((mountpointId) => !writable.has(mountpointId))) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    }
    let listenerId: number;
    try {
      listenerId = await withTransaction(async (conn) => {
        const [result] = await conn.query<any>(
          `INSERT INTO caster_listeners
             (name, port, enabled, role, description, owner_web_user_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            body.name,
            body.port,
            body.enabled,
            body.role,
            body.description,
            req.auth!.id,
            req.auth!.id
          ]
        );
        const id = Number(result.insertId);
        for (const mountpointId of mountpointIds) {
          await conn.query(
            'INSERT INTO caster_listener_mountpoints (listener_id, mountpoint_id) VALUES (?, ?)',
            [id, mountpointId]
          );
        }
        return id;
      });
    } catch (err) {
      duplicateGuard(err);
    }
    const row = await getListenerRow(listenerId!);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'create',
      'caster_listener',
      listenerId,
      null,
      row ? publicListener(row) : null,
      ipFrom(req)
    );
    await requestCasterReconcile();
    res.status(201).json({ item: row ? publicListener(row) : null });
  })
);

casterRouter.patch(
  '/listeners/:id',
  requirePermission('caster', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getListenerRow(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy listener');
    await assertRecordScope(req, before.owner_web_user_id);
    const body = listenerUpdateSchema.parse(req.body);
    const mountpointIds =
      body.mountpointIds === undefined ? null : validateMountpointIds(body.mountpointIds);
    if (mountpointIds) {
      await assertMountpointsExist(mountpointIds);
      const writable = await writableMountpointIds(req);
      if (writable && mountpointIds.some((mountpointId) => !writable.has(mountpointId))) {
        throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
      }
    }
    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE caster_listeners
              SET name = ?, port = ?, enabled = ?, role = ?, description = ?
            WHERE id = ?`,
          [
            body.name ?? before.name,
            body.port ?? before.port,
            body.enabled === undefined ? before.enabled : body.enabled,
            body.role ?? before.role,
            body.description ?? before.description,
            id
          ]
        );
        if (mountpointIds) {
          await conn.query('DELETE FROM caster_listener_mountpoints WHERE listener_id = ?', [id]);
          for (const mountpointId of mountpointIds) {
            await conn.query(
              'INSERT INTO caster_listener_mountpoints (listener_id, mountpoint_id) VALUES (?, ?)',
              [id, mountpointId]
            );
          }
        }
      });
    } catch (err) {
      duplicateGuard(err);
    }
    const after = await getListenerRow(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update',
      'caster_listener',
      id,
      publicListener(before),
      after ? publicListener(after) : null,
      ipFrom(req)
    );
    await requestCasterReconcile();
    res.json({ item: after ? publicListener(after) : null });
  })
);

casterRouter.post(
  '/listeners/bulk',
  requireBulkPermission('caster', {
    enable: 'edit',
    disable: 'edit',
    delete: 'delete'
  }),
  asyncHandler(async (req, res) => {
    const body = bulkBodySchema.parse(req.body);
    const ids = uniqueIds(body.ids);
    const rows = await query<RowDataPacket[]>(
      `SELECT id, name, enabled, owner_web_user_id FROM caster_listeners
        WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    const result = emptyBulkResult();
    const allowed: any[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        result.notFound += 1;
        continue;
      }
      try {
        await assertRecordScope(req, row.owner_web_user_id);
        allowed.push(row);
      } catch {
        result.forbidden += 1;
      }
    }
    await withTransaction(async (conn) => {
      for (const row of allowed) {
        if (body.action === 'delete') {
          await conn.query('DELETE FROM caster_listeners WHERE id = ?', [row.id]);
        } else {
          await conn.query('UPDATE caster_listeners SET enabled = ? WHERE id = ?', [
            body.action === 'enable' ? 1 : 0,
            row.id
          ]);
        }
      }
    });
    result.updated = allowed.length;
    if (result.updated > 0) await requestCasterReconcile();
    await writeAudit(
      adminPool,
      req.auth!.id,
      `bulk_${body.action}`,
      'caster_listener',
      `bulk:${ids.length}`,
      null,
      { ids, result },
      ipFrom(req)
    );
    res.json({ result });
  })
);

casterRouter.delete(
  '/listeners/:id',
  requirePermission('caster', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getListenerRow(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy listener');
    await assertRecordScope(req, before.owner_web_user_id);
    await adminPool.query('DELETE FROM caster_listeners WHERE id = ?', [id]);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'delete',
      'caster_listener',
      id,
      publicListener(before),
      null,
      ipFrom(req)
    );
    await requestCasterReconcile();
    res.status(204).send();
  })
);

async function setListenerEnabled(req: Request, enabled: boolean) {
  const id = Number(req.params.id);
  const before = await getListenerRow(id);
  if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy listener');
  await assertRecordScope(req, before.owner_web_user_id);
  await adminPool.query('UPDATE caster_listeners SET enabled = ? WHERE id = ?', [enabled, id]);
  const after = await getListenerRow(id);
  await writeAudit(
    adminPool,
    req.auth!.id,
    enabled ? 'enable' : 'disable',
    'caster_listener',
    id,
    publicListener(before),
    after ? publicListener(after) : null,
    ipFrom(req)
  );
  await requestCasterReconcile();
  return after ? publicListener(after) : null;
}

casterRouter.post(
  '/listeners/:id/enable',
  requirePermission('caster', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setListenerEnabled(req, true) });
  })
);

casterRouter.post(
  '/listeners/:id/disable',
  requirePermission('caster', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setListenerEnabled(req, false) });
  })
);

casterRouter.get(
  '/listeners/:id/mountpoints',
  requirePermission('caster', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const listener = await getListenerRow(id);
    if (!listener) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy listener');
    await assertRecordScope(req, listener.owner_web_user_id);
    const rows = await query<RowDataPacket[]>(
      `SELECT m.id, m.name, m.station_id, s.code AS station_code, s.name AS station_name
         FROM caster_listener_mountpoints lm
         JOIN mountpoints m ON m.id = lm.mountpoint_id
         LEFT JOIN stations s ON s.id = m.station_id
        WHERE lm.listener_id = ? ORDER BY m.name`,
      [id]
    );
    res.json({ items: rows });
  })
);

casterRouter.put(
  '/listeners/:id/mountpoints',
  requirePermission('caster', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const listener = await getListenerRow(id);
    if (!listener) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy listener');
    await assertRecordScope(req, listener.owner_web_user_id);
    const body = listenerMountpointsSchema.parse(req.body);
    const mountpointIds = validateMountpointIds(body.mountpointIds);
    await assertMountpointsExist(mountpointIds);
    const writable = await writableMountpointIds(req);
    if (writable && mountpointIds.some((mountpointId) => !writable.has(mountpointId))) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    }
    const beforeMountpointIds = await listenerMountpointIds(id);
    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM caster_listener_mountpoints WHERE listener_id = ?', [id]);
      for (const mountpointId of mountpointIds) {
        await conn.query(
          'INSERT INTO caster_listener_mountpoints (listener_id, mountpoint_id) VALUES (?, ?)',
          [id, mountpointId]
        );
      }
    });
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update_mountpoints',
      'caster_listener',
      id,
      { mountpointIds: beforeMountpointIds },
      { mountpointIds },
      ipFrom(req)
    );
    await requestCasterReconcile();
    res.json({ ok: true, mountpointIds });
  })
);

async function listConnections(req: Request, res: any): Promise<void> {
  const { pageSize, offset } = pageFrom(req);
  const q = String(req.query.q || '').trim().toLowerCase();
  const allowed = await writableMountpointIds(req);
  const connections = (await fetchConnections()).filter((item) =>
    allowed === null ? true : allowed.has(Number(item.mountpointId))
  );

  const listenerIds = [...new Set(connections.map((item) => Number(item.listenerId)))];
  const mountpointIds = [...new Set(connections.map((item) => Number(item.mountpointId)))];
  const accountIds = [
    ...new Set(
      connections
        .map((item) => item.accountId)
        .filter((id): id is number => id !== null && id !== undefined)
        .map(Number)
    )
  ];

  const listenerNames = new Map<number, string>();
  if (listenerIds.length > 0) {
    const [rows] = await adminPool.query<any[]>(
      `SELECT id, name FROM caster_listeners WHERE id IN (${listenerIds.map(() => '?').join(',')})`,
      listenerIds
    );
    for (const row of rows) listenerNames.set(Number(row.id), String(row.name));
  }
  const mountpointNames = new Map<number, string>();
  if (mountpointIds.length > 0) {
    const [rows] = await adminPool.query<any[]>(
      `SELECT id, name FROM mountpoints WHERE id IN (${mountpointIds.map(() => '?').join(',')})`,
      mountpointIds
    );
    for (const row of rows) mountpointNames.set(Number(row.id), String(row.name));
  }
  const accountNames = new Map<number, string>();
  if (accountIds.length > 0) {
    const [rows] = await adminPool.query<any[]>(
      `SELECT id, username FROM ntrip_accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
      accountIds
    );
    for (const row of rows) accountNames.set(Number(row.id), String(row.username));
  }

  let items = connections.map((item) =>
    publicConnection(
      item,
      listenerNames.get(Number(item.listenerId)),
      mountpointNames.get(Number(item.mountpointId)),
      item.accountId === null ? undefined : accountNames.get(Number(item.accountId))
    )
  );
  if (q) {
    items = items.filter((item) =>
      [item.remoteAddr, item.userAgent, item.mountpointName, item.listenerName, item.accountUsername]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  res.json({
    items: items.slice(offset, offset + pageSize),
    total: items.length,
    pageSize,
    offset
  });
}

async function deleteConnection(req: Request, res: any): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id === 0) {
    throw new ApiError(400, 'INVALID_ID', 'Mã kết nối không hợp lệ');
  }
  const connections = await fetchConnections();
  const target = connections.find((item) => Number(item.id) === id);
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy kết nối');

  const rows = await query<RowDataPacket[]>(
    'SELECT owner_web_user_id FROM mountpoints WHERE id = ?',
    [target.mountpointId]
  );
  if (rows.length === 0) {
    if (req.permissionScope !== 'all') {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy kết nối');
    }
  } else {
    await assertRecordScope(req, rows[0].owner_web_user_id);
  }

  const result = await callGoInternal<{ ok: boolean; found: boolean }>(
    '/internal/caster/disconnect',
    { connectionId: id }
  );
  if (!result?.found) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy kết nối');

  await writeAudit(
    adminPool,
    req.auth!.id,
    'disconnect',
    'caster_connection',
    id,
    target,
    null,
    ipFrom(req)
  );
  res.status(204).send();
}

casterRouter.get(
  '/connections',
  requirePermission('connections', 'view'),
  asyncHandler(listConnections)
);
casterRouter.delete(
  '/connections/:id',
  requirePermission('connections', 'delete'),
  asyncHandler(deleteConnection)
);

casterConnectionsRouter.get(
  '/',
  requirePermission('connections', 'view'),
  asyncHandler(listConnections)
);
casterConnectionsRouter.delete(
  '/:id',
  requirePermission('connections', 'delete'),
  asyncHandler(deleteConnection)
);
