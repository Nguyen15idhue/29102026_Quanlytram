import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool } from '../db/pool';
import { asyncHandler } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { pageFrom } from '../rbac/access';

export const auditRouter = Router();
auditRouter.use(requireAuth);
auditRouter.use(csrfProtection);

function publicLog(row: RowDataPacket) {
  return {
    id: Number(row.id),
    actorId: row.actor_web_user_id === null ? null : Number(row.actor_web_user_id),
    actorName: row.actor_name ? String(row.actor_name) : '',
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id ?? ''),
    before: row.before_redacted ?? null,
    after: row.after_redacted ?? null,
    companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
    companyName: row.company_name ?? null,
    ip: String(row.ip ?? ''),
    createdAt: row.created_at
  };
}

auditRouter.get(
  '/',
  requirePermission('audit', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const action = String(req.query.action || '').trim();
    const entityType = String(req.query.entityType || req.query.module || '').trim();
    const q = String(req.query.q || '').trim();
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const params: unknown[] = [];
    const where: string[] = ['1=1'];
    const isSuper = req.auth?.roleCode === 'super_admin';
    if (!isSuper) {
      if (req.auth?.companyId === null || req.auth?.companyId === undefined) {
        where.push('1=0');
      } else {
        where.push('a.company_id = ?');
        params.push(Number(req.auth.companyId));
      }
    } else {
      const companyId = Number(req.query.companyId || 0);
      if (Number.isInteger(companyId) && companyId > 0) {
        where.push('a.company_id = ?');
        params.push(companyId);
      }
    }
    if (action) {
      where.push('a.action = ?');
      params.push(action);
    }
    if (entityType) {
      where.push('a.entity_type = ?');
      params.push(entityType);
    }
    if (q) {
      where.push('(a.entity_id LIKE ? OR a.action LIKE ? OR a.entity_type LIKE ? OR u.username LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (from && !Number.isNaN(from.getTime())) {
      where.push('a.created_at >= ?');
      params.push(from);
    }
    if (to && !Number.isNaN(to.getTime())) {
      where.push('a.created_at <= ?');
      params.push(to);
    }

    const whereSql = where.join(' AND ');
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT a.*, u.username AS actor_name, c.name AS company_name
         FROM audit_logs a
         LEFT JOIN web_users u ON u.id = a.actor_web_user_id
         LEFT JOIN companies c ON c.id = a.company_id
        WHERE ${whereSql}
        ORDER BY a.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM audit_logs a
         LEFT JOIN web_users u ON u.id = a.actor_web_user_id
        WHERE ${whereSql}`,
      params
    );

    res.json({
      items: rows.map(publicLog),
      total: Number(countRows[0]?.total ?? 0),
      pageSize,
      offset
    });
  })
);
