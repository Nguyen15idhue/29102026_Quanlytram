import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { writeAudit } from '../lib/audit';
import { bulkBodySchema, emptyBulkResult, uniqueIds } from '../lib/bulk';
import { type GoConnection, publicConnection } from '../lib/caster';
import { buildWorkbook, readSheetRows, readWorkbook, sendWorkbook } from '../lib/excel';
import { asyncHandler, ApiError } from '../lib/http';
import { ecefToGeodetic, geodeticToVn2000 } from '../lib/geo';
import { encryptSecret } from '../lib/crypto';
import { callGoInternal } from '../lib/internalApi';
import {
  fetchLiveQuality,
  mapSample,
  parseWindowMinutes,
  type QualityLive
} from '../lib/quality';
import {
  buildReliability,
  metadataStatusFor,
  qualityStatusFor,
  sampleHasArp,
  sampleMetadataOk,
  transportStatusFor
} from '../lib/stationDetail';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import {
  assertRecordScope,
  ipFrom,
  listScope,
  pageFrom,
  requireBulkPermission,
  scopeIdsFor
} from '../rbac/access';

export const stationsRouter = Router();
stationsRouter.use(requireAuth);
stationsRouter.use(csrfProtection);

const text = (max: number) => z.string().max(max).optional();
const nullableNumber = (min: number, max: number) =>
  z.number().min(min).max(max).nullable().optional();

const createSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
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
  coordinate_type: z.enum(['wgs84', 'vn2000', 'itrf']).optional().default('wgs84'),
  province: text(120),
  ward: text(120),
  address_detail: text(255),
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
      throw new ApiError(403, 'FORBIDDEN', 'Chá»§ sá»Ÿ há»¯u ngoĂ i pháº¡m vi quáº£n lĂ½');
    }
  }
  const exists = await query<RowDataPacket[]>('SELECT id FROM web_users WHERE id = ?', [requested]);
  if (exists.length === 0) throw new ApiError(400, 'INVALID_OWNER', 'Chá»§ sá»Ÿ há»¯u khĂ´ng tá»“n táº¡i');
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
    `SELECT target_id, score, state, ts, arp_x, arp_y, arp_z, reported_station_id,
            satellites, cells, msm_epochs, antenna, age_ms FROM (
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
  const sampleAgeMs = item?.ts ? Math.max(0, Date.now() - new Date(item.ts).getTime()) : null;
  const hasMsm = Number(item?.cells ?? 0) > 0 || Number(item?.msm_epochs ?? 0) > 0;
  return {
    ...row,
    transportStatus: transportStatusFor(item?.state, sampleAgeMs),
    qualityStatus: qualityStatusFor({
      score: item ? Number(item.score) : null,
      state: item?.state,
      metadataOk: sampleMetadataOk(item),
      hasMsm
    }),
    metadataStatus: metadataStatusFor({
      present: Boolean(item),
      streaming: String(item?.state ?? '') === 'streaming',
      reportedStationId: item?.reported_station_id,
      hasArp: sampleHasArp(item),
      antenna: item?.antenna
    }),
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

async function stationSampleRows(id: number, windowSec = 900): Promise<any[]> {
  return runtimeQuery<RowDataPacket[]>(
    `SELECT ts, score, state, frames, bytes, crc_errors, parse_errors, msm_epochs,
            satellites, signals, cells, avg_cnr, reported_station_id, arp_x, arp_y, arp_z,
            arp_delta_m, antenna, age_ms, gaps, cnr_available, details
       FROM quality_samples
      WHERE target_type = 'station' AND target_id = ? AND ts >= ?
      ORDER BY ts DESC
      LIMIT 2000`,
    [id, new Date(Date.now() - windowSec * 1000)]
  );
}

async function scopedStation(req: any, id: number): Promise<any> {
  const station = await getStation(id);
  if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
  await assertRecordScope(req, station.owner_web_user_id);
  return station;
}

function statusesForLive(live: QualityLive) {
  const hasArp =
    live.arpX !== null &&
    live.arpX !== undefined &&
    live.arpY !== null &&
    live.arpY !== undefined &&
    live.arpZ !== null &&
    live.arpZ !== undefined;
  return {
    transportStatus: transportStatusFor(live.state, live.ageMs),
    qualityStatus: qualityStatusFor({
      score: live.score,
      state: live.state,
      metadataOk: live.metadataOk,
      hasMsm: Number(live.cells ?? 0) > 0 || Number(live.msmEpochs ?? 0) > 0
    }),
    metadataStatus: metadataStatusFor({
      present: true,
      streaming: live.state === 'streaming',
      reportedStationId: live.reportedStationId,
      hasArp,
      antenna: live.antenna
    })
  };
}

async function latestLiveStation(id: number): Promise<QualityLive | null> {
  try {
    const live = await fetchLiveQuality(1200);
    return (
      live.items.find(
        (item) =>
          item.targetType === 'station' && item.targetId === id && item.direction === 'ingest'
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function casterConnectionsFor(mountpointIds: number[]): Promise<{
  available: boolean;
  items: GoConnection[];
}> {
  if (mountpointIds.length === 0) return { available: true, items: [] };
  try {
    const response = await callGoInternal<{ items: GoConnection[] }>(
      '/internal/caster/connections',
      undefined,
      { method: 'GET', timeoutMs: 2000 }
    );
    const ids = new Set(mountpointIds.map(Number));
    return {
      available: true,
      items: (response?.items ?? []).filter((item) => ids.has(Number(item.mountpointId)))
    };
  } catch {
    return { available: false, items: [] };
  }
}

function parseHistoryBoundary(raw: unknown, label: string): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label} khĂ´ng há»£p lá»‡`);
  }
  return date;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function whereFrom(req: any, scope: any, params: unknown[]) {
  let where = scope.sql;
  const q = String(req.query.q || '').trim();
  const region = String(req.query.region || '').trim();
  const owner = Number(req.query.owner || 0);
  const receiver = String(req.query.receiver || '').trim();
  const enabled = String(req.query.enabled || '').trim();
  const sourceType = String(req.query.sourceType || '').trim();
  if (q) {
    where += ' AND (s.code LIKE ? OR s.name LIKE ? OR s.address LIKE ? OR s.region LIKE ? OR s.host LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (enabled === '0' || enabled === '1') {
    where += ' AND s.enabled = ?';
    params.push(Number(enabled));
  }
  if (['relay_caster', 'caster_ingest', 'probe_client', 'manual'].includes(sourceType)) {
    where += ' AND s.source_type = ?';
    params.push(sourceType);
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
    const station = await scopedStation(req, Number(req.params.id));
    const id = Number(station.id);
    const [quality, relays, probes, samples, live] = await Promise.all([
      qualityMap([id]),
      relayMap([id]),
      probeMap([id]),
      stationSampleRows(id),
      latestLiveStation(id)
    ]);
    const reliability = buildReliability(samples, { windowSec: 900 });
    const item = withQuality(station, quality, relays, probes);
    res.json({
      item: {
        ...item,
        ...(live ? statusesForLive(live) : {}),
        reliability
      }
    });
  })
);

