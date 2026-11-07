import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { bulkBodySchema, emptyBulkResult, uniqueIds } from '../lib/bulk';
import { asyncHandler, ApiError } from '../lib/http';
import { hashPassword } from '../lib/password';
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
  resolveWriteOwnership,
  scopeIdsFor
} from '../rbac/access';

export const ntripAccountsRouter = Router();
ntripAccountsRouter.use(requireAuth);
ntripAccountsRouter.use(csrfProtection);

async function requestCasterReconcile(): Promise<void> {
  const result = await reconcileAffected({ caster: true });
  if (!result.ok) {
    console.warn('[ntrip-accounts] reconcile failed', result.errors.join('; '));
  }
}

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(8).max(200),
  enabled: z.boolean().optional().default(true),
  max_connections: z.number().int().min(1).max(1000).optional().default(1),
  company: z.string().max(160).optional(),
  contact_name: z.string().max(120).optional(),
  email: z.string().max(190).optional(),
  phone: z.string().max(40).optional(),
  valid_from: z.string().datetime().nullable().optional(),
  valid_to: z.string().datetime().nullable().optional(),
  available_area: z.string().max(255).optional(),
  auth_method: z.string().max(32).optional(),
  notes: z.string().max(500).optional(),
  owner_web_user_id: z.number().int().positive().nullable().optional(),
  company_id: z.number().int().positive().nullable().optional(),
  listener_all: z.boolean().optional().default(true),
  mountpoint_all: z.boolean().optional().default(true),
  listenerIds: z.array(z.number().int().positive()).max(200).optional(),
  mountpointIds: z.array(z.number().int().positive()).max(1000).optional()
});

const updateSchema = createSchema.partial();

const aclSchema = z.object({
  mountpointIds: z.array(z.number().int().positive()).max(1000)
});

const listenerAclSchema = z.object({
  listenerIds: z.array(z.number().int().positive()).max(200)
});

async function assertScopedIds(
  req: any,
  table: 'caster_listeners' | 'mountpoints',
  ids: number[],
  companyId?: number | null
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, owner_web_user_id, company_id FROM ${table}
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  if (rows.length !== ids.length) throw new ApiError(400, 'INVALID_ACL', 'ACL không tồn tại');
  for (const row of rows) {
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    if (
      companyId !== undefined &&
      companyId !== null &&
      (row.company_id === null || Number(row.company_id) !== companyId)
    ) {
      throw new ApiError(400, 'CROSS_COMPANY_ACL', 'ACL phải cùng công ty với tài khoản');
    }
  }
}

async function assertAllFlags(
  req: any,
  listenerAll: boolean | undefined,
  mountpointAll: boolean | undefined,
  listenerIds: number[] | undefined,
  mountpointIds: number[] | undefined
): Promise<void> {
  // user (own) không được đặt “Tất cả” (D18-6/D18-7).
  if (req.permissionScope === 'own' && (listenerAll === true || mountpointAll === true)) {
    throw new ApiError(403, 'FORBIDDEN', 'Tài khoản của bạn không được dùng chế độ “Tất cả”');
  }
  if (listenerAll === false && (!listenerIds || listenerIds.length === 0)) {
    throw new ApiError(400, 'LISTENER_REQUIRED', 'Phải chọn ít nhất 1 listener hoặc bật “Tất cả”');
  }
  if (mountpointAll === false && (!mountpointIds || mountpointIds.length === 0)) {
    throw new ApiError(400, 'MOUNTPOINT_REQUIRED', 'Phải chọn ít nhất 1 mountpoint hoặc bật “Tất cả”');
  }
}

async function listenerIdsFor(accountId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    'SELECT listener_id FROM account_listener_acl WHERE account_id = ? ORDER BY listener_id',
    [accountId]
  );
  return rows.map((row) => Number(row.listener_id));
}

async function accountFlags(accountId: number): Promise<{
  listenerAll: boolean;
  mountpointAll: boolean;
  companyId: number | null;
}> {
  const rows = await query<RowDataPacket[]>(
    'SELECT listener_all, mountpoint_all, company_id FROM ntrip_accounts WHERE id = ? LIMIT 1',
    [accountId]
  );
  const row = rows[0];
  return {
    listenerAll: Number(row?.listener_all ?? 0) === 1,
    mountpointAll: Number(row?.mountpoint_all ?? 0) === 1,
    companyId: row?.company_id === null || row?.company_id === undefined ? null : Number(row.company_id)
  };
}

