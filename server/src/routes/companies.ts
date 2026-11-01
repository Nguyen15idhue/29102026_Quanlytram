import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { requireAuth, requirePermission, isSuperAdmin } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { ipFrom, pageFrom } from '../rbac/access';

export const companiesRouter = Router();
companiesRouter.use(requireAuth);
companiesRouter.use(csrfProtection);

const createSchema = z.object({
  code: z.string().min(2).max(50).regex(/^[A-Za-z0-9_.-]+$/),
  name: z.string().min(1).max(160),
  notes: z.string().max(500).optional().default('')
});

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  notes: z.string().max(500).optional()
});

function requireSuper(req: any): void {
  if (!isSuperAdmin(req)) {
    throw new ApiError(403, 'FORBIDDEN', 'Chỉ super admin được quản lý công ty');
  }
}

function publicCompany(row: RowDataPacket) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    status: String(row.status),
    notes: String(row.notes ?? ''),
    userCount: Number(row.user_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getCompany(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT c.*, (SELECT COUNT(*) FROM web_users u WHERE u.company_id = c.id) AS user_count
       FROM companies c WHERE c.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

companiesRouter.get(
  '/',
  requirePermission('companies', 'view'),
  asyncHandler(async (req, res) => {
    requireSuper(req);
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const params: unknown[] = [];
    const clauses: string[] = ['1=1'];
    if (q) {
      clauses.push('(c.code LIKE ? OR c.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status === 'active' || status === 'disabled') {
      clauses.push('c.status = ?');
      params.push(status);
    }
    const where = clauses.join(' AND ');
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT c.*, (SELECT COUNT(*) FROM web_users u WHERE u.company_id = c.id) AS user_count
         FROM companies c WHERE ${where}
        ORDER BY c.name LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM companies c WHERE ${where}`,
      params
    );
    res.json({
      items: rows.map(publicCompany),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

companiesRouter.get(
  '/:id',
  requirePermission('companies', 'view'),
  asyncHandler(async (req, res) => {
    requireSuper(req);
    const company = await getCompany(Number(req.params.id));
    if (!company) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy công ty');
    res.json({ item: publicCompany(company) });
  })
);

companiesRouter.get(
  '/:id/users',
  requirePermission('companies', 'view'),
  asyncHandler(async (req, res) => {
    requireSuper(req);
    const id = Number(req.params.id);
    const company = await getCompany(id);
    if (!company) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy công ty');
    const { pageSize, offset } = pageFrom(req);
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.display_name, u.email, u.status, u.parent_user_id,
              r.code AS role_code, r.name AS role_name, r.level AS role_level
         FROM web_users u JOIN roles r ON r.id = u.role_id
        WHERE u.company_id = ?
        ORDER BY u.id LIMIT ? OFFSET ?`,
      [id, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM web_users WHERE company_id = ?',
      [id]
    );
    res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        email: String(row.email ?? ''),
        status: String(row.status),
        parentUserId: row.parent_user_id === null ? null : Number(row.parent_user_id),
        role: {
          code: String(row.role_code),
          name: String(row.role_name),
          level: Number(row.role_level)
        }
      })),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

companiesRouter.post(
  '/',
  requirePermission('companies', 'add'),
  asyncHandler(async (req, res) => {
    requireSuper(req);
    const body = createSchema.parse(req.body);
    try {
      const [result] = await adminPool.query<any>(
        `INSERT INTO companies (code, name, notes, created_by)
         VALUES (?, ?, ?, ?)`,
        [body.code, body.name, body.notes, req.auth!.id]
      );
      const created = await getCompany(Number(result.insertId));
      await writeAudit(adminPool, req.auth!.id, 'create', 'company', result.insertId, null, created, ipFrom(req));
      res.status(201).json({ item: created ? publicCompany(created) : null });
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new ApiError(409, 'DUPLICATE_CODE', 'Mã công ty đã tồn tại');
      }
      throw err;
    }
  })
);

companiesRouter.patch(
  '/:id',
  requirePermission('companies', 'edit'),
  asyncHandler(async (req, res) => {
    requireSuper(req);
    const id = Number(req.params.id);
    const before = await getCompany(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy công ty');
    const body = updateSchema.parse(req.body);
    await adminPool.query(
      'UPDATE companies SET name = ?, notes = ? WHERE id = ?',
      [body.name ?? before.name, body.notes ?? before.notes, id]
    );
    const after = await getCompany(id);
    await writeAudit(adminPool, req.auth!.id, 'update', 'company', id, before, after, ipFrom(req));
    res.json({ item: after ? publicCompany(after) : null });
  })
);

for (const action of ['enable', 'disable'] as const) {
  companiesRouter.post(
    `/:id/${action}`,
    requirePermission('companies', 'edit'),
    asyncHandler(async (req, res) => {
      requireSuper(req);
      const id = Number(req.params.id);
      const before = await getCompany(id);
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy công ty');
      const status = action === 'enable' ? 'active' : 'disabled';
      await adminPool.query('UPDATE companies SET status = ? WHERE id = ?', [status, id]);
      if (action === 'disable') {
        await adminPool.query(
          'DELETE s FROM web_sessions s JOIN web_users u ON u.id = s.web_user_id WHERE u.company_id = ?',
          [id]
        );
      }
      const after = await getCompany(id);
      await writeAudit(adminPool, req.auth!.id, action, 'company', id, before, after, ipFrom(req));
      res.json({ item: after ? publicCompany(after) : null });
    })
  );
}

companiesRouter.delete(
  '/:id',
  requirePermission('companies', 'delete'),
  asyncHandler(async (req, res) => {
    requireSuper(req);
    const id = Number(req.params.id);
    const before = await getCompany(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy công ty');
    const resources = await query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM web_users WHERE company_id = ?) AS users,
         (SELECT COUNT(*) FROM stations WHERE company_id = ?) AS stations,
         (SELECT COUNT(*) FROM mountpoints WHERE company_id = ?) AS mountpoints,
         (SELECT COUNT(*) FROM ntrip_accounts WHERE company_id = ?) AS accounts,
         (SELECT COUNT(*) FROM relay_jobs WHERE company_id = ?) AS relays`,
      [id, id, id, id, id]
    );
    const row = resources[0];
    if (
      Number(row.users) + Number(row.stations) + Number(row.mountpoints) +
      Number(row.accounts) + Number(row.relays) > 0
    ) {
      throw new ApiError(409, 'COMPANY_IN_USE', 'Công ty còn dữ liệu, hãy disable thay vì xóa');
    }
    await adminPool.query('DELETE FROM companies WHERE id = ?', [id]);
    await writeAudit(adminPool, req.auth!.id, 'delete', 'company', id, before, null, ipFrom(req));
    res.status(204).send();
  })
);
