import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { writeAudit } from '../lib/audit';
import { buildWorkbook, readSheetRows, readWorkbook, sendWorkbook } from '../lib/excel';
import { asyncHandler, ApiError } from '../lib/http';
import { ecefToGeodetic, geodeticToVn2000 } from '../lib/geo';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { assertRecordScope, ipFrom, listScope, pageFrom, scopeIdsFor } from '../rbac/access';

export const stationsRouter = Router();
stationsRouter.use(requireAuth);
stationsRouter.use(csrfProtection);

const text = (max: number) => z.string().max(max).optional();
const nullableNumber = (min: number, max: number) =>
  z.number().min(min).max(max).nullable().optional();

const createSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(160),
  host: text(190),
  port: z.number().int().min(1).max(65535).optional().default(1509),
  connection_type: z.string().max(32).optional().default('ntrip'),
  source_type: z.enum(['relay_caster', 'caster_ingest', 'probe_client', 'manual']).optional().default('manual'),
  ntrip_version: z.enum(['v1', 'v2']).optional().default('v1'),
  ntrip_mode: z.enum(['v1_noauth', 'v1_auth', 'v2_auth', 'ntrip_client']).optional().default('v1_noauth'),
  lat: nullableNumber(-90, 90),
  lon: nullableNumber(-180, 180),
  notes: text(500),
  station_type: z.string().max(32).optional().default('reference'),
  enabled: z.boolean().optional().default(true),
  receiver_type: text(120),
  receiver_sn: text(80),
  receiver_firmware: text(80),
  antenna_type: text(120),
  antenna_sn: text(80),
  antenna_height: nullableNumber(-100, 100),
  elevation_mask: nullableNumber(0, 90),
  contractor: text(160),
  region: text(120),
  address: text(255),
  device_id: text(120),
  network_type: text(64),
  network_mode: text(64),
  protocol: z.string().max(64).optional().default('ntrip'),
  custom_fields: z.unknown().nullable().optional(),
  owner_web_user_id: z.number().int().positive().nullable().optional()
});

const updateSchema = createSchema.partial();

const stationColumns = `s.*, u.display_name AS owner_name,
  (SELECT COUNT(*) FROM mountpoints m WHERE m.station_id = s.id) AS mountpoint_count`;

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

async function getStation(id: number): Promise<any | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT ${stationColumns}
       FROM stations s
       LEFT JOIN web_users u ON u.id = s.owner_web_user_id
      WHERE s.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

async function qualityMap(ids: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await runtimeQuery<RowDataPacket[]>(
    `SELECT target_id, score, state, ts, arp_x, arp_y, arp_z, reported_station_id, satellites, cells, age_ms FROM (
       SELECT qs.*, ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY ts DESC) AS rn
         FROM quality_samples qs
        WHERE target_type = 'station' AND target_id IN (${placeholders})
     ) ranked WHERE rn = 1`,
    ids
  );
  for (const row of rows as any[]) map.set(Number(row.target_id), row);
  return map;
}

async function relayMap(ids: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query<RowDataPacket[]>(
    `SELECT m.station_id, r.id AS relay_job_id, r.name AS relay_job_name,
            r.upstream_host, r.upstream_port, r.upstream_mount, r.upstream_ntrip_version,
            r.upstream_credential_id,
            CASE
              WHEN r.upstream_ntrip_version = 'v1' AND r.upstream_credential_id IS NULL THEN 'v1_noauth'
              WHEN r.upstream_ntrip_version = 'v1' THEN 'v1_auth'
              ELSE 'v2_auth'
            END AS relay_ntrip_mode
       FROM relay_jobs r
       JOIN mountpoints m ON m.name = r.upstream_mount
      WHERE r.deleted_at IS NULL AND m.station_id IN (${placeholders})
      ORDER BY r.id`,
    ids
  );
  for (const row of rows as any[]) {
    if (!map.has(Number(row.station_id))) map.set(Number(row.station_id), row);
  }
  return map;
}

async function probeMap(ids: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query<RowDataPacket[]>(
    `SELECT station_id, enabled, probe_interval_sec
       FROM station_probes WHERE station_id IN (${placeholders})`,
    ids
  );
  for (const row of rows as any[]) map.set(Number(row.station_id), row);
  return map;
}