async function effectiveListenerIds(accountId: number): Promise<number[]> {
  const flags = await accountFlags(accountId);
  if (flags.listenerAll) {
    const rows = await query<RowDataPacket[]>(
      flags.companyId === null
        ? 'SELECT id FROM caster_listeners ORDER BY id'
        : 'SELECT id FROM caster_listeners WHERE company_id = ? ORDER BY id',
      flags.companyId === null ? [] : [flags.companyId]
    );
    return rows.map((row) => Number(row.id));
  }
  return listenerIdsFor(accountId);
}

async function effectiveMountpoints(accountId: number): Promise<RowDataPacket[]> {
  const flags = await accountFlags(accountId);
  if (flags.mountpointAll) {
    const listeners = await effectiveListenerIds(accountId);
    if (flags.listenerAll) {
      // Mọi mountpoint của mọi listener cùng công ty, động.
      return query<RowDataPacket[]>(
        flags.companyId === null
          ? `SELECT m.id, m.name, m.station_id, s.name AS station_name
               FROM mountpoints m LEFT JOIN stations s ON s.id = m.station_id
              ORDER BY m.name`
          : `SELECT m.id, m.name, m.station_id, s.name AS station_name
               FROM mountpoints m LEFT JOIN stations s ON s.id = m.station_id
              WHERE m.company_id = ? ORDER BY m.name`,
        flags.companyId === null ? [] : [flags.companyId]
      );
    }
    if (listeners.length === 0) return [];
    return query<RowDataPacket[]>(
      `SELECT DISTINCT m.id, m.name, m.station_id, s.name AS station_name
         FROM caster_listener_mountpoints lm
         JOIN mountpoints m ON m.id = lm.mountpoint_id
         LEFT JOIN stations s ON s.id = m.station_id
        WHERE lm.listener_id IN (${listeners.map(() => '?').join(',')})
        ORDER BY m.name`,
      listeners
    );
  }
  const listeners = await listenerIdsFor(accountId);
  if (listeners.length === 0) {
    // listener_all=1 + mountpoint tĩnh: giao ACL tĩnh, không lọc listener.
    const flagsOnly = flags;
    if (flagsOnly.listenerAll) {
      return query<RowDataPacket[]>(
        `SELECT m.id, m.name, m.station_id, s.name AS station_name
           FROM account_mountpoint_acl acl
           JOIN mountpoints m ON m.id = acl.mountpoint_id
           LEFT JOIN stations s ON s.id = m.station_id
          WHERE acl.account_id = ? ORDER BY m.name`,
        [accountId]
      );
    }
    return query<RowDataPacket[]>(
      `SELECT m.id, m.name, m.station_id, s.name AS station_name
         FROM account_mountpoint_acl acl
         JOIN mountpoints m ON m.id = acl.mountpoint_id
         LEFT JOIN stations s ON s.id = m.station_id
        WHERE acl.account_id = ? ORDER BY m.name`,
      [accountId]
    );
  }
  return query<RowDataPacket[]>(
    `SELECT DISTINCT m.id, m.name, m.station_id, s.name AS station_name
       FROM account_mountpoint_acl acl
       JOIN mountpoints m ON m.id = acl.mountpoint_id
       JOIN caster_listener_mountpoints lm ON lm.mountpoint_id = m.id
       LEFT JOIN stations s ON s.id = m.station_id
      WHERE acl.account_id = ?
        AND lm.listener_id IN (${listeners.map(() => '?').join(',')})
      ORDER BY m.name`,
    [accountId, ...listeners]
  );
}

