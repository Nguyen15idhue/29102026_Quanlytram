import { Router } from 'express';
import { z } from 'zod';
import net from 'node:net';
import tls from 'node:tls';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { writeAudit } from '../lib/audit';
import { bulkBodySchema, emptyBulkResult, uniqueIds } from '../lib/bulk';
import { type GoConnection, publicConnection } from '../lib/caster';
import { buildWorkbook, readSheetRows, readWorkbook, sendWorkbook } from '../lib/excel';
import { asyncHandler, ApiError } from '../lib/http';
import { ecefToGeodetic, geodeticToVn2000 } from '../lib/geo';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { callGoInternal } from '../lib/internalApi';
import { reconcileAffected } from '../lib/reconcile';
import { hashPassword } from '../lib/password';
import { createStationResources } from '../lib/stationResources';
import { dataUptime } from '../lib/dataUptime';
import { publishEntityChange } from '../lib/entityChange';
import {
  notifyStationStreamingChange,
  setStationStreamingInTransaction,
  type StationStreamEffect
} from '../lib/stationStream';
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
import {
  buildStatusTimeline,
  combinedRelayStatus,
  SAMPLE_LOOKBACK_MS,
  statusForLiveAge,
  TIMELINE_RANGES,
  timelineRange
} from '../lib/statusTimeline';
import { loadTimelineConfig } from '../lib/timelineConfig';
import { loadServiceDowntime } from '../lib/serviceDowntime';
import { requireAuth, requirePermission, isSuperAdmin } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import {
  assertRecordScope,
  ipFrom,
  listScope,
  pageFrom,
  requireBulkPermission,
  resolveWriteOwnership,
  scopeIdsFor
} from '../rbac/access';

export const stationsRouter = Router();
stationsRouter.use(requireAuth);
stationsRouter.use(csrfProtection);

const text = (max: number) => z.string().max(max).optional();
const nullableNumber = (min: number, max: number) =>
  z.number().min(min).max(max).nullable().optional();

const stationBaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  host: text(190),
  port: z.number().int().min(1).max(65535),
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
  owner_web_user_id: z.number().int().positive().nullable().optional(),
  company_id: z.number().int().positive().nullable().optional()
});

const createSchema = stationBaseSchema.extend({
  source_role: z.enum(['ntrip_client', 'ntrip_caster']).optional().default('ntrip_caster'),
  caster_listener_id: z.number().int().positive().nullable().optional(),
  caster_username: z.string().max(128).optional().default(''),
  caster_password: z.string().max(512).optional(),
  caster_requires_auth: z.boolean().optional().default(true),
  client_host: z.string().max(190).optional().default(''),
  client_port: z.number().int().min(1).max(65535).optional().default(1509),
  client_mount: z.string().max(128).optional().default(''),
  client_username: z.string().max(128).optional().default(''),
  client_password: z.string().max(512).optional(),
  client_tls: z.boolean().optional().default(false),
  client_send_gga: z.boolean().optional().default(false),
  client_nmea_interval_sec: z.number().int().min(0).max(3600).optional().default(0),
  client_gga_lat: z.number().min(-90).max(90).nullable().optional(),
  client_gga_lon: z.number().min(-180).max(180).nullable().optional()
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  host: text(190),
  port: z.number().int().min(1).max(65535).optional(),
  connection_type: z.string().max(32).optional(),
  source_type: z.enum(['relay_caster', 'caster_ingest', 'probe_client', 'manual']).optional(),
  ntrip_version: z.enum(['v1', 'v2']).optional(),
  ntrip_mode: z.enum(['v1_noauth', 'v1_auth', 'v2_auth', 'ntrip_client']).optional(),
  lat: nullableNumber(-90, 90),
  lon: nullableNumber(-180, 180),
  notes: text(500),
  station_type: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
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
  coordinate_type: z.enum(['wgs84', 'vn2000', 'itrf']).optional(),
  province: text(120),
  ward: text(120),
  address_detail: text(255),
  device_id: text(120),
  network_type: text(64),
  network_mode: text(64),
  protocol: z.string().max(64).optional(),
  custom_fields: z.unknown().nullable().optional(),
  owner_web_user_id: z.number().int().positive().nullable().optional(),
  company_id: z.number().int().positive().nullable().optional()
});

function validateSourceFields(data: z.infer<typeof createSchema>): string | null {
  if (data.source_role === 'ntrip_caster') {
    if (!data.caster_listener_id) return 'Caster listener là bắt buộc';
    if (!data.caster_username?.trim()) return 'Caster username là bắt buộc';
    if (!data.caster_password) return 'Caster password là bắt buộc';
    return null;
  }
  if (!data.client_host?.trim()) return 'Client host là bắt buộc';
  if (!data.client_port) return 'Client port là bắt buộc';
  if (!data.client_mount?.trim()) return 'Client mountpoint là bắt buộc';
  return null;
}

const stationColumns = `s.*, u.display_name AS owner_name, c.name AS company_name,
  (SELECT COUNT(*) FROM mountpoints m WHERE m.station_id = s.id) AS mountpoint_count,
  (SELECT m.name FROM mountpoints m WHERE m.station_id = s.id ORDER BY m.id LIMIT 1) AS mountpoint_name,
  (SELECT a.username FROM ntrip_accounts a WHERE a.managed_by_station_id = s.id LIMIT 1) AS account_username,
  (SELECT ss.source_role FROM station_sources ss WHERE ss.station_id = s.id) AS station_source_role,
  (SELECT ss.client_host FROM station_sources ss WHERE ss.station_id = s.id) AS station_client_host,
  (SELECT ss.client_port FROM station_sources ss WHERE ss.station_id = s.id) AS station_client_port,
  (SELECT ss.client_mount FROM station_sources ss WHERE ss.station_id = s.id) AS station_client_mount,
  (SELECT ss.caster_listener_id FROM station_sources ss WHERE ss.station_id = s.id) AS station_caster_listener_id,
  (SELECT l.port FROM station_sources ss JOIN caster_listeners l ON l.id = ss.caster_listener_id
    WHERE ss.station_id = s.id) AS station_caster_port`;

async function getStation(id: number): Promise<any | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT ${stationColumns}
       FROM stations s
       LEFT JOIN web_users u ON u.id = s.owner_web_user_id
       LEFT JOIN companies c ON c.id = s.company_id
      WHERE s.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

