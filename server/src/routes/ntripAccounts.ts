import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { bulkBodySchema, emptyBulkResult, uniqueIds } from '../lib/bulk';
import { asyncHandler, ApiError } from '../lib/http';
import { hashPassword } from '../lib/password';
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

export const ntripAccountsRouter = Router();
ntripAccountsRouter.use(requireAuth);
ntripAccountsRouter.use(csrfProtection);

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
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, owner_web_user_id FROM ${table}
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  if (rows.length !== ids.length) throw new ApiError(400, 'INVALID_ACL', 'ACL không tồn tại');
  for (const row of rows) await assertRecordScope(req, row.owner_web_user_id);
}

async function listenerIdsFor(accountId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    'SELECT listener_id FROM account_listener_acl WHERE account_id = ? ORDER BY listener_id',
    [accountId]
  );
  return rows.map((row) => Number(row.listener_id));
}

async function effectiveMountpoints(accountId: number): Promise<RowDataPacket[]> {
  const listeners = await listenerIdsFor(accountId);
  if (listeners.length === 0) {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

async function getAccount(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM ntrip_accounts WHERE id = ?', [id]);
  return rows[0] ?? null;
}

async function assertAccountScope(req: any, id: number): Promise<RowDataPacket> {
  const account = await getAccount(id);
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản NTRIP');
  await assertRecordScope(req, account.owner_web_user_id);
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
    const scope = listScope(req, ids, 'a.owner_web_user_id');
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
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT a.* FROM ntrip_accounts a WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
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
        listenerIds: await listenerIdsFor(account.id),
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
    const listenerIds = await listenerIdsFor(account.id);
    const listeners = listenerIds.length
      ? await query<RowDataPacket[]>(
          `SELECT id, name, port, enabled FROM caster_listeners
            WHERE id IN (${listenerIds.map(() => '?').join(',')}) ORDER BY name`,
          listenerIds
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
    const body = listenerAclSchema.parse(req.body);
    const ids = [...new Set(body.listenerIds)];
    if (ids.length > 0) {
      const rows = await query<RowDataPacket[]>(
        `SELECT id, owner_web_user_id FROM caster_listeners
          WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      if (rows.length !== ids.length) {
        throw new ApiError(400, 'INVALID_LISTENER', 'Listener không tồn tại');
      }
      for (const row of rows) {
        await assertRecordScope(req, row.owner_web_user_id);
      }
    }
    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM account_listener_acl WHERE account_id = ?', [account.id]);
      for (const listenerId of ids) {
        await conn.query(
          'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
          [account.id, listenerId]
        );
      }
    });
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
    const body = aclSchema.parse(req.body);
    const uniqueIds = [...new Set(body.mountpointIds)];
    if (uniqueIds.length > 0) {
      const rows = await query<RowDataPacket[]>(
        `SELECT id, owner_web_user_id FROM mountpoints WHERE id IN (${uniqueIds.map(() => '?').join(',')})`,
        uniqueIds
      );
      if (rows.length !== uniqueIds.length) {
        throw new ApiError(400, 'INVALID_MOUNTPOINT', 'Mountpoint không tồn tại');
      }
      for (const row of rows) {
        await assertRecordScope(req, row.owner_web_user_id);
      }
    }
    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM account_mountpoint_acl WHERE account_id = ?', [account.id]);
      for (const mountpointId of uniqueIds) {
        await conn.query(
          'INSERT INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
          [account.id, mountpointId]
        );
      }
    });
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
    await assertScopedIds(req, 'caster_listeners', [...new Set(body.listenerIds ?? [])]);
    await assertScopedIds(req, 'mountpoints', [...new Set(body.mountpointIds ?? [])]);
    const ownerId = await resolveOwner(req, body.owner_web_user_id);
    const passwordHash = await hashPassword(body.password);
    let accountId: number;
    try {
      accountId = await withTransaction(async (conn) => {
        const [result]: any = await conn.query(
          `INSERT INTO ntrip_accounts
             (username, password_hash, enabled, max_connections,
              company, contact_name, email, phone, valid_from, valid_to,
              available_area, auth_method, notes, owner_web_user_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            body.username, passwordHash, body.enabled, body.max_connections,
            body.company ?? '', body.contact_name ?? '', body.email ?? '', body.phone ?? '',
            body.valid_from ?? null, body.valid_to ?? null, body.available_area ?? '',
            body.auth_method ?? 'basic', body.notes ?? '', ownerId, req.auth!.id
          ]
        );
        const id = Number(result.insertId);
        for (const listenerId of [...new Set(body.listenerIds ?? [])]) {
          await conn.query(
            'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
            [id, listenerId]
          );
        }
        for (const mountpointId of [...new Set(body.mountpointIds ?? [])]) {
          await conn.query(
            'INSERT INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
            [id, mountpointId]
          );
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
    if (body.listenerIds !== undefined) {
      await assertScopedIds(req, 'caster_listeners', [...new Set(body.listenerIds)]);
    }
    if (body.mountpointIds !== undefined) {
      await assertScopedIds(req, 'mountpoints', [...new Set(body.mountpointIds)]);
    }
    const ownerId =
      body.owner_web_user_id === undefined
        ? Number(before.owner_web_user_id)
        : await resolveOwner(req, body.owner_web_user_id);
    const passwordHash = body.password ? await hashPassword(body.password) : before.password_hash;
    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE ntrip_accounts
              SET username = ?, password_hash = ?, enabled = ?, max_connections = ?,
                  company = ?, contact_name = ?, email = ?, phone = ?,
                  valid_from = ?, valid_to = ?, available_area = ?, auth_method = ?, notes = ?,
                  owner_web_user_id = ?
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
            id
          ]
        );
        if (body.listenerIds !== undefined) {
          await conn.query('DELETE FROM account_listener_acl WHERE account_id = ?', [id]);
          for (const listenerId of [...new Set(body.listenerIds)]) {
            await conn.query(
              'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
              [id, listenerId]
            );
          }
        }
        if (body.mountpointIds !== undefined) {
          await conn.query('DELETE FROM account_mountpoint_acl WHERE account_id = ?', [id]);
          for (const mountpointId of [...new Set(body.mountpointIds)]) {
            await conn.query(
              'INSERT INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
              [id, mountpointId]
            );
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
      `SELECT id, username, enabled, owner_web_user_id FROM ntrip_accounts
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