function publicAccount(row: RowDataPacket) {
  return {
    id: Number(row.id),
    username: String(row.username),
    enabled: Boolean(row.enabled),
    maxConnections: Number(row.max_connections),
    company: String(row.company ?? ''),
    contactName: String(row.contact_name ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    validFrom: row.valid_from ?? null,
    validTo: row.valid_to ?? null,
    availableArea: String(row.available_area ?? ''),
    notes: String(row.notes ?? ''),
    ownerWebUserId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
    ownerName: row.owner_name ?? null,
    companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
    companyName: row.company_name ?? null,
    listenerAll: Number(row.listener_all ?? 1) === 1,
    mountpointAll: Number(row.mountpoint_all ?? 1) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getAccount(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT a.*, u.display_name AS owner_name, c.name AS company_name
       FROM ntrip_accounts a
       LEFT JOIN web_users u ON u.id = a.owner_web_user_id
       LEFT JOIN companies c ON c.id = a.company_id
      WHERE a.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

async function assertAccountScope(req: any, id: number): Promise<RowDataPacket> {
  const account = await getAccount(id);
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản NTRIP');
  await assertRecordScope(req, account.owner_web_user_id, 'owner_web_user_id', account.company_id);
  return account;
}

function duplicateGuard(err: unknown): never {
  if (err && typeof err === 'object' && (err as any).code === 'ER_DUP_ENTRY') {
    throw new ApiError(409, 'DUPLICATE_USERNAME', 'Username NTRIP đã tồn tại');
  }
  throw err;
}

ntripAccountsRouter.get(
  '/',
  requirePermission('ntrip_accounts', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'a.owner_web_user_id', { companyColumn: 'a.company_id' });
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (q) {
      where += ' AND (a.username LIKE ? OR a.company LIKE ? OR a.email LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const enabled = String(req.query.enabled || '').trim();
    if (enabled === '0' || enabled === '1') {
      where += ' AND a.enabled = ?';
      params.push(Number(enabled));
    }
    const ownerId = Number(req.query.ownerId || 0);
    if (Number.isInteger(ownerId) && ownerId > 0) {
      where += ' AND a.owner_web_user_id = ?';
      params.push(ownerId);
    }
    const companyId = Number(req.query.companyId || 0);
    if (req.auth?.roleCode === 'super_admin' && Number.isInteger(companyId) && companyId > 0) {
      where += ' AND a.company_id = ?';
      params.push(companyId);
    }
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT a.*, u.display_name AS owner_name, c.name AS company_name
         FROM ntrip_accounts a
         LEFT JOIN web_users u ON u.id = a.owner_web_user_id
         LEFT JOIN companies c ON c.id = a.company_id
        WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ntrip_accounts a WHERE ${where}`,
      params
    );
    res.json({
      items: rows.map(publicAccount),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

ntripAccountsRouter.get(
  '/:id',
  requirePermission('ntrip_accounts', 'view'),
  asyncHandler(async (req, res) => {
    const account = await assertAccountScope(req, Number(req.params.id));
    res.json({
      item: {
        ...publicAccount(account),
        listenerIds: await effectiveListenerIds(account.id),
        effectiveMountpoints: await effectiveMountpoints(account.id)
      }
    });
  })
);

ntripAccountsRouter.get(
  '/:id/mountpoints',
  requirePermission('ntrip_accounts', 'view'),
  asyncHandler(async (req, res) => {
    const account = await assertAccountScope(req, Number(req.params.id));
    const rows = await effectiveMountpoints(account.id);
    res.json({ items: rows, effectiveMountpoints: rows });
  })
);

ntripAccountsRouter.get(
  '/:id/listeners',
  requirePermission('ntrip_accounts', 'view'),
  asyncHandler(async (req, res) => {
    const account = await assertAccountScope(req, Number(req.params.id));
    const listenerIds = await effectiveListenerIds(account.id);
    const accountCompany =
      account.company_id === null ? null : Number(account.company_id);
    const companyFilter = accountCompany === null ? '' : ' AND company_id = ?';
    const listeners = listenerIds.length
      ? await query<RowDataPacket[]>(
          `SELECT id, name, port, enabled FROM caster_listeners
            WHERE id IN (${listenerIds.map(() => '?').join(',')})${companyFilter} ORDER BY name`,
          accountCompany === null ? listenerIds : [...listenerIds, accountCompany]
        )
      : [];
    res.json({
      listenerIds,
      listeners,
      effectiveMountpoints: await effectiveMountpoints(account.id)
    });
  })
);

ntripAccountsRouter.put(
  '/:id/listeners',
  requirePermission('ntrip_accounts', 'edit'),
  asyncHandler(async (req, res) => {
    const account = await assertAccountScope(req, Number(req.params.id));
    const flags = await accountFlags(Number(account.id));
    if (flags.listenerAll) {
      throw new ApiError(
        400,
        'LISTENER_ALL_ENABLED',
        'Tài khoản đang dùng “Tất cả listener”; tắt chế độ này trước khi gán lẻ'
      );
    }
    const body = listenerAclSchema.parse(req.body);
    const ids = [...new Set(body.listenerIds)];
    await assertScopedIds(
      req,
      'caster_listeners',
      ids,
      account.company_id === null ? null : Number(account.company_id)
    );
    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM account_listener_acl WHERE account_id = ?', [account.id]);
      for (const listenerId of ids) {
        await conn.query(
          'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
          [account.id, listenerId]
        );
      }
    });
    await requestCasterReconcile();
    publishEntityChange({ entity: 'ntrip_account', id: account.id, action: 'update_listener_acl' });
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update_listener_acl',
      'ntrip_account',
      account.id,
      null,
      { listenerIds: ids },
      ipFrom(req)
    );
    res.json({
      listenerIds: ids,
      effectiveMountpoints: await effectiveMountpoints(account.id)
    });
  })
);

ntripAccountsRouter.put(
  '/:id/mountpoints',
  requirePermission('ntrip_accounts', 'edit'),
  asyncHandler(async (req, res) => {
    const account = await assertAccountScope(req, Number(req.params.id));
    const flags = await accountFlags(Number(account.id));
    if (flags.mountpointAll) {
      throw new ApiError(
        400,
        'MOUNTPOINT_ALL_ENABLED',
        'Tài khoản đang dùng “Tất cả mountpoint”; tắt chế độ này trước khi gán lẻ'
      );
    }
    const body = aclSchema.parse(req.body);
    const uniqueIds = [...new Set(body.mountpointIds)];
    await assertScopedIds(
      req,
      'mountpoints',
      uniqueIds,
      account.company_id === null ? null : Number(account.company_id)
    );
    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM account_mountpoint_acl WHERE account_id = ?', [account.id]);
      for (const mountpointId of uniqueIds) {
        await conn.query(
          'INSERT INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
          [account.id, mountpointId]
        );
      }
    });
    await requestCasterReconcile();
    publishEntityChange({ entity: 'ntrip_account', id: account.id, action: 'update_acl' });
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update_acl',
      'ntrip_account',
      account.id,
      null,
      { mountpointIds: uniqueIds },
      ipFrom(req)
    );
    res.json({ ok: true, mountpointIds: uniqueIds });
  })
);

ntripAccountsRouter.post(
  '/',
  requirePermission('ntrip_accounts', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const listenerAll = body.listener_all ?? true;
    const mountpointAll = body.mountpoint_all ?? true;
    const listenerIds = [...new Set(body.listenerIds ?? [])];
    const mountpointIds = [...new Set(body.mountpointIds ?? [])];
    await assertAllFlags(req, listenerAll, mountpointAll, listenerIds, mountpointIds);
    const ownership = await resolveWriteOwnership(req, body.owner_web_user_id, body.company_id);
    const ownerId = ownership.ownerId;
    const companyId = ownership.companyId;
    await assertScopedIds(
      req,
      'caster_listeners',
      listenerAll ? [] : listenerIds,
      companyId
    );
    await assertScopedIds(req, 'mountpoints', mountpointAll ? [] : mountpointIds, companyId);
    const passwordHash = await hashPassword(body.password);
    let accountId: number;
    try {
      accountId = await withTransaction(async (conn) => {
        const [result]: any = await conn.query(
          `INSERT INTO ntrip_accounts
             (username, password_hash, enabled, max_connections,
              company, contact_name, email, phone, valid_from, valid_to,
              available_area, auth_method, notes, owner_web_user_id, company_id, created_by,
              listener_all, mountpoint_all)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            body.username, passwordHash, body.enabled, body.max_connections,
            body.company ?? '', body.contact_name ?? '', body.email ?? '', body.phone ?? '',
            body.valid_from ?? null, body.valid_to ?? null, body.available_area ?? '',
            body.auth_method ?? 'basic', body.notes ?? '', ownerId, companyId, req.auth!.id,
            listenerAll ? 1 : 0, mountpointAll ? 1 : 0
          ]
        );
        const id = Number(result.insertId);
        if (!listenerAll) {
          for (const listenerId of listenerIds) {
            await conn.query(
              'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
              [id, listenerId]
            );
          }
        }
        if (!mountpointAll) {
          for (const mountpointId of mountpointIds) {
            await conn.query(
              'INSERT INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
              [id, mountpointId]
            );
          }
        }
        return id;
      });
    } catch (err) {
      duplicateGuard(err);
    }
    const account = await getAccount(accountId);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'create',
      'ntrip_account',
      accountId,
      null,
      account ? publicAccount(account) : null,
      ipFrom(req)
    );
    await requestCasterReconcile();
    publishEntityChange({ entity: 'ntrip_account', id: accountId, action: 'create' });
    res.status(201).json({ item: account ? publicAccount(account) : null });
  })
);

