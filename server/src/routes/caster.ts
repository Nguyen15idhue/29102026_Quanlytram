import { Router, type Request } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { bulkBodySchema, emptyBulkResult, uniqueIds } from '../lib/bulk';
import {
  GoConnection,
  isAllowedCasterPort,
  isListenerEnabled,
  isReservedCasterPort,
  listenerCreateSchema,
  listenerMountpointsSchema,
  listenerUpdateSchema,
  publicConnection,
  publicListener,
  selectOnlineConnections,
  WALLY_COMPANY_CODE
} from '../lib/caster';
import { asyncHandler, ApiError } from '../lib/http';
import { callGoInternal } from '../lib/internalApi';
import { reconcileAffected } from '../lib/reconcile';
import { publishEntityChange } from '../lib/entityChange';
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
  SELECT l.*, u.display_name AS owner_name, c.name AS company_name,
         (SELECT COUNT(*)
            FROM caster_listener_mountpoints lm
            JOIN mountpoints m ON m.id = lm.mountpoint_id
           WHERE lm.listener_id = l.id
             AND (l.company_id IS NULL OR m.company_id = l.company_id)) AS mountpoint_count
    FROM caster_listeners l
    LEFT JOIN web_users u ON u.id = l.owner_web_user_id
    LEFT JOIN companies c ON c.id = l.company_id`;

async function getListenerRow(id: number): Promise<any | null> {
  const [rows] = await adminPool.query<any[]>(`${LISTENER_SELECT} WHERE l.id = ?`, [id]);
  return rows[0] ?? null;
}

function listenerCompanyId(row: any): number | null {
  return row.company_id === null || row.company_id === undefined
    ? null
    : Number(row.company_id);
}

async function resolveListenerCompany(
  req: Request,
  requested?: number | null
): Promise<number> {
  const isSuper = req.auth?.roleCode === 'super_admin';
  if (!isSuper) {
    const actorCompany = req.auth?.companyId;
    if (actorCompany === null || actorCompany === undefined) {
      throw new ApiError(400, 'COMPANY_REQUIRED', 'Tài khoản chưa thuộc công ty');
    }
    if (
      requested !== undefined &&
      requested !== null &&
      Number(requested) !== Number(actorCompany)
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'Không được tạo listener cho công ty khác');
    }
    return Number(actorCompany);
  }
  if (requested === undefined || requested === null) {
    throw new ApiError(400, 'COMPANY_REQUIRED', 'Phải chọn công ty cho listener');
  }
  const rows = await query<RowDataPacket[]>('SELECT id FROM companies WHERE id = ? LIMIT 1', [
    requested
  ]);
  if (rows.length === 0) {
    throw new ApiError(400, 'INVALID_COMPANY', 'Công ty không tồn tại');
  }
  return Number(requested);
}

async function assertPortAllowedForCompany(port: number, companyId: number | null): Promise<void> {
  if (!isAllowedCasterPort(port)) {
    throw new ApiError(
      400,
      'PORT_NOT_ALLOWED',
      'Port phải là 1508, 1509, 2101 hoặc trong dải 1510-1599'
    );
  }
  if (companyId === null) {
    if (isReservedCasterPort(port)) {
      throw new ApiError(400, 'COMPANY_REQUIRED', 'Port Wally phải gán cho công ty Wally');
    }
    return;
  }
  if (!isReservedCasterPort(port)) return;
  const rows = await query<RowDataPacket[]>('SELECT code FROM companies WHERE id = ? LIMIT 1', [
    companyId
  ]);
  if (String(rows[0]?.code ?? '') !== WALLY_COMPANY_CODE) {
    throw new ApiError(400, 'PORT_RESERVED', '1508/1509/2101 chỉ dành cho công ty Wally');
  }
}

async function assertMountpointsSameCompany(
  ids: number[],
  companyId: number | null
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, company_id FROM mountpoints WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  if (rows.length !== ids.length) {
    throw new ApiError(400, 'INVALID_MOUNTPOINT', 'Mountpoint không tồn tại');
  }
  if (companyId === null) return;
  if (rows.some((row) => row.company_id !== null && Number(row.company_id) !== companyId)) {
    throw new ApiError(400, 'CROSS_COMPANY_MOUNTPOINT', 'Mountpoint phải cùng công ty với listener');
  }
}

async function listenerMountpointIds(id: number, req?: Request): Promise<number[]> {
  if (req && req.auth?.roleCode !== 'super_admin') {
    if (req.auth?.companyId === null || req.auth?.companyId === undefined) return [];
    const rows = await query<RowDataPacket[]>(
      `SELECT lm.mountpoint_id
         FROM caster_listener_mountpoints lm
         JOIN mountpoints m ON m.id = lm.mountpoint_id
        WHERE lm.listener_id = ? AND (m.company_id = ? OR m.company_id IS NULL)
        ORDER BY lm.mountpoint_id`,
      [id, Number(req.auth.companyId)]
    );
    return rows.map((row) => Number(row.mountpoint_id));
  }
  const rows = await query<RowDataPacket[]>(
    'SELECT mountpoint_id FROM caster_listener_mountpoints WHERE listener_id = ? ORDER BY mountpoint_id',
    [id]
  );
  return rows.map((row) => Number(row.mountpoint_id));
}

async function requestCasterReconcile(): Promise<void> {
  const result = await reconcileAffected({ caster: true });
  if (!result.ok) {
    console.warn('[caster] reconcile failed', result.errors.join('; '));
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
    const scope = listScope(req, ids, 'l.owner_web_user_id', {
      companyColumn: 'l.company_id'
    });
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (q) {
      where += ' AND (l.name LIKE ? OR l.description LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    const companyFilter = Number(req.query.companyId || 0);
    if (req.auth?.roleCode === 'super_admin' && Number.isInteger(companyFilter) && companyFilter > 0) {
      where += ' AND l.company_id = ?';
      params.push(companyFilter);
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
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', listenerCompanyId(row));
    res.json({
      item: { ...publicListener(row), mountpointIds: await listenerMountpointIds(Number(row.id), req) }
    });
  })
);

casterRouter.post(
  '/listeners',
  requirePermission('caster', 'add'),
  asyncHandler(async (req, res) => {
    const body = listenerCreateSchema.parse(req.body);
    const companyId = await resolveListenerCompany(req, body.company_id);
    await assertPortAllowedForCompany(body.port, companyId);
    const mountpointIds = validateMountpointIds(body.mountpointIds ?? []);
    await assertMountpointsSameCompany(mountpointIds, companyId);
    const writable = await writableMountpointIds(req);
    if (writable && mountpointIds.some((mountpointId) => !writable.has(mountpointId))) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    }
    let listenerId: number;
    try {
      listenerId = await withTransaction(async (conn) => {
        const [result] = await conn.query<any>(
          `INSERT INTO caster_listeners
             (name, port, enabled, role, description, owner_web_user_id, company_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            body.name,
            body.port,
            body.enabled,
            body.role,
            body.description,
            req.auth!.id,
            companyId,
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
    publishEntityChange({ entity: 'listener', id: listenerId!, action: 'create' });
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
    await assertRecordScope(
      req,
      before.owner_web_user_id,
      'owner_web_user_id',
      listenerCompanyId(before)
    );
    const body = listenerUpdateSchema.parse(req.body);
    const isSuper = req.auth!.roleCode === 'super_admin';
    if (!isSuper) {
      if (body.port !== undefined && Number(body.port) !== Number(before.port)) {
        console.warn(
          `[caster] từ chối đổi port listener ${id} bởi user ${req.auth!.id}: ${before.port} -> ${body.port}`
        );
        throw new ApiError(
          400,
          'IMMUTABLE_FIELD',
          'Công ty không được đổi port của listener; liên hệ super admin'
        );
      }
      if (
        body.company_id !== undefined &&
        (body.company_id === null ? null : Number(body.company_id)) !== listenerCompanyId(before)
      ) {
        console.warn(
          `[caster] từ chối đổi công ty listener ${id} bởi user ${req.auth!.id}`
        );
        throw new ApiError(400, 'COMPANY_IMMUTABLE', 'Không được đổi công ty của listener');
      }
    }
    let companyId = listenerCompanyId(before);
    if (body.company_id !== undefined) {
      if (companyId !== null && Number(body.company_id) !== companyId) {
        throw new ApiError(400, 'COMPANY_IMMUTABLE', 'Không được đổi công ty của listener');
      }
      if (companyId === null) {
        if (body.company_id === null) {
          throw new ApiError(400, 'COMPANY_REQUIRED', 'Phải chọn công ty cho listener');
        }
        companyId = await resolveListenerCompany(req, body.company_id);
        const [mapped] = await adminPool.query<any[]>(
          `SELECT m.company_id
             FROM caster_listener_mountpoints lm
             JOIN mountpoints m ON m.id = lm.mountpoint_id
            WHERE lm.listener_id = ?`,
          [id]
        );
        if (mapped.some((row) => Number(row.company_id) !== companyId)) {
          throw new ApiError(
            400,
            'CROSS_COMPANY_MOUNTPOINT',
            'Listener còn mountpoint khác công ty; gỡ trước khi gán công ty'
          );
        }
      }
    }
    const port = body.port ?? Number(before.port);
    await assertPortAllowedForCompany(port, companyId);
    const mountpointIds =
      body.mountpointIds === undefined ? null : validateMountpointIds(body.mountpointIds);
    if (mountpointIds) {
      await assertMountpointsSameCompany(mountpointIds, companyId);
      // Admin công ty được gắn mountpoint của người khác trong cùng công ty
      // (D18-5); phạm vi công ty đã được kiểm tra ở trên.
    }
    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE caster_listeners
              SET name = ?, port = ?, enabled = ?, role = ?, description = ?, company_id = ?
            WHERE id = ?`,
          [
            body.name ?? before.name,
            port,
            body.enabled === undefined ? before.enabled : body.enabled,
            body.role ?? before.role,
            body.description ?? before.description,
            companyId,
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
    publishEntityChange({ entity: 'listener', id, action: 'update' });
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
      `SELECT id, name, enabled, owner_web_user_id, company_id FROM caster_listeners
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
        await assertRecordScope(
          req,
          row.owner_web_user_id,
          'owner_web_user_id',
          listenerCompanyId(row)
        );
        allowed.push(row);
      } catch {
        result.forbidden += 1;
      }
    }
    const deletable =
      body.action === 'delete' ? allowed.filter((row) => !isListenerEnabled(row)) : allowed;
    if (body.action === 'delete') {
      result.skipped += allowed.length - deletable.length;
    }
    await withTransaction(async (conn) => {
      for (const row of deletable) {
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
    result.updated = deletable.length;
    if (result.updated > 0) {
      await requestCasterReconcile();
      publishEntityChange({ entity: 'listener', id: 'bulk', action: body.action });
    }
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
    await assertRecordScope(
      req,
      before.owner_web_user_id,
      'owner_web_user_id',
      listenerCompanyId(before)
    );
    if (isListenerEnabled(before)) {
      throw new ApiError(
        409,
        'LISTENER_ENABLED',
        'Listener đang bật. Tắt listener trước khi xóa.'
      );
    }
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
    publishEntityChange({ entity: 'listener', id, action: 'delete' });
    res.status(204).send();
  })
);

