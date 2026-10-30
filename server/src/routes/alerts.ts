import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { writeAudit } from '../lib/audit';
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
    severity: String(row.severity),
    targetType: String(row.target_type),
    targetId: row.target_id === null ? null : Number(row.target_id),
    title: String(row.title),
    message: String(row.message ?? ''),
    status: String(row.status),
    ownerWebUserId:
      row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
    createdAt: row.created_at,
    ackedAt: row.acked_at,
    ackedBy: row.acked_by === null ? null : Number(row.acked_by),
    ackNote: String(row.ack_note ?? '')
  };
}

async function getAlert(id: number): Promise<any | null> {
  const [rows] = await adminPool.query<any[]>('SELECT * FROM alerts WHERE id = ?', [id]);
  return rows[0] ?? null;
}

alertsRouter.get(
  '/',
  requirePermission('alerts', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'owner_web_user_id');
    const status = String(req.query.status || '').trim();
    const severity = String(req.query.severity || '').trim();
    const targetType = String(req.query.targetType || '').trim();
    const q = String(req.query.q || '').trim();

    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (status === 'open' || status === 'acked') {
      where += ' AND status = ?';
      params.push(status);
    }
    if (severity) {
      where += ' AND severity = ?';
      params.push(severity);
    }
    if (targetType) {
      where += ' AND target_type = ?';
      params.push(targetType);
    }
    if (q) {
      where += ' AND (title LIKE ? OR message LIKE ? OR type LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const [rows] = await adminPool.query<any[]>(
      `SELECT * FROM alerts WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<any[]>(
      `SELECT COUNT(*) AS total FROM alerts WHERE ${where}`,
      params
    );
    res.json({
      items: rows.map(publicAlert),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

alertsRouter.get(
  '/:id',
  requirePermission('alerts', 'view'),
  asyncHandler(async (req, res) => {
    const row = await getAlert(Number(req.params.id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy cảnh báo');
    await assertRecordScope(req, row.owner_web_user_id);
    res.json({ item: publicAlert(row) });
  })
);

alertsRouter.post(
  '/:id/ack',
  requirePermission('alerts', 'ack'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getAlert(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy cảnh báo');
    await assertRecordScope(req, before.owner_web_user_id);
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