ntripAccountsRouter.patch(
  '/:id',
  requirePermission('ntrip_accounts', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await assertAccountScope(req, id);
    const body = updateSchema.parse(req.body);
    if (
      body.company_id !== undefined &&
      Number(body.company_id) !== (before.company_id === null ? null : Number(before.company_id))
    ) {
      throw new ApiError(400, 'COMPANY_IMMUTABLE', 'Không được đổi công ty của tài khoản NTRIP');
    }
    if (body.username !== undefined && body.username !== before.username) {
      throw new ApiError(409, 'IMMUTABLE_FIELD', 'Username NTRIP không thể sửa sau khi tạo');
    }
    let ownerId = Number(before.owner_web_user_id);
    let companyId = before.company_id === null ? null : Number(before.company_id);
    if (body.owner_web_user_id !== undefined) {
      const ownership = await resolveWriteOwnership(req, body.owner_web_user_id, companyId);
      ownerId = ownership.ownerId;
      companyId = ownership.companyId;
    }
    const beforeListenerAll = Number(before.listener_all ?? 1) === 1;
    const beforeMountpointAll = Number(before.mountpoint_all ?? 1) === 1;
    const nextListenerAll = body.listener_all ?? beforeListenerAll;
    const nextMountpointAll = body.mountpoint_all ?? beforeMountpointAll;
    const nextListenerIds =
      body.listenerIds !== undefined ? [...new Set(body.listenerIds)] : undefined;
    const nextMountpointIds =
      body.mountpointIds !== undefined ? [...new Set(body.mountpointIds)] : undefined;
    // Khi bật “Tất cả” thì bỏ qua ids; khi tắt thì bắt buộc có ids (mới hoặc cũ).
    const effectiveListenerIdsForCheck =
      nextListenerAll ? [0] : (nextListenerIds ?? (beforeListenerAll ? [] : await listenerIdsFor(id)));
    const effectiveMountpointRows = nextMountpointAll
      ? [0]
      : (nextMountpointIds ??
        (beforeMountpointAll
          ? []
          : (await query<RowDataPacket[]>(
              'SELECT mountpoint_id FROM account_mountpoint_acl WHERE account_id = ?',
              [id]
            )).map((row) => Number(row.mountpoint_id))));
    await assertAllFlags(
      req,
      body.listener_all,
      body.mountpoint_all,
      effectiveListenerIdsForCheck,
      effectiveMountpointRows
    );
    if (nextListenerIds !== undefined && !nextListenerAll) {
      await assertScopedIds(req, 'caster_listeners', nextListenerIds, companyId);
    }
    if (nextMountpointIds !== undefined && !nextMountpointAll) {
      await assertScopedIds(req, 'mountpoints', nextMountpointIds, companyId);
    }
    const passwordHash = body.password ? await hashPassword(body.password) : before.password_hash;
    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE ntrip_accounts
              SET username = ?, password_hash = ?, enabled = ?, max_connections = ?,
                  company = ?, contact_name = ?, email = ?, phone = ?,
                  valid_from = ?, valid_to = ?, available_area = ?, auth_method = ?, notes = ?,
                  owner_web_user_id = ?, company_id = ?, listener_all = ?, mountpoint_all = ?
            WHERE id = ?`,
          [
            body.username ?? before.username,
            passwordHash,
            body.enabled === undefined ? before.enabled : body.enabled,
            body.max_connections ?? before.max_connections,
            body.company ?? before.company,
            body.contact_name ?? before.contact_name,
            body.email ?? before.email,
            body.phone ?? before.phone,
            body.valid_from === undefined ? before.valid_from : body.valid_from,
            body.valid_to === undefined ? before.valid_to : body.valid_to,
            body.available_area ?? before.available_area,
            body.auth_method ?? before.auth_method,
            body.notes ?? before.notes,
            ownerId,
            companyId,
            nextListenerAll ? 1 : 0,
            nextMountpointAll ? 1 : 0,
            id
          ]
        );
        if (body.listener_all !== undefined || nextListenerIds !== undefined) {
          await conn.query('DELETE FROM account_listener_acl WHERE account_id = ?', [id]);
          if (!nextListenerAll && nextListenerIds !== undefined) {
            for (const listenerId of nextListenerIds) {
              await conn.query(
                'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
                [id, listenerId]
              );
            }
          }
        }
        if (body.mountpoint_all !== undefined || nextMountpointIds !== undefined) {
          await conn.query('DELETE FROM account_mountpoint_acl WHERE account_id = ?', [id]);
          if (!nextMountpointAll && nextMountpointIds !== undefined) {
            for (const mountpointId of nextMountpointIds) {
              await conn.query(
                'INSERT INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
                [id, mountpointId]
              );
            }
          }
        }
      });
    } catch (err) {
      duplicateGuard(err);
    }
    const after = await getAccount(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update',
      'ntrip_account',
      id,
      publicAccount(before),
      after ? publicAccount(after) : null,
      ipFrom(req)
    );
    await requestCasterReconcile();
    publishEntityChange({ entity: 'ntrip_account', id, action: 'update' });
    res.json({ item: after ? publicAccount(after) : null });
  })
);

async function setEnabled(req: any, enabled: boolean) {
  const account = await assertAccountScope(req, Number(req.params.id));
  await adminPool.query('UPDATE ntrip_accounts SET enabled = ? WHERE id = ?', [enabled, account.id]);
  const after = await getAccount(Number(account.id));
  await writeAudit(
    adminPool,
    req.auth!.id,
    enabled ? 'unlock' : 'lock',
    'ntrip_account',
    account.id,
    publicAccount(account),
    after ? publicAccount(after) : null,
    ipFrom(req)
  );
  await requestCasterReconcile();
  publishEntityChange({
    entity: 'ntrip_account',
    id: account.id,
    action: enabled ? 'unlock' : 'lock'
  });
  return after ? publicAccount(after) : null;
}

ntripAccountsRouter.post(
  '/:id/lock',
  requirePermission('ntrip_accounts', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setEnabled(req, false) });
  })
);

ntripAccountsRouter.post(
  '/:id/unlock',
  requirePermission('ntrip_accounts', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setEnabled(req, true) });
  })
);

ntripAccountsRouter.post(
  '/bulk',
  requireBulkPermission('ntrip_accounts', {
    lock: 'edit',
    unlock: 'edit',
    delete: 'delete'
  }),
  asyncHandler(async (req, res) => {
    const body = bulkBodySchema.parse(req.body);
    const ids = uniqueIds(body.ids);
    const rows = await query<RowDataPacket[]>(
      `SELECT id, username, enabled, owner_web_user_id, company_id FROM ntrip_accounts
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
        await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
        allowed.push(row);
      } catch {
        result.forbidden += 1;
      }
    }
    await withTransaction(async (conn) => {
      for (const row of allowed) {
        if (body.action === 'delete') {
          await conn.query('DELETE FROM ntrip_accounts WHERE id = ?', [row.id]);
        } else {
          await conn.query('UPDATE ntrip_accounts SET enabled = ? WHERE id = ?', [
            body.action === 'unlock' ? 1 : 0,
            row.id
          ]);
        }
      }
    });
    result.updated = allowed.length;
    if (result.updated > 0) {
      await requestCasterReconcile();
      publishEntityChange({ entity: 'ntrip_account', id: 'bulk', action: body.action });
    }
    await writeAudit(
      adminPool,
      req.auth!.id,
      `bulk_${body.action}`,
      'ntrip_account',
      `bulk:${ids.length}`,
      null,
      { ids, result },
      ipFrom(req)
    );
    res.json({ result });
  })
);

ntripAccountsRouter.delete(
  '/:id',
  requirePermission('ntrip_accounts', 'delete'),
  asyncHandler(async (req, res) => {
    const account = await assertAccountScope(req, Number(req.params.id));
    await adminPool.query('DELETE FROM ntrip_accounts WHERE id = ?', [account.id]);
    await requestCasterReconcile();
    publishEntityChange({ entity: 'ntrip_account', id: account.id, action: 'delete' });
    await writeAudit(
      adminPool,
      req.auth!.id,
      'delete',
      'ntrip_account',
      account.id,
      publicAccount(account),
      null,
      ipFrom(req)
    );
    res.status(204).send();
  })
);