stationsRouter.get(
  '/:id/connections',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await scopedStation(req, Number(req.params.id));
    const stationId = Number(station.id);
    const mountpointRows = await query<RowDataPacket[]>(
      `SELECT id, name, enabled, requires_auth, service_type, position_mode,
              satellite_systems, caster_interval, code_protocol, code_type, description
         FROM mountpoints WHERE station_id = ? ORDER BY name`,
      [stationId]
    );
    const mountpointIds = mountpointRows.map((row) => Number(row.id));

    const [listenerRows, relayRows, probeRows] = await Promise.all([
      mountpointIds.length
        ? query<RowDataPacket[]>(
            `SELECT lm.mountpoint_id, l.id, l.name, l.port, l.enabled, l.role
               FROM caster_listener_mountpoints lm
               JOIN caster_listeners l ON l.id = lm.listener_id
              WHERE lm.mountpoint_id IN (${mountpointIds.map(() => '?').join(',')})
              ORDER BY l.port, l.name`,
            mountpointIds
          )
        : Promise.resolve([]),
      query<RowDataPacket[]>(
        `SELECT r.id, r.name, r.enabled, r.desired_revision,
                r.upstream_host, r.upstream_port, r.upstream_mount, r.upstream_ssl,
                r.upstream_ntrip_version, r.upstream_credential_id,
                r.downstream_host, r.downstream_port, r.downstream_mount, r.downstream_ssl,
                r.downstream_ntrip_version, r.downstream_credential_id, r.downstream_mode,
                r.origin, r.updated_at
           FROM relay_jobs r
           JOIN mountpoints m ON m.name = r.upstream_mount
          WHERE m.station_id = ? AND r.deleted_at IS NULL
          ORDER BY r.id`,
        [stationId]
      ),
      query<RowDataPacket[]>(
        `SELECT id, mountpoint_id, enabled, probe_interval_sec, credential_id
           FROM station_probes WHERE station_id = ? ORDER BY id`,
        [stationId]
      )
    ]);

    const relayIds = relayRows.map((row) => Number(row.id));
    const [stateRows, sessionRows, caster] = await Promise.all([
      relayIds.length
        ? runtimeQuery<RowDataPacket[]>(
            `SELECT * FROM relay_job_state
              WHERE relay_job_id IN (${relayIds.map(() => '?').join(',')})`,
            relayIds
          )
        : Promise.resolve([]),
      relayIds.length
        ? runtimeQuery<RowDataPacket[]>(
            `SELECT * FROM (
               SELECT rs.*, ROW_NUMBER() OVER (
                 PARTITION BY relay_job_id ORDER BY start_ts DESC, id DESC
               ) AS rn
                 FROM relay_sessions rs
                WHERE relay_job_id IN (${relayIds.map(() => '?').join(',')})
             ) ranked WHERE rn = 1`,
            relayIds
          )
        : Promise.resolve([]),
      casterConnectionsFor(mountpointIds)
    ]);

    const stateMap = new Map<number, any>();
    for (const row of stateRows) stateMap.set(Number(row.relay_job_id), row);
    const sessionMap = new Map<number, any>();
    for (const row of sessionRows) sessionMap.set(Number(row.relay_job_id), row);
    const listenerMap = new Map<number, any[]>();
    for (const row of listenerRows) {
      const list = listenerMap.get(Number(row.mountpoint_id)) ?? [];
      list.push({
        id: Number(row.id),
        name: String(row.name),
        port: Number(row.port),
        enabled: Boolean(row.enabled),
        role: String(row.role)
      });
      listenerMap.set(Number(row.mountpoint_id), list);
    }

    const accountIds = [
      ...new Set(
        caster.items
          .map((item) => item.accountId)
          .filter((id): id is number => id !== null && id !== undefined)
          .map(Number)
      )
    ];
    const accountNames = new Map<number, string>();
    if (accountIds.length > 0) {
      const rows = await query<RowDataPacket[]>(
        `SELECT id, username FROM ntrip_accounts
          WHERE id IN (${accountIds.map(() => '?').join(',')})`,
        accountIds
      );
      for (const row of rows) accountNames.set(Number(row.id), String(row.username));
    }
    const listenerNames = new Map<number, string>();
    for (const row of listenerRows) {
      listenerNames.set(Number(row.id), String(row.name));
    }
    const mountpointNames = new Map<number, string>();
    for (const row of mountpointRows) {
      mountpointNames.set(Number(row.id), String(row.name));
    }
    const online = caster.items.map((item) =>
      publicConnection(
        item,
        listenerNames.get(Number(item.listenerId)),
        mountpointNames.get(Number(item.mountpointId)),
        item.accountId === null ? undefined : accountNames.get(Number(item.accountId))
      )
    );
    const onlineByMountpoint = new Map<number, any[]>();
    for (const connection of online) {
      const list = onlineByMountpoint.get(connection.mountpointId) ?? [];
      list.push(connection);
      onlineByMountpoint.set(connection.mountpointId, list);
    }

    const mountpoints = mountpointRows.map((row) => {
      const id = Number(row.id);
      const name = String(row.name);
      return {
        id,
        name,
        enabled: Boolean(row.enabled),
        requiresAuth: Boolean(row.requires_auth),
        serviceType: String(row.service_type ?? ''),
        positionMode: String(row.position_mode ?? ''),
        satelliteSystems: String(row.satellite_systems ?? ''),
        casterInterval: Number(row.caster_interval ?? 0),
        codeProtocol: String(row.code_protocol ?? ''),
        codeType: String(row.code_type ?? ''),
        description: String(row.description ?? ''),
        listeners: listenerMap.get(id) ?? [],
        relays: relayRows
          .filter((relay) => String(relay.upstream_mount).toLowerCase() === name.toLowerCase())
          .map((relay) => {
            const relayId = Number(relay.id);
            const state = stateMap.get(relayId);
            const session = sessionMap.get(relayId);
            return {
              id: relayId,
              name: String(relay.name),
              enabled: Boolean(relay.enabled),
              desiredRevision: Number(relay.desired_revision ?? 0),
              appliedRevision: state ? Number(state.applied_revision ?? 0) : null,
              runtimeState: state ? String(state.runtime_state) : 'unknown',
              lastAppliedAt: state?.last_applied_at ?? null,
              lastError: state?.last_error ?? null,
              upstream: {
                host: String(relay.upstream_host),
                port: Number(relay.upstream_port),
                mount: String(relay.upstream_mount),
                ssl: Boolean(relay.upstream_ssl),
                ntripVersion: String(relay.upstream_ntrip_version),
                hasCredential: relay.upstream_credential_id !== null
              },
              downstream: {
                host: String(relay.downstream_host),
                port: Number(relay.downstream_port),
                mount: String(relay.downstream_mount),
                ssl: Boolean(relay.downstream_ssl),
                ntripVersion: String(relay.downstream_ntrip_version),
                hasCredential: relay.downstream_credential_id !== null,
                mode: String(relay.downstream_mode)
              },
              origin: String(relay.origin ?? ''),
              updatedAt: relay.updated_at,
              lastSession: session
                ? {
                    id: Number(session.id),
                    startTs: session.start_ts,
                    endTs: session.end_ts,
                    durationSec:
                      session.duration_sec === null ? null : Number(session.duration_sec),
                    result: String(session.result ?? ''),
                    closeReason: String(session.close_reason ?? ''),
                    message: String(session.message ?? '')
                  }
                : null
            };
          }),
        onlineConnections: onlineByMountpoint.get(id) ?? []
      };
    });

    const probes = probeRows.map((row) => ({
      id: Number(row.id),
      mountpointId: row.mountpoint_id === null ? null : Number(row.mountpoint_id),
      enabled: Boolean(row.enabled),
      probeIntervalSec: Number(row.probe_interval_sec),
      hasCredential: row.credential_id !== null
    }));

    res.json({
      stationId,
      generatedAt: new Date().toISOString(),
      casterAvailable: caster.available,
      summary: {
        mountpoints: mountpoints.length,
        relays: relayRows.length,
        listeners: new Set(listenerRows.map((row) => Number(row.id))).size,
        probes: probes.length,
        onlineConnections: online.length
      },
      mountpoints,
      probes,
      onlineConnections: online,
      probeHistory: {
        available: false,
        message: 'Chưa lưu lịch sử probe; chỉ có cấu hình probe hiện tại.'
      }
    });
  })
);

