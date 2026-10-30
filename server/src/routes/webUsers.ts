import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { hashPassword } from '../lib/password';
import { requireAuth, requirePermission, isSuperAdmin } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import {
  assertRecordScope,
  ipFrom,
  listScope,
  pageFrom,
  scopeIdsFor
} from '../rbac/access';
import { canManageRole } from '../rbac/scope';
import { emailField } from '../lib/validation';
import { buildWorkbook, readSheetRows, readWorkbook, sendWorkbook } from '../lib/excel';

export const webUsersRouter = Router();
webUsersRouter.use(requireAuth);
webUsersRouter.use(csrfProtection);

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(8).max(200),
  display_name: z.string().min(1).max(120),
  email: emailField.optional().default(''),
  role_id: z.number().int().positive(),
  parent_user_id: z.number().int().positive().nullable().optional()
});

const updateSchema = z.object({
  display_name: z.string().min(1).max(120).optional(),
  email: emailField.optional(),
  password: z.string().min(8).max(200).optional(),
  role_id: z.number().int().positive().optional(),
  parent_user_id: z.number().int().positive().nullable().optional()
});

function publicUser(row: RowDataPacket) {
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    email: String(row.email),
    status: String(row.status),
    parentUserId: row.parent_user_id === null ? null : Number(row.parent_user_id),
    role: {
      id: Number(row.role_id),
      code: String(row.role_code),
      name: String(row.role_name),
      level: Number(row.role_level)
    },
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
}

async function getUser(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.level AS role_level
       FROM web_users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

async function getRole(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM roles WHERE id = ?', [id]);
  return rows[0] ?? null;
}

async function countSuperAdmins(): Promise<number> {
  const rows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM web_users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'super_admin' AND u.status = 'active'`
  );
  return Number(rows[0].total);
}

async function isDescendantOf(targetId: number, candidateId: number): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM web_users WHERE id = ?
       UNION ALL
       SELECT u.id FROM web_users u JOIN tree t ON u.parent_user_id = t.id
     )
     SELECT id FROM tree WHERE id = ?`,
    [targetId, candidateId]
  );
  return rows.length > 0;
}

async function resolveParent(req: any, requested: number | null | undefined, targetId?: number): Promise<number | null> {
  const actor = req.auth!;
  const superAdmin = isSuperAdmin(req);
  const parent = requested === undefined ? (superAdmin ? null : actor.id) : requested;
  if (parent === null) {
    if (!superAdmin) {
      throw new ApiError(403, 'FORBIDDEN', 'Không được tách tài khoản khỏi cây quản lý');
    }
    return null;
  }
  if (!superAdmin && parent !== actor.id) {
    const ids = await scopeIdsFor(req);
    if (!ids.includes(parent)) throw new ApiError(403, 'FORBIDDEN', 'Parent ngoài phạm vi');
  }
  if (targetId && parent === targetId) {
    throw new ApiError(400, 'INVALID_PARENT', 'Parent không hợp lệ');
  }
  if (targetId && (await isDescendantOf(targetId, parent))) {
    throw new ApiError(400, 'INVALID_PARENT', 'Không thể tạo chu trình parent');
  }
  const exists = await query<RowDataPacket[]>('SELECT id FROM web_users WHERE id = ?', [parent]);
  if (exists.length === 0) throw new ApiError(400, 'INVALID_PARENT', 'Parent không tồn tại');
  return parent;
}

async function assertCanTarget(req: any, target: RowDataPacket): Promise<void> {
  const actor = req.auth!;
  const superAdmin = isSuperAdmin(req);
  if (target.role_code === 'super_admin' && !superAdmin) {
    throw new ApiError(403, 'FORBIDDEN', 'Không được quản lý super_admin');
  }
  if (!canManageRole(actor.roleLevel, Number(target.role_level), superAdmin)) {
    throw new ApiError(403, 'FORBIDDEN', 'Không được quản lý tài khoản cấp cao hơn hoặc bằng');
  }
  await assertRecordScope(req, Number(target.id), 'id');
}