async function deleteStationCascade(
  conn: any,
  stationId: number
): Promise<{ mountpointIds: number[]; relayJobIds: number[] }> {
  const [mountpoints] = (await conn.query(
    'SELECT id, name FROM mountpoints WHERE station_id = ?',
    [stationId]
  )) as [any[], any];
  const mountpointIds = mountpoints.map((row: any) => Number(row.id));
  const names = mountpoints.map((row: any) => String(row.name));
  let relayJobIds: number[] = [];
  if (names.length > 0) {
    const placeholders = names.map(() => '?').join(',');
    const [relayRows] = (await conn.query(
      `SELECT id FROM relay_jobs
        WHERE deleted_at IS NULL
          AND (upstream_mount IN (${placeholders}) OR downstream_mount IN (${placeholders}))`,
      [...names, ...names]
    )) as [any[], any];
    relayJobIds = relayRows.map((row: any) => Number(row.id));
    if (relayJobIds.length > 0) {
      await conn.query(
        `UPDATE relay_jobs
            SET enabled = 0,
                paused_by_station_id = NULL,
                paused_by_mountpoint_id = NULL,
                desired_revision = desired_revision + 1
          WHERE deleted_at IS NULL
            AND (upstream_mount IN (${placeholders}) OR downstream_mount IN (${placeholders}))`,
        [...names, ...names]
      );
    }
  }
  await conn.query('DELETE FROM station_probes WHERE station_id = ?', [stationId]);
  await conn.query('DELETE FROM station_sources WHERE station_id = ?', [stationId]);
  await conn.query('DELETE FROM mountpoints WHERE station_id = ?', [stationId]);
  await conn.query('DELETE FROM stations WHERE id = ?', [stationId]);
  return { mountpointIds, relayJobIds };
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
      ORDER BY r.enabled DESC, r.id DESC`,
    ids
  );
  for (const row of rows as any[]) {
    if (!map.has(Number(row.station_id))) map.set(Number(row.station_id), row);
  }
  try {
    const response = await callGoInternal<{
      items: Array<{ jobId: number; state: string }>;
    }>('/internal/snapshot', undefined, { method: 'GET', timeoutMs: 1200 });
    const metricById = new Map(
      (response?.items ?? []).map((item) => [Number(item.jobId), item])
    );
    for (const row of map.values()) {
      const metric = metricById.get(Number(row.relay_job_id));
      row.runtime_state = metric ? String(metric.state) : 'unknown';
      row.relay_last_up_at = (metric as any)?.lastUpAt ?? null;
      row.relay_last_down_at = (metric as any)?.lastDownAt ?? null;
      row.relay_bytes_up = Number((metric as any)?.bytesUp ?? 0);
      row.relay_bytes_down = Number((metric as any)?.bytesDown ?? 0);
    }
  } catch {
    for (const row of map.values()) {
      row.runtime_state = row.runtime_state ?? 'unknown';
      row.relay_last_up_at = null;
      row.relay_last_down_at = null;
    }
  }
  return map;
}

async function stationConnectionSet(stationIds: number[]): Promise<Set<number>> {
  const connected = new Set<number>();
  if (stationIds.length === 0) return connected;
  const placeholders = stationIds.map(() => '?').join(',');
  const rows = await query<RowDataPacket[]>(
    `SELECT id, station_id FROM mountpoints WHERE station_id IN (${placeholders})`,
    stationIds
  );
  const stationByMountpoint = new Map(
    rows.map((row) => [Number(row.id), Number(row.station_id)])
  );
  if (stationByMountpoint.size > 0) {
    const connections = await casterConnectionsFor([...stationByMountpoint.keys()]);
    if (connections.available) {
      for (const item of connections.items) {
        if (item.direction !== 'source') continue;
        const stationId = stationByMountpoint.get(Number(item.mountpointId));
        if (stationId) connected.add(stationId);
      }
    }
  }

  try {
    const sourceRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT DISTINCT station_id FROM station_source_sessions
        WHERE end_ts IS NULL AND station_id IN (${placeholders})`,
      stationIds
    );
    for (const row of sourceRows) connected.add(Number(row.station_id));
  } catch {
    // Bảng session có thể chưa được migrate; bỏ qua.
  }

  const relayRows = await query<RowDataPacket[]>(
    `SELECT m.station_id, r.id AS relay_job_id
       FROM mountpoints m
       JOIN relay_jobs r ON r.upstream_mount = m.name AND r.deleted_at IS NULL
      WHERE m.station_id IN (${placeholders})`,
    stationIds
  );
  const stationByJob = new Map<number, number>();
  for (const row of relayRows) {
    stationByJob.set(Number(row.relay_job_id), Number(row.station_id));
  }
  if (stationByJob.size > 0) {
    const jobIds = [...stationByJob.keys()];
    const jobPlaceholders = jobIds.map(() => '?').join(',');
    const openSessions = await runtimeQuery<RowDataPacket[]>(
      `SELECT DISTINCT relay_job_id FROM relay_sessions
        WHERE end_ts IS NULL AND relay_job_id IN (${jobPlaceholders})`,
      jobIds
    );
    for (const row of openSessions) {
      const stationId = stationByJob.get(Number(row.relay_job_id));
      if (stationId) connected.add(stationId);
    }
  }
  return connected;
}

async function stationConnectionIntervals(
  station: any,
  from: Date,
  to: Date
): Promise<{
  connections: Array<{ from: Date; to: Date | null; reason: string }>;
  hasConnectionInfo: boolean;
}> {
  const stationId = Number(station.id);
  const sourceRole = String(station.station_source_role ?? '');
  const sourceType = String(station.source_type ?? '');
  const hasConnectionInfo =
    sourceRole === 'ntrip_client' ||
    sourceRole === 'ntrip_caster' ||
    sourceType === 'caster_ingest' ||
    sourceType === 'relay_caster';
  if (!hasConnectionInfo) {
    return { connections: [], hasConnectionInfo: false };
  }

  const connections: Array<{ from: Date; to: Date | null; reason: string }> = [];
  try {
    const sourceRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT start_ts, end_ts, close_reason FROM station_source_sessions
        WHERE station_id = ? AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
        ORDER BY start_ts`,
      [stationId, from, to]
    );
    for (const row of sourceRows) {
      connections.push({
        from: new Date(row.start_ts),
        to: row.end_ts ? new Date(row.end_ts) : null,
        reason: String(row.close_reason ?? '')
      });
    }
  } catch {
    // Bảng session có thể chưa được migrate.
  }

  const mountpointRows = await query<RowDataPacket[]>(
    'SELECT id, name FROM mountpoints WHERE station_id = ?',
    [stationId]
  );
  const mountpointIds = mountpointRows.map((row) => Number(row.id));
  if (mountpointIds.length > 0) {
    const placeholders = mountpointIds.map(() => '?').join(',');
    const casterRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT start_ts, end_ts, disconnect_reason FROM caster_connections
        WHERE mountpoint_id IN (${placeholders}) AND direction = 'source'
          AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
        ORDER BY start_ts`,
      [...mountpointIds, from, to]
    );
    for (const row of casterRows) {
      connections.push({
        from: new Date(row.start_ts),
        to: row.end_ts ? new Date(row.end_ts) : null,
        reason: String(row.disconnect_reason ?? '')
      });
    }
  }

  const mountpointNames = mountpointRows.map((row) => String(row.name));
  if (mountpointNames.length > 0) {
    const placeholders = mountpointNames.map(() => '?').join(',');
    const relayRows = await query<RowDataPacket[]>(
      `SELECT id FROM relay_jobs
        WHERE deleted_at IS NULL AND upstream_mount IN (${placeholders})`,
      mountpointNames
    );
    const relayIds = relayRows.map((row) => Number(row.id));
    if (relayIds.length > 0) {
      const relayPlaceholders = relayIds.map(() => '?').join(',');
      const sessionRows = await runtimeQuery<RowDataPacket[]>(
        `SELECT start_ts, end_ts, close_reason FROM relay_sessions
          WHERE relay_job_id IN (${relayPlaceholders})
            AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
          ORDER BY start_ts`,
        [...relayIds, from, to]
      );
      for (const row of sessionRows) {
        connections.push({
          from: new Date(row.start_ts),
          to: row.end_ts ? new Date(row.end_ts) : null,
          reason: String(row.close_reason ?? '')
        });
      }
    }
  }

  connections.sort((a, b) => a.from.getTime() - b.from.getTime());
  return { connections, hasConnectionInfo };
}