async function setListenerEnabled(req: Request, enabled: boolean) {
  const id = Number(req.params.id);
  const before = await getListenerRow(id);
  if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy listener');
  await assertRecordScope(
    req,
    before.owner_web_user_id,
    'owner_web_user_id',
    listenerCompanyId(before)
  );
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
  publishEntityChange({
    entity: 'listener',
    id,
    action: enabled ? 'enable' : 'disable'
  });
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
    const companyId = listenerCompanyId(listener);
    await assertRecordScope(req, listener.owner_web_user_id, 'owner_web_user_id', companyId);
    const companyFilter = companyId === null ? '' : ' AND (m.company_id = ? OR m.company_id IS NULL)';
    const params: unknown[] = companyId === null ? [id] : [id, companyId];
    const rows = await query<RowDataPacket[]>(
      `SELECT m.id, m.name, m.station_id, s.name AS station_name
         FROM caster_listener_mountpoints lm
         JOIN mountpoints m ON m.id = lm.mountpoint_id
         LEFT JOIN stations s ON s.id = m.station_id
        WHERE lm.listener_id = ?${companyFilter} ORDER BY m.name`,
      params
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
    const companyId = listenerCompanyId(listener);
    await assertRecordScope(req, listener.owner_web_user_id, 'owner_web_user_id', companyId);
    const body = listenerMountpointsSchema.parse(req.body);
    const mountpointIds = validateMountpointIds(body.mountpointIds);
    await assertMountpointsSameCompany(mountpointIds, companyId);
    // Chỉ admin công ty (caster.edit = tenant) gọi được route này; mountpoint
    // cùng công ty là đủ, không giới hạn theo owner cá nhân (D18-5).
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
    publishEntityChange({ entity: 'listener', id, action: 'update_mountpoints' });
    res.json({ ok: true, mountpointIds });
  })
);

