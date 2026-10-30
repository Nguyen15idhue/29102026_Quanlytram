import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { hashPassword } from '../lib/password';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { assertRecordScope, ipFrom, listScope, pageFrom, scopeIdsFor } from '../rbac/access';

export const ntripAccountsRouter = Router();
ntripAccountsRouter.use(requireAuth);
ntripAccountsRouter.use(csrfProtection);

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(8).max(200),
  enabled: z.boolean().optional().default(true),
  max_connections: z.number().int().min(1).max(1000).optional().default(1),
  owner_web_user_id: z.number().int().positive().nullable().optional()
});

const updateSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  password: z.string().min(8).max(200).optional(),
  enabled: z.boolean().optional(),
  max_connections: z.number().int().min(1).max(1000).optional(),
  owner_web_user_id: z.number().int().positive().nullable().optional()
});

const aclSchema = z.object({
  mountpointIds: z.array(z.number().int().positive()).max(1000)
});

function publicAccount(row: RowDataPacket) {
  return {
    id: Number(row.id),
    username: String(row.username),
    enabled: Boolean(row.enabled),
    maxConnections: Number(row.max_connections),
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
      where += ' AND a.username LIKE ?';
      params.push(`%${q}%`);
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
    res.json({ item: publicAccount(account) });
  })
);

ntripAccountsRouter.get(
  '/:id/mountpoints',
  requirePermission('ntrip_accounts', 'view'),
  asyncHandler(async (req, res) => {
    const account = await assertAccountScope(req, Number(req.params.id));
    const rows = await query<RowDataPacket[]>(
      `SELECT m.id, m.name, m.station_id, s.code AS station_code, s.name AS station_name
         FROM account_mountpoint_acl acl
         JOIN mountpoints m ON m.id = acl.mountpoint_id
         LEFT JOIN stations s ON s.id = m.station_id
        WHERE acl.account_id = ? ORDER BY m.name`,
      [account.id]
    );
    res.json({ items: rows });
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
    const ownerId = await resolveOwner(req, body.owner_web_user_id);
    const passwordHash = await hashPassword(body.password);
    let accountId: number;
    try {
      const [result]: any = await adminPool.query(
        `INSERT INTO ntrip_accounts
           (username, password_hash, enabled, max_connections, owner_web_user_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [body.username, passwordHash, body.enabled, body.max_connections, ownerId, req.auth!.id]
      );
      accountId = Number(result.insertId);
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
    const ownerId =
      body.owner_web_user_id === undefined
        ? Number(before.owner_web_user_id)
        : await resolveOwner(req, body.owner_web_user_id);
    const passwordHash = body.password ? await hashPassword(body.password) : before.password_hash;
    try {
      await adminPool.query(
        `UPDATE ntrip_accounts
            SET username = ?, password_hash = ?, enabled = ?, max_connections = ?, owner_web_user_id = ?
          WHERE id = ?`,
        [
          body.username ?? before.username,
          passwordHash,
          body.enabled === undefined ? before.enabled : body.enabled,
          body.max_connections ?? before.max_connections,
          ownerId,
          id
        ]
      );
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