function liveStatusFromConnections(
  ageMs: number | null,
  connections: Array<{ from: Date; to: Date | null }>,
  hasConnectionInfo: boolean,
  now: Date
): 'online' | 'offline' | 'no_data' {
  if (!hasConnectionInfo) return statusForLiveAge(ageMs);
  const nowMs = now.getTime();
  const connected = connections.some(
    (item) => item.from.getTime() <= nowMs && (item.to === null || nowMs < item.to.getTime())
  );
  if (connected) return statusForLiveAge(ageMs, { connected: true });
  if (connections.length === 0) return statusForLiveAge(ageMs, { everConnected: false });
  const lastEnd = Math.max(
    ...connections
      .filter((item) => item.to !== null)
      .map((item) => (item.to as Date).getTime())
  );
  if (!Number.isFinite(lastEnd)) return statusForLiveAge(ageMs, { everConnected: false });
  return statusForLiveAge(ageMs, {
    connected: false,
    disconnectAgeMs: Math.max(0, nowMs - lastEnd)
  });
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
  probes: Map<number, any>,
  connectedStations: Set<number>
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
  const locked = String(row.status) === 'locked';
  const stationOff = Number(row.enabled) === 0 || locked;
  const state = String(item?.state ?? '').toLowerCase();
  const relayState = String(relay?.runtime_state ?? '');
  const connected = connectedStations.has(Number(row.id));
  let transportStatus: 'online' | 'offline' | 'no_data' | 'error' | 'unknown' | null;
  if (locked) {
    transportStatus = null;
  } else if (Number(row.enabled) === 0) {
    transportStatus = 'offline';
  } else if (sourceType === 'relay_caster') {
    const relayUpAge = relay?.relay_last_up_at
      ? Math.max(0, Date.now() - new Date(String(relay.relay_last_up_at)).getTime())
      : null;
    const relayDownAge = relay?.relay_last_down_at
      ? Math.max(0, Date.now() - new Date(String(relay.relay_last_down_at)).getTime())
      : null;
    if (relayState !== 'streaming') {
      transportStatus = 'offline';
    } else {
      transportStatus = combinedRelayStatus(
        statusForLiveAge(relayUpAge),
        statusForLiveAge(relayDownAge)
      );
    }
  } else {
    transportStatus = transportStatusFor(state, sampleAgeMs, { connected });
  }
  return {
    ...row,
    transportStatus,
    qualityStatus: stationOff
      ? 'unknown'
      : qualityStatusFor({
          score: item ? Number(item.score) : null,
          state: item?.state,
          metadataOk: sampleMetadataOk(item),
          hasMsm
        }),
    metadataStatus: stationOff
      ? 'unknown'
      : metadataStatusFor({
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
    relay_runtime_state: relay?.runtime_state ?? null,
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
    quality_score: stationOff ? null : item ? Number(item.score) : null,
    quality_state: stationOff ? 'disabled' : item ? String(item.state) : 'unknown',
    last_data_at: item
      ? new Date(
          new Date(item.ts).getTime() - Math.max(0, Number(item.age_ms ?? 0))
        ).toISOString()
      : null
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
  await assertRecordScope(req, station.owner_web_user_id, 'owner_web_user_id', station.company_id);
  return station;
}

function statusesForLive(live: QualityLive, connected = false) {
  const hasArp =
    live.arpX !== null &&
    live.arpX !== undefined &&
    live.arpY !== null &&
    live.arpY !== undefined &&
    live.arpZ !== null &&
    live.arpZ !== undefined;
  return {
    transportStatus: transportStatusFor(live.state, live.ageMs, { connected }),
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

async function liveStationMap(): Promise<Map<number, QualityLive>> {
  const map = new Map<number, QualityLive>();
  try {
    const live = await fetchLiveQuality(1200);
    for (const item of live.items) {
      if (item.targetType !== 'station' || item.direction !== 'ingest') continue;
      const id = Number(item.targetId);
      const existing = map.get(id);
      if (!existing || new Date(item.ts).getTime() > new Date(existing.ts).getTime()) {
        map.set(id, item);
      }
    }
  } catch {
    // Go internal không sẵn sàng: giữ trạng thái suy ra từ mẫu DB.
  }
  return map;
}

function isStationOff(row: any): boolean {
  return Number(row.enabled) === 0 || String(row.status) === 'locked';
}

// Live snapshot chỉ được dùng khi trạm đang bật. Trạm tắt/khóa phải giữ
// trạng thái offline/unknown do withQuality() tính, không để snapshot cũ
// trong RAM Go đè lên (nguyên nhân list hiện "no data" khi vừa tắt trạm).
function applyLiveStatus(item: any, live: QualityLive | null | undefined, connected = false): any {
  if (!live || isStationOff(item)) return item;
  const ageMs = Math.max(0, Number(live.ageMs ?? 0));
  const lastDataAt = new Date(new Date(live.ts).getTime() - ageMs).toISOString();
  return {
    ...item,
    ...statusesForLive(live, connected),
    quality_score: live.score,
    quality_state: live.state,
    last_data_at: lastDataAt
  };
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
    throw new ApiError(400, 'VALIDATION_ERROR', `${label} không hợp lệ`);
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
    where += ' AND (s.name LIKE ? OR s.address LIKE ? OR s.region LIKE ? OR s.host LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
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
  const companyId = Number(req.query.companyId || 0);
  if (req.auth?.roleCode === 'super_admin' && Number.isInteger(companyId) && companyId > 0) {
    where += ' AND s.company_id = ?';
    params.push(companyId);
  }
  return where;
}

stationsRouter.get(
  '/',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 's.owner_web_user_id', { companyColumn: 's.company_id' });
    const { pageSize, offset } = pageFrom(req);
    const params: unknown[] = [...scope.params];
    const where = whereFrom(req, scope, params);
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT ${stationColumns}
         FROM stations s
         LEFT JOIN web_users u ON u.id = s.owner_web_user_id
         LEFT JOIN companies c ON c.id = s.company_id
        WHERE ${where}
        ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await adminPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM stations s WHERE ${where}`,
      params
    );
    const idsForMeta = rows.map((row) => Number(row.id));
    const [quality, relays, probes, connectedStations, live] = await Promise.all([
      qualityMap(idsForMeta),
      relayMap(idsForMeta),
      probeMap(idsForMeta),
      stationConnectionSet(idsForMeta),
      liveStationMap()
    ]);
    res.json({
      items: rows.map((row) => {
        const item = withQuality(row, quality, relays, probes, connectedStations);
        return applyLiveStatus(item, live.get(Number(row.id)), connectedStations.has(Number(row.id)));
      }),
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
    const scope = listScope(req, ids, 's.owner_web_user_id', { companyColumn: 's.company_id' });
    const params: unknown[] = [...scope.params];
    const where = whereFrom(req, scope, params);
    const [rows] = await adminPool.query<RowDataPacket[]>(
      `SELECT ${stationColumns}
         FROM stations s
         LEFT JOIN web_users u ON u.id = s.owner_web_user_id
         LEFT JOIN companies c ON c.id = s.company_id
        WHERE ${where} ORDER BY s.id`,
      params
    );
    const headers = [
      'name', 'station_type', 'enabled', 'host', 'port', 'connection_type',
      'source_type', 'ntrip_version', 'ntrip_mode',
      'lat', 'lon', 'region', 'address', 'contractor', 'receiver_type', 'receiver_sn',
      'receiver_firmware', 'antenna_type', 'antenna_sn', 'antenna_height',
      'elevation_mask', 'device_id', 'network_type', 'network_mode', 'protocol',
      'owner_username', 'notes'
    ];
    const data = rows.map((row) => [
      row.name, row.station_type, row.enabled ? '1' : '0', row.host, row.port,
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
        owner_username: row.owner_username ?? '',
        source_role: row.source_role || 'ntrip_caster',
        caster_listener_id: num('caster_listener_id'),
        caster_username: row.caster_username ?? '',
        caster_password: row.caster_password ?? '',
        caster_requires_auth: row.caster_requires_auth === undefined
          ? true
          : ['1', 'true', 'yes'].includes(String(row.caster_requires_auth).toLowerCase()),
        client_host: row.client_host ?? '',
        client_port: num('client_port') ?? 1509,
        client_mount: row.client_mount ?? '',
        client_username: row.client_username ?? '',
        client_password: row.client_password ?? '',
        client_tls: ['1', 'true', 'yes'].includes(String(row.client_tls ?? '').toLowerCase()),
        client_send_gga: ['1', 'true', 'yes'].includes(String(row.client_send_gga ?? '').toLowerCase())
      };
      if ([candidate.port, candidate.lat, candidate.lon, candidate.caster_listener_id, candidate.client_port].some((value) => Number.isNaN(value))) {
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
      const sourceError = validateSourceFields(parsed.data);
      if (sourceError) {
        errors.push(`Line ${line} ${sourceError}`);
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
    const effects: StationStreamEffect[] = [];
    await withTransaction(async (conn) => {
      for (const item of normalized) {
        const [ownerRows]: any = await conn.query(
          'SELECT id, company_id FROM web_users WHERE username = ? LIMIT 1',
          [item.ownerUsername]
        );
        const ownerId = ownerRows[0]?.id ?? req.auth!.id;
        const ownerCompany = ownerRows[0]?.company_id ?? null;
        const companyId = isSuperAdmin(req)
          ? ownerCompany
          : req.auth!.companyId;
        if (companyId === null || companyId === undefined) {
          throw new ApiError(400, 'COMPANY_REQUIRED', 'Phải chọn công ty khi import trạm');
        }
        if (!isSuperAdmin(req) && ownerCompany !== null && Number(ownerCompany) !== Number(companyId)) {
          throw new ApiError(400, 'OWNER_COMPANY_MISMATCH', 'Chủ sở hữu khác công ty');
        }
        const data = item.data;
        const [existing]: any = await conn.query(
          'SELECT id, enabled, status, owner_web_user_id, company_id FROM stations WHERE name = ? LIMIT 1',
          [data.name]
        );
        if (existing[0]) {
          await assertRecordScope(
            req,
            existing[0].owner_web_user_id,
            'owner_web_user_id',
            existing[0].company_id
          );
        }
        const values = [
          data.name, data.host ?? '', data.port, data.connection_type,
          data.source_type, data.ntrip_version, data.ntrip_mode, data.lat, data.lon,
          data.notes ?? '', data.station_type, data.enabled, data.receiver_type ?? '',
          data.receiver_sn ?? '', data.receiver_firmware ?? '', data.antenna_type ?? '',
          data.antenna_sn ?? '', data.antenna_height, data.elevation_mask, data.contractor ?? '',
          data.region ?? '', data.address ?? '', data.device_id ?? '', data.network_type ?? '',
          data.network_mode ?? '', data.protocol,
          data.custom_fields === undefined ? null : JSON.stringify(data.custom_fields),
          ownerId, companyId
        ];
        if (existing[0]) {
          await conn.query(
            `UPDATE stations SET name=?, host=?, port=?, connection_type=?,
               source_type=?, ntrip_version=?, ntrip_mode=?, lat=?, lon=?, notes=?,
               station_type=?, enabled=?, receiver_type=?, receiver_sn=?, receiver_firmware=?,
               antenna_type=?, antenna_sn=?, antenna_height=?, elevation_mask=?, contractor=?,
               region=?, address=?, device_id=?, network_type=?, network_mode=?, protocol=?,
           custom_fields=?, owner_web_user_id=?, company_id=? WHERE id=?`,
            [...values, Number(existing[0].id)]
          );
          updated += 1;
          const beforeEnabled = Number(existing[0].enabled) === 1;
          if (Boolean(data.enabled) !== beforeEnabled && String(existing[0].status) !== 'locked') {
            await conn.query('UPDATE stations SET status = ? WHERE id = ?', [
              data.enabled ? 'active' : 'disabled',
              Number(existing[0].id)
            ]);
            effects.push(
              await setStationStreamingInTransaction(
                conn,
                Number(existing[0].id),
                Boolean(data.enabled)
              )
            );
          }
        } else {
          const [inserted]: any = await conn.query(
            `INSERT INTO stations
              (name, host, port, connection_type, source_type, ntrip_version, ntrip_mode,
               lat, lon, notes, station_type, enabled,
               receiver_type, receiver_sn, receiver_firmware, antenna_type, antenna_sn,
               antenna_height, elevation_mask, contractor, region, address, device_id,
               network_type, network_mode, protocol, custom_fields, owner_web_user_id, company_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [...values, req.auth!.id]
          );
          const stationId = Number(inserted.insertId);
          if (!data.enabled) {
            await conn.query("UPDATE stations SET status = 'disabled' WHERE id = ?", [
              stationId
            ]);
          }
          await createStationResources(conn, stationId, data, ownerId, req.auth!.id, companyId);
          created += 1;
        }
      }
    });
    if (effects.length > 0) {
      await notifyStationStreamingChange({
        relayJobIds: [...new Set(effects.flatMap((effect) => effect.relayJobIds))],
        mountpointIds: [...new Set(effects.flatMap((effect) => effect.mountpointIds))]
      });
    }
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
    const [quality, relays, probes, samples, live, connectedStations] = await Promise.all([
      qualityMap([id]),
      relayMap([id]),
      probeMap([id]),
      stationSampleRows(id),
      latestLiveStation(id),
      stationConnectionSet([id])
    ]);
    const reliability = buildReliability(samples, { windowSec: 900 });
    const item = applyLiveStatus(
      withQuality(station, quality, relays, probes, connectedStations),
      live,
      connectedStations.has(Number(station.id))
    );
    res.json({
      item: {
        ...item,
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
      `SELECT id, name, enabled, service_type, position_mode,
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
    const to = parseHistoryBoundary(req.query.to, 'Đến ngày') ?? new Date();
    const from =
      parseHistoryBoundary(req.query.from, 'Từ ngày') ??
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

    const scoreAlertRows = await runtimeQuery<RowDataPacket[]>(
      `SELECT id, code, level, first_seen, resolved_at
         FROM quality_alerts
        WHERE target_type = 'station' AND target_id = ?
          AND code IN ('quality.score_low', 'quality.score_zero')
          AND (first_seen >= ? OR resolved_at >= ?)
        ORDER BY last_seen DESC
        LIMIT 500`,
      [stationId, from, to, from]
    );
    for (const row of scoreAlertRows) {
      const firstAt = iso(row.first_seen);
      if (firstAt && new Date(firstAt) >= from && new Date(firstAt) <= to) {
        events.push({
          id: `alert:${Number(row.id)}:open`,
          source: 'quality',
          type: 'quality_score_alert',
          at: firstAt,
          title:
            row.code === 'quality.score_zero'
              ? 'Điểm chất lượng về 0'
              : 'Điểm chất lượng dưới 30',
          detail: `Mức ${String(row.level)}`,
          level: row.code === 'quality.score_zero' ? 'critical' : 'warning'
        });
      }
      const resolvedAt = iso(row.resolved_at);
      if (resolvedAt && new Date(resolvedAt) >= from && new Date(resolvedAt) <= to) {
        events.push({
          id: `alert:${Number(row.id)}:resolved`,
          source: 'quality',
          type: 'quality_score_recovered',
          at: resolvedAt,
          title: 'Chất lượng phục hồi',
          detail: 'Điểm trở lại từ 30 trở lên',
          level: 'info'
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
        detail: `Bởi ${String(row.actor_name || 'hệ thống')}`,
        level: 'info'
      });
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const levelFilter = String(req.query.level ?? '').trim();
    const levels =
      levelFilter === 'error'
        ? ['critical', 'error']
        : levelFilter === 'warning'
          ? ['warning', 'warn']
          : levelFilter === 'info'
            ? ['info']
            : null;
    const filtered = levels ? events.filter((event) => levels.includes(event.level)) : events;
    const sourceCounts = {
      quality: filtered.filter((event) => event.source === 'quality').length,
      caster: filtered.filter((event) => event.source === 'caster').length,
      relay: filtered.filter((event) => event.source === 'relay').length,
      audit: filtered.filter((event) => event.source === 'audit').length
    };
    res.json({
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
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
    const sourceError = validateSourceFields(body);
    if (sourceError) throw new ApiError(400, 'VALIDATION_ERROR', sourceError);
    const ownership = await resolveWriteOwnership(req, body.owner_web_user_id, body.company_id);
    const ownerId = ownership.ownerId;
    const companyId = ownership.companyId;
    const created = await withTransaction(async (conn) => {
      const [result] = await conn.query<any>(
        `INSERT INTO stations
           (name, host, port, connection_type, source_type, ntrip_version, ntrip_mode,
            lat, lon, notes, station_type, enabled, coordinate_type, province, ward,
            address_detail, receiver_type, receiver_sn, receiver_firmware, antenna_type,
            antenna_sn, antenna_height, elevation_mask, contractor, region, address,
            device_id, network_type, network_mode, protocol, custom_fields,
            owner_web_user_id, company_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.name, body.host ?? '', body.port, body.connection_type,
          body.source_type, body.ntrip_version, body.ntrip_mode,
          body.lat ?? null, body.lon ?? null, body.notes ?? '', body.station_type,
          body.enabled, body.coordinate_type, body.province ?? '', body.ward ?? '',
          body.address_detail ?? '', body.receiver_type ?? '', body.receiver_sn ?? '',
          body.receiver_firmware ?? '', body.antenna_type ?? '', body.antenna_sn ?? '',
          body.antenna_height ?? null, body.elevation_mask ?? null, body.contractor ?? '',
          body.region ?? '', body.address ?? '', body.device_id ?? '', body.network_type ?? '',
          body.network_mode ?? '', body.protocol,
          body.custom_fields === undefined ? null : JSON.stringify(body.custom_fields),
          ownerId, companyId, req.auth!.id
        ]
      );
      const id = Number(result.insertId);
      if (!body.enabled) {
        await conn.query("UPDATE stations SET status = 'disabled' WHERE id = ?", [id]);
      }
      const resources = await createStationResources(
        conn,
        id,
        body,
        ownerId,
        req.auth!.id,
        companyId
      );
      return { id, resources };
    });
    const reconcile = body.enabled
      ? await notifyStationStreamingChange({
          relayJobIds: [],
          mountpointIds: [created.resources.mountpointId]
        })
      : null;
    const station = await getStation(created.id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'create',
      'station',
      created.id,
      null,
      { station, resources: created.resources },
      ipFrom(req)
    );
    publishEntityChange({ entity: 'station', id: created.id, action: 'create' });
    res.status(201).json({ item: station, resources: created.resources, reconcile });
  })
);