async function listConnections(req: Request, res: any): Promise<void> {
  const { pageSize, offset } = pageFrom(req);
  const q = String(req.query.q || '').trim().toLowerCase();
  const allowed = await writableMountpointIds(req);
  // Trang "Danh sách online" chỉ dành cho tài khoản NTRIP đã xác thực:
  // direction=rover, có account_id. Nguồn publish (source) thuộc /caster.
  const connections = selectOnlineConnections(await fetchConnections()).filter((item) =>
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

  let items = connections
    .map((item) =>
      publicConnection(
        item,
        listenerNames.get(Number(item.listenerId)),
        mountpointNames.get(Number(item.mountpointId)),
        item.accountId === null ? undefined : accountNames.get(Number(item.accountId))
      )
    )
    // Phòng thủ: account bị xoá giữa lúc kết nối thì loại khỏi danh sách,
    // không hiển thị dòng "Tài khoản = —".
    .filter((item) => item.accountUsername.trim() !== '');
  if (q) {
    items = items.filter((item) =>
      [item.remoteAddr, item.userAgent, item.mountpointName, item.listenerName, item.accountUsername]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  const fix = String(req.query.fix || '').trim();
  if (fix === 'none') {
    items = items.filter((item) => !item.fixType);
  } else if (['fixed', 'float', 'single', 'rtd', 'error'].includes(fix)) {
    items = items.filter((item) => item.fixType === fix);
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