function withQuality(
  row: any,
  quality: Map<number, any>,
  relays: Map<number, any>,
  probes: Map<number, any>
) {
  const item = quality.get(Number(row.id));
  const relay = relays.get(Number(row.id));
  const probe = probes.get(Number(row.id));
  const sourceType = relay
    ? 'relay_caster'
    : probe?.enabled
      ? 'probe_client'
      : row.source_type || 'manual';
  const ntripVersion = relay?.upstream_ntrip_version || row.ntrip_version || 'v1';
  const ntripMode = relay?.relay_ntrip_mode || row.ntrip_mode || 'v1_noauth';
  let reportedLat: number | null = null;
  let reportedLon: number | null = null;
  let reportedHeight: number | null = null;
  let itrfX: number | null = null;
  let itrfY: number | null = null;
  let itrfZ: number | null = null;
  let vn2000Easting: number | null = null;
  let vn2000Northing: number | null = null;
  if (
    item &&
    item.arp_x !== null &&
    item.arp_x !== undefined &&
    item.arp_y !== null &&
    item.arp_y !== undefined &&
    item.arp_z !== null &&
    item.arp_z !== undefined
  ) {
    const x = Number(item.arp_x) / 10000;
    const y = Number(item.arp_y) / 10000;
    const z = Number(item.arp_z) / 10000;
    const geodetic = ecefToGeodetic(x, y, z);
    const vn2000 = geodeticToVn2000(geodetic.lat, geodetic.lon);
    reportedLat = geodetic.lat;
    reportedLon = geodetic.lon;
    reportedHeight = geodetic.height;
    itrfX = x;
    itrfY = y;
    itrfZ = z;
    vn2000Easting = vn2000.easting;
    vn2000Northing = vn2000.northing;
  }
  return {
    ...row,
    owner_name: row.owner_name ?? '',
    mountpoint_count: Number(row.mountpoint_count ?? 0),
    source_type: sourceType,
    ntrip_version: ntripVersion,
    ntrip_mode: ntripMode,
    relay_job_id: relay?.relay_job_id ?? null,
    relay_job_name: relay?.relay_job_name ?? null,
    relay_upstream_host: relay?.upstream_host ?? null,
    relay_upstream_port: relay?.upstream_port ?? null,
    relay_upstream_mount: relay?.upstream_mount ?? null,
    probe_enabled: Boolean(probe?.enabled),
    probe_interval_sec: probe?.probe_interval_sec ?? null,
    reported_lat: reportedLat,
    reported_lon: reportedLon,
    reported_height: reportedHeight,
    itrf_x: itrfX,
    itrf_y: itrfY,
    itrf_z: itrfZ,
    vn2000_easting: vn2000Easting,
    vn2000_northing: vn2000Northing,
    coordinate_source: reportedLat === null ? 'none' : '1005/1006',
    reported_station_id: item?.reported_station_id ?? null,
    quality_score: item ? Number(item.score) : null,
    quality_state: item ? String(item.state) : 'unknown',
    last_data_at: item ? item.ts : null
  };
}

function whereFrom(req: any, scope: any, params: unknown[]) {
  let where = scope.sql;
  const q = String(req.query.q || '').trim();
  const region = String(req.query.region || '').trim();
  const owner = Number(req.query.owner || 0);
  const receiver = String(req.query.receiver || '').trim();
  if (q) {
    where += ' AND (s.code LIKE ? OR s.name LIKE ? OR s.address LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (region) {
    where += ' AND s.region = ?';
    params.push(region);
  }
  if (owner > 0) {
    where += ' AND s.owner_web_user_id = ?';
    params.push(owner);
  }
  if (receiver) {
    where += ' AND s.receiver_type = ?';
    params.push(receiver);
  }
  return where;
}

stationsRouter.get(
  '/',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids);
    const { pageSize, offset } = pageFrom(req);
    const params: unknown[] = [...scope.params];
    const where = whereFrom(req, scope, params);
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT ${stationColumns}
         FROM stations s
         LEFT JOIN web_users u ON u.id = s.owner_web_user_id
        WHERE ${where}
        ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM stations s WHERE ${where}`,
      params
    );
    const idsForMeta = rows.map((row) => Number(row.id));
    const [quality, relays, probes] = await Promise.all([
      qualityMap(idsForMeta),
      relayMap(idsForMeta),
      probeMap(idsForMeta)
    ]);
    res.json({
      items: rows.map((row) => withQuality(row, quality, relays, probes)),
      total: Number(countRows[0].total),
      pageSize,
      offset
    });
  })
);

stationsRouter.get(
  '/export',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids);
    const params: unknown[] = [...scope.params];
    const where = whereFrom(req, scope, params);
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT ${stationColumns}
         FROM stations s
         LEFT JOIN web_users u ON u.id = s.owner_web_user_id
        WHERE ${where} ORDER BY s.code`,
      params
    );
    const headers = [
      'code', 'name', 'station_type', 'enabled', 'host', 'port', 'connection_type',
      'source_type', 'ntrip_version', 'ntrip_mode',
      'lat', 'lon', 'region', 'address', 'contractor', 'receiver_type', 'receiver_sn',
      'receiver_firmware', 'antenna_type', 'antenna_sn', 'antenna_height',
      'elevation_mask', 'device_id', 'network_type', 'network_mode', 'protocol',
      'owner_username', 'notes'
    ];
    const data = rows.map((row) => [
      row.code, row.name, row.station_type, row.enabled ? '1' : '0', row.host, row.port,
      row.connection_type, row.source_type, row.ntrip_version, row.ntrip_mode,
      row.lat, row.lon, row.region, row.address, row.contractor,
      row.receiver_type, row.receiver_sn, row.receiver_firmware, row.antenna_type,
      row.antenna_sn, row.antenna_height, row.elevation_mask, row.device_id,
      row.network_type, row.network_mode, row.protocol, row.owner_name, row.notes
    ]);
    const buffer = await buildWorkbook(headers, data, 'Stations');
    sendWorkbook(res, buffer, `stations-${Date.now()}.xlsx`);
  })
);