stationsRouter.get(
  '/:id/history',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await scopedStation(req, Number(req.params.id));
    const stationId = Number(station.id);
    const { pageSize, offset } = pageFrom(req);
    const to = parseHistoryBoundary(req.query.to, 'Äáº¿n ngĂ y') ?? new Date();
    const from =
      parseHistoryBoundary(req.query.from, 'Tá»« ngĂ y') ??
      new Date(to.getTime() - 24 * 3600_000);
    if (from.getTime() > to.getTime()) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Từ ngày phải trước đến ngày');
    }

    const events: Array<{
      id: string;
      source: 'quality' | 'caster' | 'relay' | 'audit';
      type: string;
      at: string;
      title: string;
      detail: string;
      level: string;
    }> = [];

    const qualityRows = (
      await runtimeQuery<RowDataPacket[]>(
        `SELECT ts, score, state, frames, bytes, crc_errors, age_ms, gaps
           FROM quality_samples
          WHERE target_type = 'station' AND target_id = ? AND direction = 'ingest'
            AND ts >= ? AND ts <= ?
          ORDER BY ts DESC
          LIMIT 5000`,
        [stationId, from, to]
      )
    ).reverse();
    let previous: any = null;
    qualityRows.forEach((row, index) => {
      const at = iso(row.ts);
      if (!at) return;
      const state = String(row.state ?? 'unknown');
      const score = Number(row.score ?? 0);
      if (!previous) {
        events.push({
          id: `quality:${index}:${at}`,
          source: 'quality',
          type: 'quality_start',
          at,
          title: 'Bắt đầu có dữ liệu chất lượng',
          detail: `Score ${score} · ${state}`,
          level: state === 'error' ? 'critical' : state === 'stale' ? 'warning' : 'info'
        });
      } else if (state !== previous.state) {
        events.push({
          id: `quality:${index}:${at}`,
          source: 'quality',
          type: 'quality_state',
          at,
          title: `Chất lượng đổi trạng thái: ${previous.state} → ${state}`,
          detail: `Score ${score} · frame ${Number(row.frames ?? 0)} · CRC ${Number(row.crc_errors ?? 0)}`,
          level: state === 'error' ? 'critical' : state === 'stale' ? 'warning' : 'info'
        });
      } else if (Math.abs(score - Number(previous.score ?? 0)) >= 5) {
        events.push({
          id: `quality:${index}:${at}`,
          source: 'quality',
          type: 'quality_score',
          at,
          title: `Điểm chất lượng đổi ${Number(previous.score ?? 0)} → ${score}`,
          detail: `Frame ${Number(row.frames ?? 0)} · age ${Number(row.age_ms ?? 0)} ms · gap ${Number(row.gaps ?? 0)}`,
          level: score < 60 ? 'critical' : score < 85 ? 'warning' : 'info'
        });
      }
      previous = row;
    });

    const stationMountpoints = await query<RowDataPacket[]>(
      'SELECT id, name FROM mountpoints WHERE station_id = ?',
      [stationId]
    );
    const mountpointIds = stationMountpoints.map((row) => Number(row.id));
    const mountpointNames = new Map<number, string>();
    for (const row of stationMountpoints) {
      mountpointNames.set(Number(row.id), String(row.name));
    }

    const casterRows = mountpointIds.length
      ? await runtimeQuery<RowDataPacket[]>(
          `SELECT id, mountpoint_id, remote_addr, user_agent, start_ts, end_ts,
                  bytes_in, bytes_out, disconnect_reason
             FROM caster_connections
            WHERE mountpoint_id IN (${mountpointIds.map(() => '?').join(',')})
              AND start_ts <= ? AND (end_ts IS NULL OR end_ts >= ?)
            ORDER BY start_ts DESC
            LIMIT 500`,
          [...mountpointIds, to, from]
        )
      : [];
    for (const row of casterRows) {
      const mountpointName = mountpointNames.get(Number(row.mountpoint_id)) ?? '—';
      const startAt = iso(row.start_ts);
      if (startAt && new Date(startAt) >= from) {
        events.push({
          id: `caster:${Number(row.id)}:open`,
          source: 'caster',
          type: 'caster_open',
          at: startAt,
          title: `Mở kết nối caster · ${mountpointName}`,
          detail: `${String(row.remote_addr || '—')}${row.user_agent ? ` · ${String(row.user_agent)}` : ''}`,
          level: 'info'
        });
      }
      const endAt = iso(row.end_ts);
      if (endAt && new Date(endAt) >= from && new Date(endAt) <= to) {
        events.push({
          id: `caster:${Number(row.id)}:close`,
          source: 'caster',
          type: 'caster_close',
          at: endAt,
          title: `Đóng kết nối caster · ${mountpointName}`,
          detail: `${String(row.disconnect_reason || 'unknown')} · in ${Number(row.bytes_in ?? 0)} B · out ${Number(row.bytes_out ?? 0)} B`,
          level: row.disconnect_reason ? 'warning' : 'info'
        });
      }
    }

    const mountNameSet = new Set(
      stationMountpoints.map((row) => String(row.name).toLowerCase())
    );
    const stationRelayJobs = (
      await query<RowDataPacket[]>(
        `SELECT id, name, upstream_mount FROM relay_jobs WHERE deleted_at IS NULL`
      )
    ).filter((row) => mountNameSet.has(String(row.upstream_mount).toLowerCase()));
    const relayJobNames = new Map<number, string>();
    for (const row of stationRelayJobs) {
      relayJobNames.set(Number(row.id), String(row.name));
    }
    const relayIds = stationRelayJobs.map((row) => Number(row.id));
    const relayRows = relayIds.length
      ? await runtimeQuery<RowDataPacket[]>(
          `SELECT id, relay_job_id, start_ts, end_ts, duration_sec, result,
                  close_reason, message
             FROM relay_sessions
            WHERE relay_job_id IN (${relayIds.map(() => '?').join(',')})
              AND start_ts <= ? AND (end_ts IS NULL OR end_ts >= ?)
            ORDER BY start_ts DESC
            LIMIT 500`,
          [...relayIds, to, from]
        )
      : [];
    for (const row of relayRows) {
      const jobName = relayJobNames.get(Number(row.relay_job_id)) ?? `#${row.relay_job_id}`;
      const startAt = iso(row.start_ts);
      if (startAt && new Date(startAt) >= from) {
        events.push({
          id: `relay:${Number(row.id)}:start`,
          source: 'relay',
          type: 'relay_start',
          at: startAt,
          title: `Relay bắt đầu · ${jobName}`,
          detail: `Job #${Number(row.relay_job_id)}`,
          level: 'info'
        });
      }
      const endAt = iso(row.end_ts);
      if (endAt && new Date(endAt) >= from && new Date(endAt) <= to) {
        events.push({
          id: `relay:${Number(row.id)}:end`,
          source: 'relay',
          type: 'relay_end',
          at: endAt,
          title: `Relay kết thúc · ${jobName}`,
          detail: `${String(row.result || row.close_reason || 'unknown')} · ${Number(row.duration_sec ?? 0)} giây${row.message ? ` · ${String(row.message)}` : ''}`,
          level: row.close_reason === 'network' || row.close_reason === 'timeout' ? 'warning' : 'info'
        });
      }
    }

    const auditRows = await query<RowDataPacket[]>(
      `SELECT a.id, a.action, a.created_at, u.username AS actor_name
         FROM audit_logs a
         LEFT JOIN web_users u ON u.id = a.actor_web_user_id
        WHERE a.entity_type = 'station' AND a.entity_id = ?
          AND a.created_at >= ? AND a.created_at <= ?
        ORDER BY a.created_at DESC
        LIMIT 500`,
      [String(stationId), from, to]
    );
    for (const row of auditRows) {
      const at = iso(row.created_at);
      if (!at) continue;
      events.push({
        id: `audit:${Number(row.id)}`,
        source: 'audit',
        type: 'audit',
        at,
        title: `Cấu hình trạm · ${String(row.action)}`,
        detail: `Bá»Ÿi ${String(row.actor_name || 'há»‡ thá»‘ng')}`,
        level: 'info'
      });
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const sourceCounts = {
      quality: events.filter((event) => event.source === 'quality').length,
      caster: events.filter((event) => event.source === 'caster').length,
      relay: events.filter((event) => event.source === 'relay').length,
      audit: events.filter((event) => event.source === 'audit').length
    };
    res.json({
      items: events.slice(offset, offset + pageSize),
      total: events.length,
      pageSize,
      offset,
      from: from.toISOString(),
      to: to.toISOString(),
      sources: sourceCounts,
      probeHistory: {
        available: false,
        message: 'Chưa lưu lịch sử probe; chỉ có cấu hình probe hiện tại.'
      }
    });
  })
);

