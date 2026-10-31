import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { isSuperAdmin, requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { ipFrom } from '../rbac/access';

export const rolesRouter = Router();
rolesRouter.use(requireAuth);
rolesRouter.use(csrfProtection);

const scopeSchema = z.enum(['all', 'subtree', 'tenant', 'own', 'none']);

const createSchema = z.object({
  code: z.string().min(2).max(50).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(100),
  level: z.number().int().min(1).max(99),
  description: z.string().max(255).optional().default('')
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  level: z.number().int().min(1).max(99).optional(),
  description: z.string().max(255).optional()
});

const permissionsSchema = z.object({
  permissions: z.array(
    z.object({
      code: z.string().min(1).max(100),
      scope: scopeSchema
    })
  )
});

async function getRole(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM roles WHERE id = ?', [id]);
  return rows[0] ?? null;
}

function assertCanManageRole(req: any, role: RowDataPacket): void {
  if (isSuperAdmin(req)) return;
  if (Number(role.level) >= req.auth!.roleLevel) {
    throw new ApiError(403, 'FORBIDDEN', 'Không được quản lý role cấp cao hơn hoặc bằng');
  }
}

rolesRouter.get(
  '/',
  requirePermission('roles', 'view'),
  asyncHandler(async (_req, res) => {
    const rows = await query<RowDataPacket[]>(
      `SELECT r.*, (SELECT COUNT(*) FROM web_users u WHERE u.role_id = r.id) AS user_count
         FROM roles r ORDER BY r.level DESC, r.id`
    );
    res.json({ items: rows });
  })
);

rolesRouter.get(
  '/:id/permissions',
  requirePermission('roles', 'view'),
  asyncHandler(async (req, res) => {
    const role = await getRole(Number(req.params.id));
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role không tồn tại');
    const rows = await query<RowDataPacket[]>(
      `SELECT p.code, p.module, p.action, p.description, COALESCE(rp.scope, 'none') AS scope
         FROM permissions p
         LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = ?
        ORDER BY p.module, p.action`,
      [role.id]
    );
    res.json({ role, permissions: rows });
  })
);

rolesRouter.put(
  '/:id/permissions',
  requirePermission('roles', 'edit'),
  asyncHandler(async (req, res) => {
    const role = await getRole(Number(req.params.id));
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role không tồn tại');
    if (Number(role.is_system) === 1) {
      throw new ApiError(403, 'SYSTEM_ROLE', 'Không sửa quyền role hệ thống');
    }
    assertCanManageRole(req, role);
    const body = permissionsSchema.parse(req.body);
    const codes = body.permissions.map((item) => item.code);
    const permissionRows = await query<RowDataPacket[]>(
      `SELECT id, code FROM permissions WHERE code IN (${codes.map(() => '?').join(',') || 'NULL'})`,
      codes
    );
    const byCode = new Map(permissionRows.map((row) => [String(row.code), Number(row.id)]));
    for (const item of body.permissions) {
      if (!byCode.has(item.code)) throw new ApiError(400, 'INVALID_PERMISSION', `Quyền không tồn tại: ${item.code}`);
    }
    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [role.id]);
      for (const item of body.permissions) {
        if (item.scope === 'none') continue;
        await conn.query(
          'INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)',
          [role.id, byCode.get(item.code), item.scope]
        );
      }
    });
    await writeAudit(adminPool, req.auth!.id, 'update_permissions', 'role', role.id, null, body, ipFrom(req));
    res.json({ ok: true });
  })
);

rolesRouter.post(
  '/',
  requirePermission('roles', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (!isSuperAdmin(req) && body.level >= req.auth!.roleLevel) {
      throw new ApiError(403, 'FORBIDDEN', 'Không được tạo role cấp cao hơn hoặc bằng');
    }
    const [result] = await adminPool.query<any>(
      `INSERT INTO roles (code, name, level, is_system, description) VALUES (?, ?, ?, 0, ?)`,
      [body.code, body.name, body.level, body.description]
    );
    const role = await getRole(Number(result.insertId));
    await writeAudit(adminPool, req.auth!.id, 'create', 'role', result.insertId, null, role, ipFrom(req));
    res.status(201).json({ item: role });
  })
);

rolesRouter.patch(
  '/:id',
  requirePermission('roles', 'edit'),
  asyncHandler(async (req, res) => {
    const role = await getRole(Number(req.params.id));
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role không tồn tại');
    if (Number(role.is_system) === 1) throw new ApiError(403, 'SYSTEM_ROLE', 'Không sửa role hệ thống');
    assertCanManageRole(req, role);
    const body = updateSchema.parse(req.body);
    if (body.level !== undefined && !isSuperAdmin(req) && body.level >= req.auth!.roleLevel) {
      throw new ApiError(403, 'FORBIDDEN', 'Không được đặt level cao hơn hoặc bằng');
    }
    await adminPool.query('UPDATE roles SET name=?, level=?, description=? WHERE id=?', [
      body.name ?? role.name,
      body.level ?? role.level,
      body.description ?? role.description,
      role.id
    ]);
    const after = await getRole(Number(role.id));
    await writeAudit(adminPool, req.auth!.id, 'update', 'role', Number(role.id), role, after, ipFrom(req));
    res.json({ item: after });
  })
);

rolesRouter.delete(
  '/:id',
  requirePermission('roles', 'delete'),
  asyncHandler(async (req, res) => {
    const role = await getRole(Number(req.params.id));
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role không tồn tại');
    if (Number(role.is_system) === 1) throw new ApiError(403, 'SYSTEM_ROLE', 'Không xóa role hệ thống');
    assertCanManageRole(req, role);
    const rows = await query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM web_users WHERE role_id = ?',
      [role.id]
    );
    if (Number(rows[0].total) > 0) {
      throw new ApiError(409, 'ROLE_IN_USE', 'Role đang được gán cho tài khoản');
    }
    await adminPool.query('DELETE FROM roles WHERE id = ?', [role.id]);
    await writeAudit(adminPool, req.auth!.id, 'delete', 'role', Number(role.id), role, null, ipFrom(req));
    res.status(204).send();
  })
);
