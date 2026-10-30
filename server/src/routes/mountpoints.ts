import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { assertRecordScope, ipFrom, listScope, pageFrom, scopeIdsFor } from '../rbac/access';

export const mountpointsRouter = Router();
mountpointsRouter.use(requireAuth);
mountpointsRouter.use(csrfProtection);

const createSchema = z.object({
  name: z.string().min(1).max(128),
  station_id: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  requires_auth: z.boolean().optional().default(true),
  service_type: z.string().max(64).optional(),
  position_mode: z.string().max(64).optional(),
  satellite_systems: z.string().max(64).optional(),
  caster_interval: z.number().int().min(0).max(3600).optional(),
  code_protocol: z.string().max(64).optional(),
  code_type: z.string().max(64).optional(),
  description: z.string().max(500).optional(),
  owner_web_user_id: z.number().int().positive().nullable().optional()
});
const updateSchema = createSchema.partial();

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

async function getMountpoint(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM mountpoints WHERE id = ?', [id]);
  return rows[0] ?? null;
}

async function assertStationScope(req: any, stationId: number | null | undefined): Promise<void> {
  if (stationId === null || stationId === undefined) return;
  const rows = await query<RowDataPacket[]>('SELECT owner_web_user_id FROM stations WHERE id = ?', [
    stationId
  ]);
  if (rows.length === 0) throw new ApiError(400, 'INVALID_STATION', 'Trạm không tồn tại');
  await assertRecordScope(req, rows[0].owner_web_user_id);
}

mountpointsRouter.get(
  '/',
  requirePermission('mountpoints', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 'm.owner_web_user_id');
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (q) {
      where += ' AND m.name LIKE ?';
      params.push(`%${q}%`);
    }
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT m.*, s.code AS station_code, s.name AS station_name
         FROM mountpoints m LEFT JOIN stations s ON s.id = m.station_id
        WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM mountpoints m WHERE ${where}`,
      params
    );
    res.json({ items: rows, total: Number(countRows[0].total), pageSize, offset });
  })
);

mountpointsRouter.get(
  '/:id',
  requirePermission('mountpoints', 'view'),
  asyncHandler(async (req, res) => {
    const item = await getMountpoint(Number(req.params.id));
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    await assertRecordScope(req, item.owner_web_user_id);
    res.json({ item });
  })
);

mountpointsRouter.post(
  '/',
  requirePermission('mountpoints', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    await assertStationScope(req, body.station_id);
    const ownerId = await resolveOwner(req, body.owner_web_user_id);
    const [result] = await adminPool.query<any>(
      `INSERT INTO mountpoints
         (name, station_id, enabled, requires_auth, service_type, position_mode,
          satellite_systems, caster_interval, code_protocol, code_type, description,
          owner_web_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name, body.station_id ?? null, body.enabled, body.requires_auth,
        body.service_type ?? 'rtcm', body.position_mode ?? 'normal',
        body.satellite_systems ?? '', body.caster_interval ?? 0,
        body.code_protocol ?? '', body.code_type ?? '', body.description ?? '',
        ownerId, req.auth!.id
      ]
    );
    const item = await getMountpoint(Number(result.insertId));
    await writeAudit(adminPool, req.auth!.id, 'create', 'mountpoint', result.insertId, null, item, ipFrom(req));
    res.status(201).json({ item });
  })
);

mountpointsRouter.patch(
  '/:id',
  requirePermission('mountpoints', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getMountpoint(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    await assertRecordScope(req, before.owner_web_user_id);
    const body = updateSchema.parse(req.body);
    if (body.station_id !== undefined) await assertStationScope(req, body.station_id);
    const ownerId =
      body.owner_web_user_id === undefined
        ? Number(before.owner_web_user_id)
        : await resolveOwner(req, body.owner_web_user_id);
    await adminPool.query(
      `UPDATE mountpoints SET name=?, station_id=?, enabled=?, requires_auth=?,
         service_type=?, position_mode=?, satellite_systems=?, caster_interval=?,
         code_protocol=?, code_type=?, description=?, owner_web_user_id=? WHERE id=?`,
      [
        body.name ?? before.name,
        body.station_id === undefined ? before.station_id : body.station_id,
        body.enabled === undefined ? before.enabled : body.enabled,
        body.requires_auth === undefined ? before.requires_auth : body.requires_auth,
        body.service_type ?? before.service_type,
        body.position_mode ?? before.position_mode,
        body.satellite_systems ?? before.satellite_systems,
        body.caster_interval ?? before.caster_interval,
        body.code_protocol ?? before.code_protocol,
        body.code_type ?? before.code_type,
        body.description ?? before.description,
        ownerId,
        id
      ]
    );
    const after = await getMountpoint(id);
    await writeAudit(adminPool, req.auth!.id, 'update', 'mountpoint', id, before, after, ipFrom(req));
    res.json({ item: after });
  })
);

mountpointsRouter.delete(
  '/:id',
  requirePermission('mountpoints', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getMountpoint(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy mountpoint');
    await assertRecordScope(req, before.owner_web_user_id);
    await adminPool.query('DELETE FROM mountpoints WHERE id = ?', [id]);
    await writeAudit(adminPool, req.auth!.id, 'delete', 'mountpoint', id, before, null, ipFrom(req));
    res.status(204).send();
  })
);