stationsRouter.get(
  '/:id/metadata',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await scopedStation(req, Number(req.params.id));
    const stationId = Number(station.id);
    const windowMinutes = parseWindowMinutes(req.query.window, 120);
    const from = new Date(Date.now() - windowMinutes * 60_000);
    const [samples, messageRows] = await Promise.all([
      stationSampleRows(stationId, 900),
      runtimeQuery<RowDataPacket[]>(
        `SELECT message_type, SUM(count) AS total_count, SUM(bytes) AS total_bytes,
                MIN(hour_start_utc) AS first_hour, MAX(last_seen_at) AS last_seen_at
           FROM rtcm_message_stats
          WHERE target_type = 'station' AND target_id = ? AND direction = 'ingest'
            AND hour_start_utc >= ?
          GROUP BY message_type
          ORDER BY message_type`,
        [stationId, from]
      )
    ]);
    const latest = samples[0] ?? null;
    const totalCount = messageRows.reduce((sum, row) => sum + Number(row.total_count ?? 0), 0);
    const totalBytes = messageRows.reduce((sum, row) => sum + Number(row.total_bytes ?? 0), 0);
    const latestSample = latest ? mapSample(latest) : null;
    const hasArp = sampleHasArp(latest);
    const has1005 =
      latest?.reported_station_id !== null && latest?.reported_station_id !== undefined;
    res.json({
      stationId,
      code: String(station.code),
      name: String(station.name),
      windowMinutes,
      metadataStatus: metadataStatusFor({
        present: Boolean(latest),
        streaming: String(latest?.state ?? '') === 'streaming',
        reportedStationId: latest?.reported_station_id,
        hasArp,
        antenna: latest?.antenna
      }),
      latest: latestSample,
      metadata: {
        has1005,
        has1006: hasArp,
        reportedStationId: latest?.reported_station_id ?? null,
        arpX: hasArp ? Number(latest.arp_x) / 10000 : null,
        arpY: hasArp ? Number(latest.arp_y) / 10000 : null,
        arpZ: hasArp ? Number(latest.arp_z) / 10000 : null,
        arpDeltaM:
          latest?.arp_delta_m === null || latest?.arp_delta_m === undefined
            ? null
            : Number(latest.arp_delta_m),
        antenna: latest?.antenna ?? null,
        lastSeenAt: latestSample?.ts ?? null
      },
      messages: messageRows.map((row) => ({
        messageType: Number(row.message_type),
        count: Number(row.total_count ?? 0),
        bytes: Number(row.total_bytes ?? 0),
        ratePerMinute: Number(row.total_count ?? 0) / windowMinutes,
        lastSeenAt: row.last_seen_at
      })),
      bitrateBps: totalBytes > 0 ? (totalBytes * 8) / (windowMinutes * 60) : 0,
      messageRatePerMinute: totalCount / windowMinutes,
      reliability: buildReliability(samples, { windowSec: 900 })
    });
  })
);