webUsersRouter.get(
  '/',
  requirePermission('web_users', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'u.id');
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (q) {
      where += ' AND (u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT u.*, r.code AS role_code, r.name AS role_name, r.level AS role_level
         FROM web_users u JOIN roles r ON r.id = u.role_id
        WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM web_users u WHERE ${where}`,
      params
    );
    res.json({ items: rows.map(publicUser), total: Number(countRows[0].total), pageSize, offset });
  })
);

webUsersRouter.get(
  '/export',
  requirePermission('web_users', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'u.id');
    const [rows] = await adminPool.query<any[]>(
      `SELECT u.username, u.display_name, u.email, u.status, r.code AS role_code,
              p.username AS parent_username
         FROM web_users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN web_users p ON p.id = u.parent_user_id
        WHERE ${scope.sql} ORDER BY u.username`,
      scope.params
    );
    const buffer = await buildWorkbook(
      ['username', 'display_name', 'email', 'role_code', 'parent_username', 'status'],
      rows.map((row) => [
        row.username, row.display_name, row.email, row.role_code,
        row.parent_username ?? '', row.status
      ]),
      'Users'
    );
    sendWorkbook(res, buffer, `web-users-${Date.now()}.xlsx`);
  })
);

webUsersRouter.post(
  '/import',
  requirePermission('web_users', 'add'),
  asyncHandler(async (req, res) => {
    const body = z.object({ dataBase64: z.string().min(1), dryRun: z.boolean().optional() }).parse(req.body);
    const workbook = await readWorkbook(body.dataBase64);
    const rows = readSheetRows(workbook);
    const errors: string[] = [];
    const normalized: any[] = [];
    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      const username = String(row.username ?? '').trim();
      const displayName = String(row.display_name ?? '').trim();
      const roleCode = String(row.role_code ?? '').trim();
      const parentUsername = String(row.parent_username ?? '').trim();
      if (!/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
        errors.push(`Line ${line} column username invalid`);
        continue;
      }
      if (!displayName) {
        errors.push(`Line ${line} column display_name required`);
        continue;
      }
      const roleRows = await query<RowDataPacket[]>('SELECT id FROM roles WHERE code = ?', [roleCode]);
      if (roleRows.length === 0) {
        errors.push(`Line ${line} column role_code not found`);
        continue;
      }
      let parentId: number | null = null;
      if (parentUsername) {
        const parentRows = await query<RowDataPacket[]>('SELECT id FROM web_users WHERE username = ?', [parentUsername]);
        if (parentRows.length === 0) {
          errors.push(`Line ${line} column parent_username not found`);
          continue;
        }
        parentId = Number(parentRows[0].id);
      }
      normalized.push({
        username,
        displayName,
        email: String(row.email ?? ''),
        status: String(row.status ?? 'active') === 'locked' ? 'locked' : 'active',
        roleId: Number(roleRows[0].id),
        parentId
      });
    }
    if (body.dryRun) {
      res.json({ items: normalized, errors, total: normalized.length });
      return;
    }
    if (errors.length) throw new ApiError(400, 'VALIDATION_ERROR', errors.join('; '));
    let created = 0;
    let updated = 0;
    const passwordHash = await hashPassword('123456');
    for (const item of normalized) {
      const [existing] = await adminPool.query<any[]>('SELECT id FROM web_users WHERE username = ?', [item.username]);
      if (existing[0]) {
        await adminPool.query(
          'UPDATE web_users SET display_name=?, email=?, role_id=?, parent_user_id=?, status=? WHERE id=?',
          [item.displayName, item.email, item.roleId, item.parentId, item.status, existing[0].id]
        );
        updated += 1;
      } else {
        await adminPool.query(
          `INSERT INTO web_users
             (username, password_hash, display_name, email, role_id, parent_user_id, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.username, passwordHash, item.displayName, item.email, item.roleId, item.parentId, item.status, req.auth!.id]
        );
        created += 1;
      }
    }
    await writeAudit(adminPool, req.auth!.id, 'import', 'web_user', '', null, { created, updated }, ipFrom(req));
    res.json({ created, updated, total: normalized.length });
  })
);

webUsersRouter.get(
  '/:id',
  requirePermission('web_users', 'view'),
  asyncHandler(async (req, res) => {
    const user = await getUser(Number(req.params.id));
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
    await assertRecordScope(req, Number(user.id), 'id');
    res.json({ item: publicUser(user) });
  })
);

