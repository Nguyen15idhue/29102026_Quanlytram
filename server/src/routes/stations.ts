import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { requirePermission } from '../middleware/auth';
import { assertRecordScope, ipFrom, listScope, pageFrom, scopeIdsFor } from '../rbac/access';

export const stationsRouter = Router();
stationsRouter.use(requireAuth);
stationsRouter.use(csrfProtection);

const createSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(160),
  host: z.string().max(190).optional().default(''),
  port: z.number().int().min(1).max(65535).optional().default(1509),
  connection_type: z.string().max(32).optional().default('ntrip'),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().max(500).optional().default(''),
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

async function getStation(id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM stations WHERE id = ?', [id]);
  return rows[0] ?? null;
}

stationsRouter.get(
  '/',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids);
    const { pageSize, offset } = pageFrom(req);
    const q = String(req.query.q || '').trim();
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    if (q) {
      where += ' AND (code LIKE ? OR name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT * FROM stations WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM stations WHERE ${where}`,
      params
    );
    res.json({ items: rows, total: Number(countRows[0].total), pageSize, offset });
  })
);

stationsRouter.get(
  '/:id',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await getStation(Number(req.params.id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    res.json({ item: station });
  })
);

stationsRouter.post(
  '/',
  requirePermission('stations', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const ownerId = await resolveOwner(req, body.owner_web_user_id);
    const [result] = await adminPool.query<any>(
      `INSERT INTO stations
         (code, name, host, port, connection_type, lat, lon, notes, owner_web_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.code,
        body.name,
        body.host,
        body.port,
        body.connection_type,
        body.lat ?? null,
        body.lon ?? null,
        body.notes,
        ownerId,
        req.auth!.id
      ]
    );
    const station = await getStation(Number(result.insertId));
    await writeAudit(adminPool, req.auth!.id, 'create', 'station', result.insertId, null, station, ipFrom(req));
    res.status(201).json({ item: station });
  })
);

stationsRouter.patch(
  '/:id',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getStation(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, before.owner_web_user_id);
    const body = updateSchema.parse(req.body);
    const ownerId =
      body.owner_web_user_id === undefined
        ? Number(before.owner_web_user_id)
        : await resolveOwner(req, body.owner_web_user_id);
    await adminPool.query(
      `UPDATE stations SET code=?, name=?, host=?, port=?, connection_type=?, lat=?, lon=?, notes=?, owner_web_user_id=?
       WHERE id=?`,
      [
        body.code ?? before.code,
        body.name ?? before.name,
        body.host ?? before.host,
        body.port ?? before.port,
        body.connection_type ?? before.connection_type,
        body.lat === undefined ? before.lat : body.lat,
        body.lon === undefined ? before.lon : body.lon,
        body.notes ?? before.notes,
        ownerId,
        id
      ]
    );
    const after = await getStation(id);
    await writeAudit(adminPool, req.auth!.id, 'update', 'station', id, before, after, ipFrom(req));
    res.json({ item: after });
  })
);

stationsRouter.delete(
  '/:id',
  requirePermission('stations', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getStation(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, before.owner_web_user_id);
    await adminPool.query('DELETE FROM stations WHERE id = ?', [id]);
    await writeAudit(adminPool, req.auth!.id, 'delete', 'station', id, before, null, ipFrom(req));
    res.status(204).send();
  })
);