stationsRouter.post(
  '/import',
  requirePermission('stations', 'add'),
  asyncHandler(async (req, res) => {
    const body = z.object({ dataBase64: z.string().min(1), dryRun: z.boolean().optional() }).parse(req.body);
    const workbook = await readWorkbook(body.dataBase64);
    const rows = readSheetRows(workbook);
    const errors: string[] = [];
    const normalized: any[] = [];

    rows.forEach((row, index) => {
      const line = index + 2;
      const num = (key: string) => {
        const value = row[key];
        if (value === undefined || value === '') return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : NaN;
      };
      const candidate = {
        code: row.code ?? '',
        name: row.name ?? '',
        station_type: row.station_type || 'reference',
        enabled: row.enabled === undefined || row.enabled === '' || ['1', 'true', 'yes'].includes(String(row.enabled).toLowerCase()),
        host: row.host ?? '',
        port: num('port') ?? 1509,
        connection_type: row.connection_type || 'ntrip',
        source_type: row.source_type || 'manual',
        ntrip_version: row.ntrip_version || 'v1',
        ntrip_mode: row.ntrip_mode || 'v1_noauth',
        lat: num('lat') ?? null,
        lon: num('lon') ?? null,
        notes: row.notes ?? '',
        receiver_type: row.receiver_type ?? '',
        receiver_sn: row.receiver_sn ?? '',
        receiver_firmware: row.receiver_firmware ?? '',
        antenna_type: row.antenna_type ?? '',
        antenna_sn: row.antenna_sn ?? '',
        antenna_height: num('antenna_height') ?? null,
        elevation_mask: num('elevation_mask') ?? null,
        contractor: row.contractor ?? '',
        region: row.region ?? '',
        address: row.address ?? '',
        device_id: row.device_id ?? '',
        network_type: row.network_type ?? '',
        network_mode: row.network_mode ?? '',
        protocol: row.protocol || 'ntrip',
        owner_username: row.owner_username ?? ''
      };
      if ([candidate.port, candidate.lat, candidate.lon].some((value) => Number.isNaN(value))) {
        errors.push(`Line ${line} column number invalid`);
        return;
      }
      const parsed = createSchema.safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push(`Line ${line} column ${issue.path.join('.') || 'row'} ${issue.message}`);
        }
        return;
      }
      normalized.push({ data: parsed.data, ownerUsername: candidate.owner_username });
    });

    if (body.dryRun) {
      res.json({ items: normalized.map((item) => item.data), errors, total: normalized.length });
      return;
    }
    if (errors.length > 0) throw new ApiError(400, 'VALIDATION_ERROR', errors.join('; '));

    let created = 0;
    let updated = 0;
    await withTransaction(async (conn) => {
      for (const item of normalized) {
        const [ownerRows]: any = await conn.query(
          'SELECT id FROM web_users WHERE username = ? LIMIT 1',
          [item.ownerUsername]
        );
        const ownerId = ownerRows[0]?.id ?? req.auth!.id;
        const data = item.data;
        const [existing]: any = await conn.query('SELECT id FROM stations WHERE code = ? LIMIT 1', [data.code]);
        const values = [
          data.code, data.name, data.host ?? '', data.port, data.connection_type,
          data.source_type, data.ntrip_version, data.ntrip_mode, data.lat, data.lon,
          data.notes ?? '', data.station_type, data.enabled, data.receiver_type ?? '',
          data.receiver_sn ?? '', data.receiver_firmware ?? '', data.antenna_type ?? '',
          data.antenna_sn ?? '', data.antenna_height, data.elevation_mask, data.contractor ?? '',
          data.region ?? '', data.address ?? '', data.device_id ?? '', data.network_type ?? '',
          data.network_mode ?? '', data.protocol,
          data.custom_fields === undefined ? null : JSON.stringify(data.custom_fields), ownerId
        ];
        if (existing[0]) {
          await conn.query(
            `UPDATE stations SET name=?, host=?, port=?, connection_type=?,
               source_type=?, ntrip_version=?, ntrip_mode=?, lat=?, lon=?, notes=?,
               station_type=?, enabled=?, receiver_type=?, receiver_sn=?, receiver_firmware=?,
               antenna_type=?, antenna_sn=?, antenna_height=?, elevation_mask=?, contractor=?,
               region=?, address=?, device_id=?, network_type=?, network_mode=?, protocol=?,
               custom_fields=?, owner_web_user_id=? WHERE id=?`,
            [...values.slice(1), Number(existing[0].id)]
          );
          updated += 1;
        } else {
          await conn.query(
            `INSERT INTO stations
              (code, name, host, port, connection_type, source_type, ntrip_version, ntrip_mode,
               lat, lon, notes, station_type, enabled,
               receiver_type, receiver_sn, receiver_firmware, antenna_type, antenna_sn,
               antenna_height, elevation_mask, contractor, region, address, device_id,
               network_type, network_mode, protocol, custom_fields, owner_web_user_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [...values, req.auth!.id]
          );
          created += 1;
        }
      }
    });
    await writeAudit(adminPool, req.auth!.id, 'import', 'station', '', null, { created, updated }, ipFrom(req));
    res.json({ created, updated, total: normalized.length });
  })
);

stationsRouter.get(
  '/:id',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await getStation(Number(req.params.id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const idsForMeta = [Number(station.id)];
    const [quality, relays, probes] = await Promise.all([
      qualityMap(idsForMeta),
      relayMap(idsForMeta),
      probeMap(idsForMeta)
    ]);
    res.json({ item: withQuality(station, quality, relays, probes) });
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
         (code, name, host, port, connection_type, source_type, ntrip_version, ntrip_mode,
          lat, lon, notes, station_type, enabled,
          receiver_type, receiver_sn, receiver_firmware, antenna_type, antenna_sn,
          antenna_height, elevation_mask, contractor, region, address, device_id,
          network_type, network_mode, protocol, custom_fields, owner_web_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.code, body.name, body.host ?? '', body.port, body.connection_type,
        body.source_type, body.ntrip_version, body.ntrip_mode,
        body.lat ?? null, body.lon ?? null, body.notes ?? '', body.station_type,
        body.enabled, body.receiver_type ?? '', body.receiver_sn ?? '',
        body.receiver_firmware ?? '', body.antenna_type ?? '', body.antenna_sn ?? '',
        body.antenna_height ?? null, body.elevation_mask ?? null, body.contractor ?? '',
        body.region ?? '', body.address ?? '', body.device_id ?? '', body.network_type ?? '',
        body.network_mode ?? '', body.protocol,
        body.custom_fields === undefined ? null : JSON.stringify(body.custom_fields),
        ownerId, req.auth!.id
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
    const value = (key: string) =>
      body[key as keyof typeof body] === undefined ? before[key] : body[key as keyof typeof body];
    await adminPool.query(
      `UPDATE stations SET code=?, name=?, host=?, port=?, connection_type=?,
         source_type=?, ntrip_version=?, ntrip_mode=?, lat=?, lon=?, notes=?,
         station_type=?, enabled=?, receiver_type=?, receiver_sn=?, receiver_firmware=?,
         antenna_type=?, antenna_sn=?, antenna_height=?, elevation_mask=?, contractor=?,
         region=?, address=?, device_id=?, network_type=?, network_mode=?, protocol=?,
         custom_fields=?, owner_web_user_id=? WHERE id=?`,
      [
        value('code'), value('name'), value('host'), value('port'), value('connection_type'),
        value('source_type'), value('ntrip_version'), value('ntrip_mode'),
        value('lat'), value('lon'), value('notes'), value('station_type'), value('enabled'),
        value('receiver_type'), value('receiver_sn'), value('receiver_firmware'),
        value('antenna_type'), value('antenna_sn'), value('antenna_height'), value('elevation_mask'),
        value('contractor'), value('region'), value('address'), value('device_id'),
        value('network_type'), value('network_mode'), value('protocol'),
        body.custom_fields === undefined ? before.custom_fields : JSON.stringify(body.custom_fields),
        ownerId, id
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