webUsersRouter.post(
  '/',
  requirePermission('web_users', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const role = await getRole(body.role_id);
    if (!role) throw new ApiError(400, 'INVALID_ROLE', 'Role không tồn tại');
    const superAdmin = isSuperAdmin(req);
    if (!canManageRole(req.auth!.roleLevel, Number(role.level), superAdmin)) {
      throw new ApiError(403, 'FORBIDDEN', 'Không được gán role cấp cao hơn hoặc bằng');
    }
    const parentId = await resolveParent(req, body.parent_user_id);
    const passwordHash = await hashPassword(body.password);
    const [result] = await adminPool.query<any>(
      `INSERT INTO web_users
         (username, password_hash, display_name, email, role_id, parent_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        body.username,
        passwordHash,
        body.display_name,
        body.email,
        body.role_id,
        parentId,
        req.auth!.id
      ]
    );
    const created = await getUser(Number(result.insertId));
    await writeAudit(adminPool, req.auth!.id, 'create', 'web_user', result.insertId, null, created, ipFrom(req));
    res.status(201).json({ item: created ? publicUser(created) : null });
  })
);

webUsersRouter.patch(
  '/:id',
  requirePermission('web_users', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getUser(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
    const isSelf = id === req.auth!.id;
    if (isSelf) {
      await assertRecordScope(req, Number(before.id), 'id');
    } else {
      await assertCanTarget(req, before);
    }

    if (isSelf && !isSuperAdmin(req)) {
      const allowed = new Set(['display_name', 'email', 'password']);
      const invalid = Object.keys(req.body).filter((key) => !allowed.has(key));
      if (invalid.length > 0) {
        throw new ApiError(403, 'FORBIDDEN', 'Chỉ được sửa display_name, email, password');
      }
    }

    const body = updateSchema.parse(req.body);
    let roleId = Number(before.role_id);
    let nextRoleCode = String(before.role_code);
    if (body.role_id !== undefined) {
      const role = await getRole(body.role_id);
      if (!role) throw new ApiError(400, 'INVALID_ROLE', 'Role không tồn tại');
      if (!canManageRole(req.auth!.roleLevel, Number(role.level), isSuperAdmin(req))) {
        throw new ApiError(403, 'FORBIDDEN', 'Không được gán role cấp cao hơn hoặc bằng');
      }
      roleId = body.role_id;
      nextRoleCode = String(role.code);
    }
    if (
      before.role_code === 'super_admin' &&
      nextRoleCode !== 'super_admin' &&
      (await countSuperAdmins()) <= 1
    ) {
      throw new ApiError(409, 'LAST_SUPER_ADMIN', 'Không được hạ cấp super_admin cuối cùng');
    }
    const parentId =
      body.parent_user_id === undefined
        ? before.parent_user_id
        : await resolveParent(req, body.parent_user_id, id);
    const passwordHash = body.password ? await hashPassword(body.password) : before.password_hash;

    await adminPool.query(
      `UPDATE web_users SET display_name=?, email=?, password_hash=?, role_id=?, parent_user_id=? WHERE id=?`,
      [
        body.display_name ?? before.display_name,
        body.email ?? before.email,
        passwordHash,
        roleId,
        parentId,
        id
      ]
    );
    if (body.password) {
      await adminPool.query('DELETE FROM web_sessions WHERE web_user_id = ?', [id]);
    }
    const after = await getUser(id);
    await writeAudit(adminPool, req.auth!.id, 'update', 'web_user', id, before, after, ipFrom(req));
    res.json({ item: after ? publicUser(after) : null });
  })
);

webUsersRouter.delete(
  '/:id',
  requirePermission('web_users', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getUser(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
    if (id === req.auth!.id) throw new ApiError(409, 'SELF_DELETE', 'Không được xóa chính mình');
    await assertCanTarget(req, before);
    if (before.role_code === 'super_admin' && (await countSuperAdmins()) <= 1) {
      throw new ApiError(409, 'LAST_SUPER_ADMIN', 'Không được xóa super_admin cuối cùng');
    }
    await adminPool.query('DELETE FROM web_users WHERE id = ?', [id]);
    await writeAudit(adminPool, req.auth!.id, 'delete', 'web_user', id, before, null, ipFrom(req));
    res.status(204).send();
  })
);

for (const action of ['lock', 'unlock'] as const) {
  webUsersRouter.post(
    `/:id/${action}`,
    requirePermission('web_users', 'edit'),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const before = await getUser(id);
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
      if (id === req.auth!.id) throw new ApiError(409, 'SELF_LOCK', 'Không được khóa chính mình');
      await assertCanTarget(req, before);
      if (before.role_code === 'super_admin' && action === 'lock' && (await countSuperAdmins()) <= 1) {
        throw new ApiError(409, 'LAST_SUPER_ADMIN', 'Không được khóa super_admin cuối cùng');
      }
      const status = action === 'lock' ? 'locked' : 'active';
      await adminPool.query('UPDATE web_users SET status = ? WHERE id = ?', [status, id]);
      if (action === 'lock') {
        await adminPool.query('DELETE FROM web_sessions WHERE web_user_id = ?', [id]);
      }
      const after = await getUser(id);
      await writeAudit(adminPool, req.auth!.id, action, 'web_user', id, before, after, ipFrom(req));
      res.json({ item: after ? publicUser(after) : null });
    })
  );
}