stationsRouter.patch(
  '/:id',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getStation(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    const body = updateSchema.parse(req.body);
    if (
      body.company_id !== undefined &&
      Number(body.company_id) !== (before.company_id === null ? null : Number(before.company_id))
    ) {
      throw new ApiError(400, 'COMPANY_IMMUTABLE', 'Không được đổi công ty của trạm');
    }
    if (body.name !== undefined && body.name !== before.name) {
      throw new ApiError(409, 'IMMUTABLE_FIELD', 'Tên trạm không thể sửa sau khi tạo');
    }
    if (body.port !== undefined && Number(body.port) !== Number(before.port)) {
      throw new ApiError(409, 'IMMUTABLE_FIELD', 'Port trạm không thể sửa sau khi tạo');
    }
    let ownerId = Number(before.owner_web_user_id);
    let companyId = before.company_id === null ? null : Number(before.company_id);
    if (body.owner_web_user_id !== undefined) {
      const ownership = await resolveWriteOwnership(
        req,
        body.owner_web_user_id,
        companyId
      );
      ownerId = ownership.ownerId;
      companyId = ownership.companyId;
    }
    const value = (key: string) =>
      body[key as keyof typeof body] === undefined ? before[key] : body[key as keyof typeof body];
    const enabledChanged =
      body.enabled !== undefined && Boolean(body.enabled) !== Boolean(before.enabled);
    if (enabledChanged && String(before.status) === 'locked') {
      throw new ApiError(400, 'STATION_LOCKED', 'Trạm đang khóa, phải mở khóa trước');
    }
    const effect = await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE stations SET host=?, connection_type=?,
           source_type=?, ntrip_version=?, ntrip_mode=?, lat=?, lon=?, notes=?,
           station_type=?, enabled=?, coordinate_type=?, province=?, ward=?, address_detail=?,
           receiver_type=?, receiver_sn=?, receiver_firmware=?,
           antenna_type=?, antenna_sn=?, antenna_height=?, elevation_mask=?, contractor=?,
           region=?, address=?, device_id=?, network_type=?, network_mode=?, protocol=?,
           custom_fields=?, owner_web_user_id=?, company_id=? WHERE id=?`,
        [
          value('host'), value('connection_type'),
          value('source_type'), value('ntrip_version'), value('ntrip_mode'),
          value('lat'), value('lon'), value('notes'), value('station_type'), value('enabled'),
          value('coordinate_type'), value('province'), value('ward'), value('address_detail'),
          value('receiver_type'), value('receiver_sn'), value('receiver_firmware'),
          value('antenna_type'), value('antenna_sn'), value('antenna_height'), value('elevation_mask'),
          value('contractor'), value('region'), value('address'), value('device_id'),
          value('network_type'), value('network_mode'), value('protocol'),
          body.custom_fields === undefined ? before.custom_fields : JSON.stringify(body.custom_fields),
          ownerId, companyId, id
        ]
      );
      if (!enabledChanged) return null;
      await conn.query("UPDATE stations SET status = ? WHERE id = ?", [
        body.enabled ? 'active' : 'disabled',
        id
      ]);
      return setStationStreamingInTransaction(conn, id, Boolean(body.enabled));
    });
    const reconcile = effect ? await notifyStationStreamingChange(effect) : null;
    const after = await getStation(id);
    await writeAudit(adminPool, req.auth!.id, 'update', 'station', id, before, after, ipFrom(req));
    publishEntityChange({ entity: 'station', id, action: 'update' });
    res.json({ item: after, reconcile });
  })
);

async function setStationEnabled(req: any, enabled: boolean) {
  const id = Number(req.params.id);
  const before = await getStation(id);
  if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
  await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
  if (String(before.status) === 'locked') {
    throw new ApiError(400, 'STATION_LOCKED', 'Trạm đang khóa, phải mở khóa trước');
  }
  if (Boolean(before.enabled) === enabled) return before;
  const effect = await withTransaction(async (conn) => {
    await conn.query('UPDATE stations SET enabled = ?, status = ? WHERE id = ?', [
      enabled ? 1 : 0,
      enabled ? 'active' : 'disabled',
      id
    ]);
    return setStationStreamingInTransaction(conn, id, enabled);
  });
  await notifyStationStreamingChange(effect);
  const after = await getStation(id);
  await writeAudit(
    adminPool,
    req.auth!.id,
    enabled ? 'enable' : 'disable',
    'station',
    id,
    before,
    after,
    ipFrom(req)
  );
  publishEntityChange({
    entity: 'station',
    id,
    action: enabled ? 'enable' : 'disable'
  });
  return after;
}

stationsRouter.post(
  '/:id/enable',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setStationEnabled(req, true) });
  })
);

stationsRouter.post(
  '/:id/disable',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setStationEnabled(req, false) });
  })
);

stationsRouter.post(
  '/:id/lock',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getStation(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    if (Number(before.enabled) === 1) {
      throw new ApiError(400, 'STATION_ENABLED', 'Phải tắt trạm trước khi khóa');
    }
    if (String(before.status) === 'locked') {
      res.json({ item: before });
      return;
    }
    const effect = await withTransaction(async (conn) => {
      await conn.query("UPDATE stations SET enabled = 0, status = 'locked' WHERE id = ?", [id]);
      return setStationStreamingInTransaction(conn, id, false);
    });
    await notifyStationStreamingChange(effect);
    const after = await getStation(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'lock',
      'station',
      id,
      before,
      after,
      ipFrom(req)
    );
    res.json({ item: after });
  })
);

stationsRouter.post(
  '/:id/unlock',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getStation(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    if (String(before.status) !== 'locked') {
      res.json({ item: before });
      return;
    }
    await adminPool.query(
      "UPDATE stations SET status = IF(enabled = 1, 'active', 'disabled') WHERE id = ?",
      [id]
    );
    const after = await getStation(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'unlock',
      'station',
      id,
      before,
      after,
      ipFrom(req)
    );
    res.json({ item: after });
  })
);

const ACTIVITY_RANGES = {
  '24h': { hours: 24, slotSec: 60, seriesBucketSec: 300 },
  '7d': { hours: 24 * 7, slotSec: 300, seriesBucketSec: 1800 },
  '30d': { hours: 24 * 30, slotSec: 1800, seriesBucketSec: 7200 }
} as const;

type ActivityRange = keyof typeof ACTIVITY_RANGES;

function activityRange(value: string): ActivityRange {
  return value === '7d' || value === '30d' ? value : '24h';
}

function isOutageReason(value: string): boolean {
  const reason = value.trim().toLowerCase();
  if (!reason) return false;
  return ![
    'manual',
    'normal',
    'source_disconnected',
    'service_restart',
    'rover_disconnected'
  ].includes(reason);
}

async function buildStationActivity(station: any, requestedRange: string) {
  const range = activityRange(requestedRange);
  const { hours } = ACTIVITY_RANGES[range];
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
        `SELECT id, mountpoint_id, start_ts, end_ts, disconnect_reason
           FROM caster_connections
          WHERE mountpoint_id IN (${mountpointIds.map(() => '?').join(',')})
            AND direction = 'source'
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
        `SELECT id, relay_job_id, start_ts, end_ts, close_reason
           FROM relay_sessions
          WHERE relay_job_id IN (${relayIds.map(() => '?').join(',')})
            AND (end_ts IS NULL OR end_ts >= ?) AND start_ts <= ?
          ORDER BY start_ts`,
        [...relayIds, start, end]
      )
    : [];

  const sessions = [
    ...connections.map((row) => ({
      id: `caster:${row.id}`,
      source: 'caster' as const,
      startedAt: new Date(row.start_ts),
      endedAt: row.end_ts ? new Date(row.end_ts) : null,
      reason: String(row.disconnect_reason ?? '')
    })),
    ...relaySessions.map((row) => ({
      id: `relay:${row.id}`,
      source: 'relay' as const,
      startedAt: new Date(row.start_ts),
      endedAt: row.end_ts ? new Date(row.end_ts) : null,
      reason: String(row.close_reason ?? '')
    }))
  ];

  const minuteRows = await runtimeQuery<RowDataPacket[]>(
    `SELECT UNIX_TIMESTAMP(ts) DIV 60 AS minute
       FROM quality_samples
      WHERE target_type = 'station' AND target_id = ? AND direction = 'ingest'
        AND ts >= ? AND ts <= ? AND state = 'streaming'
      GROUP BY minute`,
    [station.id, start, end]
  );
  const observed = [
    ...sessions.map((session) => Math.max(session.startedAt.getTime(), start.getTime())),
    ...minuteRows.map((row) => Number(row.minute) * 60_000)
  ].filter((value) => Number.isFinite(value));
  const firstObserved = observed.length > 0 ? Math.min(...observed) : start.getTime();
  const analysisStart = new Date(
    Math.max(start.getTime(), Math.min(firstObserved, end.getTime()))
  );
  const totalSec = Math.round((end.getTime() - analysisStart.getTime()) / 1000);
  const startMs = Math.floor(analysisStart.getTime() / 60_000) * 60_000;
  const endMs = Math.ceil(end.getTime() / 60_000) * 60_000;
  const totalMinutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
  const onlineMinutes = new Uint8Array(totalMinutes);
  const markOnline = (from: number, to: number) => {
    const first = Math.max(0, Math.floor((from - startMs) / 60_000));
    const last = Math.min(totalMinutes, Math.ceil((to - startMs) / 60_000));
    for (let index = first; index < last; index += 1) onlineMinutes[index] = 1;
  };
  for (const session of sessions) {
    const from = Math.max(session.startedAt.getTime(), analysisStart.getTime());
    const to = Math.min((session.endedAt ?? end).getTime(), end.getTime());
    if (to > from) markOnline(from, to);
  }
  for (const row of minuteRows) {
    const index = Number(row.minute) - Math.floor(startMs / 60_000);
    if (index >= 0 && index < totalMinutes) onlineMinutes[index] = 1;
  }
  const onlineMinuteCount = onlineMinutes.reduce((sum, value) => sum + value, 0);
  const onlineSec = Math.min(totalSec, onlineMinuteCount * 60);

  const slotMs = ACTIVITY_RANGES[range].slotSec * 1000;
  const slotCount = Math.max(1, Math.ceil((end.getTime() - analysisStart.getTime()) / slotMs));
  const slotStatus: Array<'up' | 'down'> = [];
  for (let index = 0; index < slotCount; index += 1) {
    const from = analysisStart.getTime() + index * slotMs;
    const to = Math.min(end.getTime(), from + slotMs);
    const first = Math.max(0, Math.floor((from - startMs) / 60_000));
    const last = Math.min(totalMinutes, Math.ceil((to - startMs) / 60_000));
    let online = 0;
    let total = 0;
    for (let minute = first; minute < last; minute += 1) {
      total += 1;
      online += onlineMinutes[minute];
    }
    slotStatus.push(total > 0 && online / total >= 0.75 ? 'up' : 'down');
  }
  const segments: Array<{ from: string; to: string; status: 'up' | 'down' }> = [];
  for (let index = 0; index < slotCount; index += 1) {
    const from = new Date(analysisStart.getTime() + index * slotMs);
    const to = new Date(Math.min(end.getTime(), analysisStart.getTime() + (index + 1) * slotMs));
    const status = slotStatus[index];
    const previous = segments[segments.length - 1];
    if (previous && previous.status === status) {
      previous.to = to.toISOString();
    } else {
      segments.push({ from: from.toISOString(), to: to.toISOString(), status });
    }
  }

  const events = segments
    .filter((segment) => segment.status === 'down')
    .map((segment) => {
      const from = new Date(segment.from).getTime();
      const to = new Date(segment.to).getTime();
      const nearby = sessions.find(
        (session) =>
          session.endedAt &&
          isOutageReason(session.reason) &&
          Math.abs(session.endedAt.getTime() - from) < 5 * 60_000
      );
      return {
        id: `${segment.from}-${segment.to}`,
        at: segment.from,
        source: (nearby?.source ?? 'caster') as 'caster' | 'relay',
        reason: nearby?.reason || 'Không có dữ liệu',
        durationSec: Math.max(0, Math.round((to - from) / 1000))
      };
    })
    .slice(0, 50);

  const qualityRows = await runtimeQuery<RowDataPacket[]>(
    `SELECT MIN(ts) AS ts,
            AVG(satellites) AS satellites,
            AVG(avg_cnr) AS avg_cnr,
            AVG(msm_epochs) AS msm_epochs,
            AVG(gaps) AS gaps,
            AVG(age_ms) AS age_ms
       FROM quality_samples
      WHERE target_type = 'station' AND target_id = ? AND direction = 'ingest'
        AND state = 'streaming' AND ts >= ? AND ts <= ?
      GROUP BY FLOOR(UNIX_TIMESTAMP(ts) / ?)
      ORDER BY ts ASC`,
    [station.id, analysisStart, end, ACTIVITY_RANGES[range].seriesBucketSec]
  );
  const series = qualityRows.map((row) => ({
    at: new Date(row.ts).toISOString(),
    satellites: row.satellites === null ? null : Math.round(Number(row.satellites)),
    avgCnr: row.avg_cnr === null ? null : Math.round(Number(row.avg_cnr) * 10) / 10,
    msmEpochs: row.msm_epochs === null ? null : Math.round(Number(row.msm_epochs)),
    gaps: row.gaps === null ? null : Math.round(Number(row.gaps) * 10) / 10,
    ageMs: row.age_ms === null ? null : Math.round(Number(row.age_ms))
  }));

  return {
    stationId: Number(station.id),
    range,
    from: analysisStart.toISOString(),
    to: end.toISOString(),
    totalSec,
    onlineSec,
    uptimePct: totalSec > 0 ? Math.min(100, (onlineSec / totalSec) * 100) : 0,
    events,
    segments,
    series
  };
}

