import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { buildAlertImpacts } from '../lib/alertImpact';
import { writeAudit } from '../lib/audit';
import { emptyBulkResult, uniqueIds } from '../lib/bulk';
import { asyncHandler, ApiError } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { assertRecordScope, ipFrom, listScope, pageFrom, scopeIdsFor } from '../rbac/access';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);
alertsRouter.use(csrfProtection);

const ackSchema = z.object({
  note: z.string().max(500).optional().default('')
});

function publicAlert(row: any) {
  return {
    id: Number(row.id),
    type: String(row.type),
    eventType: String(row.event_type ?? 'system'),
    level: String(row.level ?? 'minor'),
    unread: Boolean(row.unread ?? 1),
    readAt: row.read_at ?? null,
    severity: String(row.severity),
    targetType: String(row.target_type),
    targetId: row.target_id === null ? null : Number(row.target_id),
    title: String(row.title),
    message: String(row.message ?? ''),
    status: String(row.status),
    ownerWebUserId:
      row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
    ownerName: row.owner_name ?? null,
    companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
    companyName: row.company_name ?? null,
    createdAt: row.created_at,
    ackedAt: row.acked_at,
    ackedBy: row.acked_by === null ? null : Number(row.acked_by),
    ackNote: String(row.ack_note ?? '')
  };
}

async function getAlert(id: number): Promise<any | null> {
  const [rows] = await adminPool.query<any[]>(
    `SELECT a.*, u.display_name AS owner_name, c.name AS company_name
       FROM alerts a
       LEFT JOIN web_users u ON u.id = a.owner_web_user_id
       LEFT JOIN companies c ON c.id = a.company_id
      WHERE a.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

alertsRouter.get(
  '/',
  requirePermission('alerts', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'a.owner_web_user_id', { companyColumn: 'a.company_id' });
    const status = String(req.query.status || '').trim();
    const severity = String(req.query.severity || '').trim();
    const level = String(req.query.level || '').trim();
    const eventType = String(req.query.eventType || '').trim();
    const unread = String(req.query.unread || '').trim();
    const targetType = String(req.query.targetType || '').trim();
    const q = String(req.query.q || '').trim();

    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (status === 'open' || status === 'acked') {
      where += ' AND a.status = ?';
      params.push(status);
    }
    if (severity) {
      where += ' AND a.severity = ?';
      params.push(severity);
    }
    if (level) {
      where += ' AND a.level = ?';
      params.push(level);
    }
    if (eventType) {
      where += ' AND a.event_type = ?';
      params.push(eventType);
    }
    if (unread === '1' || unread === 'true') {
      where += ' AND a.unread = 1';
    }
    if (targetType) {
      where += ' AND a.target_type = ?';
      params.push(targetType);
    }
    if (q) {
      where += ' AND (a.title LIKE ? OR a.message LIKE ? OR a.type LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const companyId = Number(req.query.companyId || 0);
    if (req.auth?.roleCode === 'super_admin' && Number.isInteger(companyId) && companyId > 0) {
      where += ' AND a.company_id = ?';
      params.push(companyId);
    }

    const [rows] = await adminPool.query<any[]>(
      `SELECT a.*, u.display_name AS owner_name, c.name AS company_name
         FROM alerts a
         LEFT JOIN web_users u ON u.id = a.owner_web_user_id
         LEFT JOIN companies c ON c.id = a.company_id
        WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<any[]>(
      `SELECT COUNT(*) AS total FROM alerts a WHERE ${where}`,
      params
    );
    const includeImpact = ['1', 'true'].includes(String(req.query.includeImpact || ''));
    const impacts = includeImpact
      ? await buildAlertImpacts(
          rows.map((row) => ({
            key: `admin:${row.id}`,
            targetType: String(row.target_type),
            targetId: row.target_id === null ? null : Number(row.target_id)
          }))
        )
      : null;
    res.json({
      items: rows.map((row) => ({
        ...publicAlert(row),
        ...(impacts ? { impact: impacts.get(`admin:${row.id}`) ?? null } : {})
      })),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

alertsRouter.post(
  '/read-all',
  requirePermission('alerts', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'owner_web_user_id', { companyColumn: 'company_id' });
    await adminPool.query(
      `UPDATE alerts SET unread = 0, read_at = UTC_TIMESTAMP(3)
        WHERE ${scope.sql} AND unread = 1`,
      scope.params
    );
    res.json({ ok: true });
  })
);

alertsRouter.post(
  '/:id/read',
  requirePermission('alerts', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await getAlert(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy cảnh báo');
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    await adminPool.query('UPDATE alerts SET unread = 0, read_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]);
    res.json({ item: publicAlert(await getAlert(id)) });
  })
);

alertsRouter.get(
  '/:id',
  requirePermission('alerts', 'view'),
  asyncHandler(async (req, res) => {
    const row = await getAlert(Number(req.params.id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy cảnh báo');
    await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
    res.json({ item: publicAlert(row) });
  })
);

alertsRouter.post(
  '/bulk-ack',
  requirePermission('alerts', 'ack'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        ids: z.array(z.number().int().positive()).min(1).max(200),
        note: z.string().max(500).optional().default('')
      })
      .parse(req.body);
    const ids = uniqueIds(body.ids);
    const rows = await query<RowDataPacket[]>(
      `SELECT id, status, owner_web_user_id, company_id FROM alerts
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
        if (row.status === 'acked') result.skipped += 1;
        else allowed.push(row);
      } catch {
        result.forbidden += 1;
      }
    }
    await withTransaction(async (conn) => {
      for (const row of allowed) {
        await conn.query(
          `UPDATE alerts
              SET status = 'acked', acked_at = UTC_TIMESTAMP(3), acked_by = ?, ack_note = ?
            WHERE id = ?`,
          [req.auth!.id, body.note, row.id]
        );
      }
    });
    result.updated = allowed.length;
    await writeAudit(
      adminPool,
      req.auth!.id,
      'bulk_ack',
      'alert',
      `bulk:${ids.length}`,
      null,
      { ids, note: body.note, result },
      ipFrom(req)
    );
    res.json({ result });
  })
);

alertsRouter.post(
  '/:id/ack',
  requirePermission('alerts', 'ack'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getAlert(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy cảnh báo');
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    const body = ackSchema.parse(req.body ?? {});

    if (before.status !== 'acked') {
      await query<RowDataPacket[]>(
        `UPDATE alerts
            SET status = 'acked', acked_at = UTC_TIMESTAMP(3), acked_by = ?, ack_note = ?
          WHERE id = ?`,
        [req.auth!.id, body.note, id]
      );
      await writeAudit(
        adminPool,
        req.auth!.id,
        'ack',
        'alert',
        id,
        publicAlert(before),
        { status: 'acked', note: body.note },
        ipFrom(req)
      );
    }
    const after = await getAlert(id);
    res.json({ item: publicAlert(after) });
  })
);