stationsRouter.post(
  '/',
  requirePermission('stations', 'add'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const ownerId = await resolveOwner(req, body.owner_web_user_id);
    const code =
      body.code ?? `ST${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
    const [result] = await adminPool.query<any>(
      `INSERT INTO stations
         (code, name, host, port, connection_type, source_type, ntrip_version, ntrip_mode,
          lat, lon, notes, station_type, enabled, coordinate_type, province, ward,
          address_detail,
          receiver_type, receiver_sn, receiver_firmware, antenna_type, antenna_sn,
          antenna_height, elevation_mask, contractor, region, address, device_id,
          network_type, network_mode, protocol, custom_fields, owner_web_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code, body.name, body.host ?? '', body.port, body.connection_type,
        body.source_type, body.ntrip_version, body.ntrip_mode,
        body.lat ?? null, body.lon ?? null, body.notes ?? '', body.station_type,
        body.enabled, body.coordinate_type, body.province ?? '', body.ward ?? '',
        body.address_detail ?? '', body.receiver_type ?? '', body.receiver_sn ?? '',
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
         station_type=?, enabled=?, coordinate_type=?, province=?, ward=?, address_detail=?,
         receiver_type=?, receiver_sn=?, receiver_firmware=?,
         antenna_type=?, antenna_sn=?, antenna_height=?, elevation_mask=?, contractor=?,
         region=?, address=?, device_id=?, network_type=?, network_mode=?, protocol=?,
         custom_fields=?, owner_web_user_id=? WHERE id=?`,
      [
        value('code'), value('name'), value('host'), value('port'), value('connection_type'),
        value('source_type'), value('ntrip_version'), value('ntrip_mode'),
        value('lat'), value('lon'), value('notes'), value('station_type'), value('enabled'),
        value('coordinate_type'), value('province'), value('ward'), value('address_detail'),
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

stationsRouter.get(
  '/:id/uptime',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await getStation(Number(req.params.id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const range = String(req.query.range ?? '1d');
    const hours = range === '30d' ? 720 : range === '7d' ? 168 : 24;
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600_000);
    const mountpointRows = await query<RowDataPacket[]>(
      'SELECT id, name FROM mountpoints WHERE station_id = ?',
      [station.id]
    );
    const mountpointIds = mountpointRows.map((row) => Number(row.id));
    const mountpointNames = mountpointRows.map((row) => String(row.name));
    const connections = mountpointIds.length
      ? await runtimeQuery<RowDataPacket[]>(
          `SELECT mountpoint_id, start_ts, end_ts, disconnect_reason
             FROM caster_connections
            WHERE mountpoint_id IN (${mountpointIds.map(() => '?').join(',')})
              AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
            ORDER BY start_ts`,
          [...mountpointIds, start, end]
        )
      : [];
    const relayIds = mountpointNames.length
      ? (
          await query<RowDataPacket[]>(
            `SELECT id FROM relay_jobs
              WHERE deleted_at IS NULL
                AND (upstream_mount IN (${mountpointNames.map(() => '?').join(',')})
                  OR downstream_mount IN (${mountpointNames.map(() => '?').join(',')}))`,
            [...mountpointNames, ...mountpointNames]
          )
        ).map((row) => Number(row.id))
      : [];
    const relaySessions = relayIds.length
      ? await runtimeQuery<RowDataPacket[]>(
          `SELECT relay_job_id, start_ts, end_ts, close_reason
             FROM relay_sessions
            WHERE relay_job_id IN (${relayIds.map(() => '?').join(',')})
              AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
            ORDER BY start_ts`,
          [...relayIds, start, end]
        )
      : [];

    const buckets: Record<string, any> = {};
    const bucketKey = (date: Date) =>
      new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()))
        .toISOString();
    const ensure = (date: Date) => {
      const key = bucketKey(date);
      buckets[key] ??= {
        bucket: key,
        onlineSec: 0,
        sessions: 0,
        timeouts: 0,
        authErrors: 0,
        proxyErrors: 0,
        networkErrors: 0
      };
      return buckets[key];
    };
    const addRange = (from: Date, to: Date, reason: string) => {
      const started = new Date(Math.max(from.getTime(), start.getTime()));
      const ended = new Date(Math.min(to.getTime(), end.getTime()));
      if (ended <= started) return;
      let cursor = started;
      while (cursor < ended) {
        const nextHour = new Date(
          Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth(),
            cursor.getUTCDate(),
            cursor.getUTCHours() + 1
          )
        );
        const sliceEnd = nextHour < ended ? nextHour : ended;
        const bucket = ensure(cursor);
        bucket.onlineSec += Math.max(0, Math.round((sliceEnd.getTime() - cursor.getTime()) / 1000));
        if (reason === 'timeout') bucket.timeouts += 1;
        else if (reason === 'auth_failed') bucket.authErrors += 1;
        else if (reason === 'proxy') bucket.proxyErrors += 1;
        else if (reason === 'network') bucket.networkErrors += 1;
        cursor = sliceEnd;
      }
    };
    for (const row of [...connections, ...relaySessions]) {
      addRange(new Date(row.start_ts), row.end_ts ? new Date(row.end_ts) : end, String(row.disconnect_reason ?? row.close_reason ?? ''));
      ensure(new Date(row.start_ts)).sessions += 1;
    }
    const totalSec = Math.round((end.getTime() - start.getTime()) / 1000);
    const onlineSec = Object.values(buckets).reduce((sum: number, item: any) => sum + item.onlineSec, 0);
    res.json({
      range,
      from: start.toISOString(),
      to: end.toISOString(),
      totalSec,
      onlineSec,
      uptimePct: totalSec > 0 ? Math.min(100, (onlineSec / totalSec) * 100) : 0,
      buckets: Object.values(buckets).sort((a: any, b: any) => a.bucket.localeCompare(b.bucket))
    });
  })
);

const sourceSchema = z.object({
  source_role: z.enum(['ntrip_client', 'ntrip_caster']).default('ntrip_caster'),
  client_host: z.string().max(190).optional().default(''),
  client_port: z.number().int().min(1).max(65535).optional().default(1509),
  client_mount: z.string().max(128).optional().default(''),
  client_username: z.string().max(128).optional().default(''),
  client_password: z.string().max(512).optional(),
  client_tls: z.boolean().optional().default(false),
  client_send_gga: z.boolean().optional().default(false),
  client_nmea_interval_sec: z.number().int().min(0).max(3600).optional().default(0),
  caster_version: z.enum(['v1', 'v2']).optional().default('v2'),
  caster_username: z.string().max(128).optional().default(''),
  caster_password: z.string().max(512).optional(),
  caster_requires_auth: z.boolean().optional().default(true)
});

function publicSource(row: any) {
  return {
    station_id: Number(row.station_id),
    source_role: String(row.source_role),
    client_host: String(row.client_host ?? ''),
    client_port: Number(row.client_port ?? 1509),
    client_mount: String(row.client_mount ?? ''),
    client_username: String(row.client_username ?? ''),
    client_has_password: Boolean(row.client_password_enc),
    client_tls: Boolean(row.client_tls),
    client_send_gga: Boolean(row.client_send_gga),
    client_nmea_interval_sec: Number(row.client_nmea_interval_sec ?? 0),
    caster_version: String(row.caster_version ?? 'v2'),
    caster_username: String(row.caster_username ?? ''),
    caster_has_password: Boolean(row.caster_password_enc),
    caster_requires_auth: Boolean(row.caster_requires_auth),
    relay_job_id: row.relay_job_id === null ? null : Number(row.relay_job_id),
    updated_at: row.updated_at
  };
}

stationsRouter.get(
  '/:id/sources',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await getStation(Number(req.params.id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const rows = await query<RowDataPacket[]>(
      'SELECT * FROM station_sources WHERE station_id = ?',
      [station.id]
    );
    res.json({ items: rows.map(publicSource) });
  })
);

stationsRouter.put(
  '/:id/sources',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const station = await getStation(Number(req.params.id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const body = sourceSchema.parse(req.body);
    const beforeRows = await query<RowDataPacket[]>(
      'SELECT * FROM station_sources WHERE station_id = ?',
      [station.id]
    );
    const before = beforeRows[0] ? publicSource(beforeRows[0]) : null;
    await adminPool.query(
      `INSERT INTO station_sources
         (station_id, source_role, client_host, client_port, client_mount,
          client_username, client_password_enc, client_tls, client_send_gga,
          client_nmea_interval_sec, caster_version, caster_username,
          caster_password_enc, caster_requires_auth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         source_role = VALUES(source_role), client_host = VALUES(client_host),
         client_port = VALUES(client_port), client_mount = VALUES(client_mount),
         client_username = VALUES(client_username),
         client_password_enc = COALESCE(VALUES(client_password_enc), client_password_enc),
         client_tls = VALUES(client_tls), client_send_gga = VALUES(client_send_gga),
         client_nmea_interval_sec = VALUES(client_nmea_interval_sec),
         caster_version = VALUES(caster_version), caster_username = VALUES(caster_username),
         caster_password_enc = COALESCE(VALUES(caster_password_enc), caster_password_enc),
         caster_requires_auth = VALUES(caster_requires_auth)`,
      [
        station.id,
        body.source_role,
        body.client_host,
        body.client_port,
        body.client_mount,
        body.client_username,
        body.client_password ? encryptSecret(body.client_password) : null,
        body.client_tls ? 1 : 0,
        body.client_send_gga ? 1 : 0,
        body.client_nmea_interval_sec,
        body.caster_version,
        body.caster_username,
        body.caster_password ? encryptSecret(body.caster_password) : null,
        body.caster_requires_auth ? 1 : 0
      ]
    );
    const rows = await query<RowDataPacket[]>(
      'SELECT * FROM station_sources WHERE station_id = ?',
      [station.id]
    );
    const after = rows[0] ? publicSource(rows[0]) : null;
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update_source',
      'station',
      station.id,
      before,
      after,
      ipFrom(req)
    );
    res.json({ item: after });
  })
);

stationsRouter.post(
  '/bulk',
  requireBulkPermission('stations', {
    enable: 'edit',
    disable: 'edit',
    lock: 'edit',
    unlock: 'edit',
    delete: 'delete'
  }),
  asyncHandler(async (req, res) => {
    const body = bulkBodySchema.parse(req.body);
    const ids = uniqueIds(body.ids);
    const rows = await query<RowDataPacket[]>(
      `SELECT id, code, name, enabled, status, owner_web_user_id
         FROM stations WHERE id IN (${ids.map(() => '?').join(',')})`,
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
        await assertRecordScope(req, row.owner_web_user_id);
        allowed.push(row);
      } catch {
        result.forbidden += 1;
      }
    }
    await withTransaction(async (conn) => {
      for (const row of allowed) {
        if (body.action === 'delete') {
          await conn.query('DELETE FROM stations WHERE id = ?', [row.id]);
        } else if (body.action === 'enable') {
          await conn.query("UPDATE stations SET enabled = 1, status = 'active' WHERE id = ?", [row.id]);
        } else if (body.action === 'disable') {
          await conn.query("UPDATE stations SET enabled = 0, status = 'disabled' WHERE id = ?", [row.id]);
        } else if (body.action === 'lock') {
          await conn.query("UPDATE stations SET status = 'locked' WHERE id = ?", [row.id]);
        } else if (body.action === 'unlock') {
          await conn.query("UPDATE stations SET status = 'active' WHERE id = ?", [row.id]);
        }
      }
    });
    result.updated = allowed.length;
    await writeAudit(
      adminPool,
      req.auth!.id,
      `bulk_${body.action}`,
      'station',
      `bulk:${ids.length}`,
      null,
      { ids, result },
      ipFrom(req)
    );
    res.json({ result });
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