stationsRouter.get(
  '/:id/activity',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await getStation(Number(req.params.id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id, 'owner_web_user_id', station.company_id);
    res.json(await buildStationActivity(station, String(req.query.range ?? '24h')));
  })
);

stationsRouter.get(
  '/:id/timeline',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await scopedStation(req, Number(req.params.id));
    const range = timelineRange(req.query.range);
    const { hours, bucketSec, resolutionSec, seriesBucketSec } = TIMELINE_RANGES[range];
    const now = new Date();
    const from = new Date(now.getTime() - hours * 3600_000);
    // Đọc lùi thêm một sample để nội suy đúng trạng thái ngay tại rangeFrom.
    const sampleFrom = new Date(from.getTime() - SAMPLE_LOOKBACK_MS);
    const rows = await runtimeQuery<RowDataPacket[]>(
      `SELECT ts, state, age_ms, frames, window_sec, satellites, avg_cnr, msm_epochs, gaps
         FROM quality_samples
        WHERE target_type = 'station' AND target_id = ? AND direction = 'ingest'
          AND ts >= ? AND ts <= ?
        ORDER BY ts ASC`,
      [station.id, sampleFrom, now]
    );
    const samples = rows.map((row) => ({
      ts: new Date(row.ts),
      state: String(row.state ?? ''),
      ageMs: Number(row.age_ms ?? 0),
      frames: Number(row.frames ?? 0),
      windowSec: Number(row.window_sec ?? 60)
    }));
    const rawConnectionInfo = await stationConnectionIntervals(station, from, now);
    const connectionInfo =
      rawConnectionInfo.connections.length === 0 && samples.length > 0
        ? { connections: [], hasConnectionInfo: false }
        : rawConnectionInfo;
    let liveAge: number | null = null;
    if (Number(station.enabled) !== 0 && String(station.status) !== 'locked') {
      try {
        const live = (await fetchLiveQuality()).items.find(
          (item) =>
            item.targetType === 'station' &&
            item.targetId === Number(station.id) &&
            item.direction === 'ingest'
        );
        if (live) {
          liveAge = Number(live.ageMs ?? 0);
        } else if (samples.length > 0) {
          const last = samples[samples.length - 1];
          liveAge = now.getTime() - (last.ts.getTime() - last.ageMs);
        }
      } catch {
        if (samples.length > 0) {
          const last = samples[samples.length - 1];
          liveAge = now.getTime() - (last.ts.getTime() - last.ageMs);
        }
      }
    }
    const currentStatus: 'online' | 'offline' | 'no_data' =
      Number(station.enabled) === 0 || String(station.status) === 'locked'
        ? 'offline'
        : liveStatusFromConnections(
            liveAge,
            connectionInfo.connections,
            connectionInfo.hasConnectionInfo,
            now
          );
    const downtime = await loadServiceDowntime(from, now);
    const currentReason: 'disabled' | 'system_down' | undefined =
      Number(station.enabled) === 0 || String(station.status) === 'locked'
        ? 'disabled'
        : downtime.some(
              (interval) =>
                interval.from.getTime() <= now.getTime() &&
                (!interval.to || now.getTime() < interval.to.getTime())
            )
          ? 'system_down'
          : undefined;
    const timeline = buildStatusTimeline({
      createdAt: station.created_at ? new Date(station.created_at) : null,
      rangeFrom: from,
      now,
      bucketSec,
      resolutionSec,
      samples,
      connections: connectionInfo.connections,
      hasConnectionInfo: connectionInfo.hasConnectionInfo,
      downtime,
      minFramesPerWindow: (await loadTimelineConfig()).minFramesPerWindow,
      currentStatus,
      currentReason
    });
    const seriesBucketMs = seriesBucketSec * 1000;
    const series = [];
    for (
      let seriesStart = from.getTime();
      seriesStart < now.getTime();
      seriesStart += seriesBucketMs
    ) {
      const seriesEnd = Math.min(seriesStart + seriesBucketMs, now.getTime());
      const bucketRows = rows.filter((row) => {
        const ts = new Date(row.ts).getTime();
        return (
          ts >= seriesStart &&
          ts < seriesEnd &&
          String(row.state ?? '') === 'streaming'
        );
      });
      const average = (key: string) => {
        const values = bucketRows
          .map((row) => Number(row[key]))
          .filter((value) => Number.isFinite(value));
        if (values.length === 0) return null;
        return (
          Math.round(
            (values.reduce((sum, value) => sum + value, 0) / values.length) * 10
          ) / 10
        );
      };
      const averageInt = (key: string) => {
        const value = average(key);
        return value === null ? null : Math.round(value);
      };
      series.push({
        at: new Date(seriesStart).toISOString(),
        satellites: averageInt('satellites'),
        avgCnr: average('avg_cnr'),
        msmEpochs: averageInt('msm_epochs'),
        gaps: averageInt('gaps'),
        ageMs: averageInt('age_ms')
      });
    }
    res.json({ ...timeline, series, bucketSec, seriesBucketSec, range });
  })
);

stationsRouter.get(
  '/:id/uptime',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const station = await getStation(Number(req.params.id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id, 'owner_web_user_id', station.company_id);
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
              AND direction = 'source'
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
    const sampleUptime = await dataUptime({
      targetType: 'station',
      targetId: Number(station.id),
      hours
    });
    res.json({
      range,
      from: start.toISOString(),
      to: end.toISOString(),
      totalSec,
      onlineSec,
      uptimePct: totalSec > 0 ? Math.min(100, (onlineSec / totalSec) * 100) : 0,
      buckets: Object.values(buckets).sort((a: any, b: any) => a.bucket.localeCompare(b.bucket)),
      dataUptime: sampleUptime
    });
  })
);

stationsRouter.post(
  '/source/mountpoints',
  requirePermission('stations', 'add'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        host: z.string().trim().min(1).max(190),
        port: z.number().int().min(1).max(65535).default(1509),
        tls: z.boolean().optional().default(false),
        username: z.string().max(128).optional().default(''),
        password: z.string().max(512).optional().default(''),
        stationId: z.number().int().positive().optional()
      })
      .parse(req.body);
    let password = body.password;
    if (!password && body.stationId) {
      const station = await getStation(body.stationId);
      if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
  await assertRecordScope(req, station.owner_web_user_id, 'owner_web_user_id', station.company_id);
      const rows = await query<RowDataPacket[]>(
        'SELECT client_password_enc FROM station_sources WHERE station_id = ?',
        [body.stationId]
      );
      if (rows[0]?.client_password_enc) {
        try {
          password = decryptSecret(rows[0].client_password_enc);
        } catch {
          password = '';
        }
      }
    }
    const items = await new Promise<Array<{ name: string }>>((resolve, reject) => {
      const socket = body.tls
        ? tls.connect({ host: body.host, port: body.port, servername: body.host })
        : net.connect({ host: body.host, port: body.port });
      let data = '';
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else {
          const names = data
            .split(/\r?\n/)
            .filter((line) => line.startsWith('STR;'))
            .map((line) => line.split(';')[1])
            .filter(Boolean)
            .map((name) => ({ name }));
          resolve([...new Map(names.map((item) => [item.name, item])).values()]);
        }
      };
      socket.setTimeout(6000, () => finish(new ApiError(504, 'SOURCE_TIMEOUT', 'Hết thời gian tải sourcetable')));
      socket.on('error', (err) => finish(err));
      socket.on('connect', () => {
        if (body.tls) return;
        const auth =
          body.username || password
            ? `Authorization: Basic ${Buffer.from(`${body.username}:${password}`).toString('base64')}\r\n`
            : '';
        socket.write(
          `GET / HTTP/1.0\r\nHost: ${body.host}:${body.port}\r\n` +
            `Ntrip-Version: Ntrip/2.0\r\nUser-Agent: NTRIP CORS-Manager/1.0\r\n` +
            `${auth}\r\n`
        );
      });
      socket.on('data', (chunk) => {
        data += chunk.toString('utf8');
        if (data.includes('ENDSOURCETABLE') || data.length > 256 * 1024) finish();
      });
      socket.on('end', () => finish());
      socket.on('secureConnect', () => {
        if (!body.tls) return;
        const auth =
          body.username || password
            ? `Authorization: Basic ${Buffer.from(`${body.username}:${password}`).toString('base64')}\r\n`
            : '';
        socket.write(
          `GET / HTTP/1.0\r\nHost: ${body.host}:${body.port}\r\n` +
            `Ntrip-Version: Ntrip/2.0\r\nUser-Agent: NTRIP CORS-Manager/1.0\r\n` +
            `${auth}\r\n`
        );
      });
    });
    res.json({ items });
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
  client_gga_lat: z.number().min(-90).max(90).nullable().optional(),
  client_gga_lon: z.number().min(-180).max(180).nullable().optional(),
  caster_version: z.enum(['v1', 'v2']).optional().default('v2'),
  caster_username: z.string().max(128).optional().default(''),
  caster_password: z.string().max(512).optional(),
  caster_requires_auth: z.boolean().optional().default(true),
  caster_listener_id: z.number().int().positive().nullable().optional()
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
    client_gga_lat: row.client_gga_lat === null ? null : Number(row.client_gga_lat),
    client_gga_lon: row.client_gga_lon === null ? null : Number(row.client_gga_lon),
    caster_version: String(row.caster_version ?? 'v2'),
    caster_username: String(row.caster_username ?? ''),
    caster_has_password: Boolean(row.caster_password_enc),
    caster_requires_auth: Boolean(row.caster_requires_auth),
    caster_listener_id:
      row.caster_listener_id === null ? null : Number(row.caster_listener_id),
    caster_listener_name: row.caster_listener_name ?? null,
    caster_port: row.caster_port === null ? null : Number(row.caster_port),
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
    await assertRecordScope(req, station.owner_web_user_id, 'owner_web_user_id', station.company_id);
    const rows = await query<RowDataPacket[]>(
      `SELECT ss.*, l.name AS caster_listener_name, l.port AS caster_port
         FROM station_sources ss
         LEFT JOIN caster_listeners l ON l.id = ss.caster_listener_id
        WHERE ss.station_id = ?`,
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
    await assertRecordScope(req, station.owner_web_user_id, 'owner_web_user_id', station.company_id);
    const body = sourceSchema.parse(req.body);
    if (body.source_role === 'ntrip_caster' && body.caster_listener_id) {
      const listeners = await query<RowDataPacket[]>(
        'SELECT id, owner_web_user_id FROM caster_listeners WHERE id = ?',
        [body.caster_listener_id]
      );
      if (listeners.length === 0) throw new ApiError(400, 'INVALID_LISTENER', 'Listener không tồn tại');
      await assertRecordScope(req, listeners[0].owner_web_user_id);
    }
    const beforeRows = await query<RowDataPacket[]>(
      `SELECT ss.*, l.name AS caster_listener_name, l.port AS caster_port
         FROM station_sources ss
         LEFT JOIN caster_listeners l ON l.id = ss.caster_listener_id
        WHERE ss.station_id = ?`,
      [station.id]
    );
    const before = beforeRows[0] ? publicSource(beforeRows[0]) : null;
    let managedAccount: any = null;
    if (body.source_role === 'ntrip_caster') {
      const [accountRows] = await query<RowDataPacket[]>(
        'SELECT id, username FROM ntrip_accounts WHERE managed_by_station_id = ? LIMIT 1',
        [station.id]
      );
      managedAccount = accountRows[0] ?? null;
      if (managedAccount && body.caster_username !== managedAccount.username) {
        throw new ApiError(
          409,
          'IMMUTABLE_FIELD',
          'Username NTRIP của trạm không thể sửa sau khi tạo'
        );
      }
    }
    const passwordHash =
      managedAccount && body.caster_password
        ? await hashPassword(body.caster_password)
        : null;
    await withTransaction(async (conn) => {
      await conn.query(
        `INSERT INTO station_sources
           (station_id, source_role, client_host, client_port, client_mount,
            client_username, client_password_enc, client_tls, client_send_gga,
            client_nmea_interval_sec, client_gga_lat, client_gga_lon,
            caster_version, caster_username, caster_password_enc, caster_requires_auth,
            caster_listener_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           source_role = VALUES(source_role), client_host = VALUES(client_host),
           client_port = VALUES(client_port), client_mount = VALUES(client_mount),
           client_username = VALUES(client_username),
           client_password_enc = COALESCE(VALUES(client_password_enc), client_password_enc),
           client_tls = VALUES(client_tls), client_send_gga = VALUES(client_send_gga),
           client_nmea_interval_sec = VALUES(client_nmea_interval_sec),
           client_gga_lat = VALUES(client_gga_lat), client_gga_lon = VALUES(client_gga_lon),
           caster_version = VALUES(caster_version), caster_username = VALUES(caster_username),
           caster_password_enc = COALESCE(VALUES(caster_password_enc), caster_password_enc),
           caster_requires_auth = VALUES(caster_requires_auth),
           caster_listener_id = VALUES(caster_listener_id)`,
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
          body.source_role === 'ntrip_client' && body.client_send_gga
            ? body.client_gga_lat ?? null
            : null,
          body.source_role === 'ntrip_client' && body.client_send_gga
            ? body.client_gga_lon ?? null
            : null,
          body.caster_version,
          body.caster_username,
          body.caster_password ? encryptSecret(body.caster_password) : null,
          body.caster_requires_auth ? 1 : 0,
          body.source_role === 'ntrip_caster' ? body.caster_listener_id ?? null : null
        ]
      );
      if (managedAccount) {
        if (passwordHash) {
          await conn.query('UPDATE ntrip_accounts SET password_hash = ? WHERE id = ?', [
            passwordHash,
            managedAccount.id
          ]);
        }
        if (body.caster_listener_id) {
          await conn.query('DELETE FROM account_listener_acl WHERE account_id = ?', [
            managedAccount.id
          ]);
          await conn.query(
            'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
            [managedAccount.id, body.caster_listener_id]
          );
        }
      }
    });
    if (managedAccount) {
      try {
        await callGoInternal('/internal/caster/reconcile', {});
      } catch (err) {
        console.warn(
          '[stations] caster reconcile after source update failed',
          err instanceof Error ? err.message : 'unknown'
        );
      }
    }
    const rows = await query<RowDataPacket[]>(
      `SELECT ss.*, l.name AS caster_listener_name, l.port AS caster_port
         FROM station_sources ss
         LEFT JOIN caster_listeners l ON l.id = ss.caster_listener_id
        WHERE ss.station_id = ?`,
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
      `SELECT id, name, enabled, status, owner_web_user_id
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
        await assertRecordScope(req, row.owner_web_user_id, 'owner_web_user_id', row.company_id);
        allowed.push(row);
      } catch {
        result.forbidden += 1;
      }
    }
    const effects: StationStreamEffect[] = [];
    await withTransaction(async (conn) => {
      for (const row of allowed) {
        const locked = String(row.status) === 'locked';
        const enabled = Number(row.enabled) === 1;
        if (body.action === 'delete') {
          if (enabled || locked) {
            result.skipped += 1;
            continue;
          }
          const deleted = await deleteStationCascade(conn, Number(row.id));
          effects.push({
            relayJobIds: deleted.relayJobIds,
            mountpointIds: deleted.mountpointIds
          });
          result.updated += 1;
        } else if (body.action === 'enable') {
          if (locked || enabled) {
            result.skipped += 1;
            continue;
          }
          await conn.query("UPDATE stations SET enabled = 1, status = 'active' WHERE id = ?", [row.id]);
          effects.push(await setStationStreamingInTransaction(conn, Number(row.id), true));
          result.updated += 1;
        } else if (body.action === 'disable') {
          if (locked || !enabled) {
            result.skipped += 1;
            continue;
          }
          await conn.query("UPDATE stations SET enabled = 0, status = 'disabled' WHERE id = ?", [row.id]);
          effects.push(await setStationStreamingInTransaction(conn, Number(row.id), false));
          result.updated += 1;
        } else if (body.action === 'lock') {
          if (locked || enabled) {
            result.skipped += 1;
            continue;
          }
          await conn.query(
            "UPDATE stations SET enabled = 0, status = 'locked' WHERE id = ?",
            [row.id]
          );
          effects.push(await setStationStreamingInTransaction(conn, Number(row.id), false));
          result.updated += 1;
        } else if (body.action === 'unlock') {
          if (!locked) {
            result.skipped += 1;
            continue;
          }
          await conn.query(
            "UPDATE stations SET status = IF(enabled = 1, 'active', 'disabled') WHERE id = ?",
            [row.id]
          );
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
      }
    });
    if (effects.length > 0) {
      await notifyStationStreamingChange({
        relayJobIds: [...new Set(effects.flatMap((effect) => effect.relayJobIds))],
        mountpointIds: [...new Set(effects.flatMap((effect) => effect.mountpointIds))]
      });
    }
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
    await assertRecordScope(req, before.owner_web_user_id, 'owner_web_user_id', before.company_id);
    if (Number(before.enabled) === 1) {
      throw new ApiError(400, 'STATION_ENABLED', 'Trạm đang bật, phải tắt trước khi xóa');
    }
    if (String(before.status) === 'locked') {
      throw new ApiError(400, 'STATION_LOCKED', 'Trạm đang khóa, phải mở khóa trước khi xóa');
    }
    const result = await withTransaction((conn) => deleteStationCascade(conn, id));
    await notifyStationStreamingChange({
      relayJobIds: result.relayJobIds,
      mountpointIds: result.mountpointIds
    });
    await writeAudit(
      adminPool,
      req.auth!.id,
      'delete',
      'station',
      id,
      before,
      { mountpointIds: result.mountpointIds, relayJobIds: result.relayJobIds },
      ipFrom(req)
    );
    publishEntityChange({ entity: 'station', id, action: 'delete' });
    res.status(204).send();
  })
);
