import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { callGoInternal } from './internalApi';

export type TargetType = 'station' | 'relay_job';
export type Direction = 'ingest' | 'upstream' | 'downstream';

export interface QualityLive {
  targetType: TargetType;
  targetId: number;
  mountpointId: number;
  direction: Direction;
  ts: string;
  score: number;
  scoreParts: {
    transport: number;
    integrity: number;
    msm: number;
    metadata: number;
    signal: number;
    latency: number;
  };
  state: string;
  frames: number;
  bytes: number;
  crcErrors: number;
  parseErrors: number;
  lengthErrors: number;
  unknownMessages: number;
  msmEpochs: number;
  satellites: number;
  signals: number;
  cells: number;
  avgCnr: number;
  cnrAvailable: boolean;
  reportedStationId?: number;
  arpX?: number;
  arpY?: number;
  arpZ?: number;
  arpDeltaM?: number;
  antenna?: string;
  ageMs: number;
  latencyMs: number;
  cycleSlips: number;
  cycleSlipRate: number;
  codePhaseRmsM: number;
  codePhaseSamples: number;
  observations: number;
  skyPlotAvailable: boolean;
  skyPlotReason?: string;
  gaps: number;
  metadataOk: boolean;
  baselineSatellites: number;
  baselineCells: number;
  messageTypes: Record<string, number>;
  parity?: number;
  jobScore?: number;
  live: boolean;
}

export interface QualitySample {
  id: number;
  targetType: TargetType;
  targetId: number;
  mountpointId: number;
  direction: Direction;
  ts: string;
  windowSec: number;
  score: number;
  state: string;
  frames: number;
  bytes: number;
  crcErrors: number;
  parseErrors: number;
  unknownMessages: number;
  msmEpochs: number;
  satellites: number;
  signals: number;
  cells: number;
  avgCnr: number | null;
  reportedStationId: number | null;
  arpX: number | null;
  arpY: number | null;
  arpZ: number | null;
  arpDeltaM: number | null;
  antenna: string | null;
  ageMs: number;
  gaps: number;
  cnrAvailable: boolean;
  details: unknown;
}

export interface QualityAlert {
  id: number;
  targetType: TargetType;
  targetId: number;
  mountpointId: number;
  direction: Direction;
  eventType: string;
  code: string;
  level: 'critical' | 'major' | 'minor' | 'info';
  severity: 'critical' | 'warning' | 'info';
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
  status: 'open' | 'resolved';
  details: unknown;
  ownerWebUserId: number | null;
  ackedAt: string | null;
  ackedBy: number | null;
  ackNote: string | null;
}

export interface OwnerMaps {
  stations: Map<number, { ownerId: number | null; name: string; mountpoints: Map<number, string> }>;
  mountpointNames: Map<number, string>;
  jobs: Map<number, { ownerId: number | null; name: string }>;
}

export async function loadOwnerMaps(): Promise<OwnerMaps> {
  const stationRows = await query<RowDataPacket[]>(
    'SELECT id, name, owner_web_user_id FROM stations'
  );
  const mountpointRows = await query<RowDataPacket[]>(
    'SELECT id, name, station_id FROM mountpoints'
  );
  const jobRows = await query<RowDataPacket[]>(
    'SELECT id, name, owner_web_user_id FROM relay_jobs WHERE deleted_at IS NULL'
  );

  const stations: OwnerMaps['stations'] = new Map();
  for (const row of stationRows) {
    stations.set(Number(row.id), {
      ownerId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
      name: String(row.name ?? ''),
      mountpoints: new Map()
    });
  }
  const mountpointNames = new Map<number, string>();
  for (const row of mountpointRows) {
    const id = Number(row.id);
    const name = String(row.name ?? '');
    mountpointNames.set(id, name);
    const station = stations.get(Number(row.station_id));
    if (station) station.mountpoints.set(id, name);
  }
  const jobs: OwnerMaps['jobs'] = new Map();
  for (const row of jobRows) {
    jobs.set(Number(row.id), {
      ownerId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
      name: String(row.name ?? '')
    });
  }
  return { stations, mountpointNames, jobs };
}

export function targetOwner(
  maps: OwnerMaps,
  targetType: string,
  targetId: number
): number | null {
  if (targetType === 'station') return maps.stations.get(targetId)?.ownerId ?? null;
  if (targetType === 'relay_job') return maps.jobs.get(targetId)?.ownerId ?? null;
  return null;
}

export function targetName(
  maps: OwnerMaps,
  targetType: string,
  targetId: number,
  mountpointId = 0
): string {
  if (targetType === 'station') {
    const station = maps.stations.get(targetId);
    if (!station) return `Station #${targetId}`;
    const mountpoint = mountpointId ? station.mountpoints.get(mountpointId) : null;
    return mountpoint ? `${station.name} / ${mountpoint}` : station.name;
  }
  return maps.jobs.get(targetId)?.name ?? `Relay #${targetId}`;
}

export function severityForLevel(level: string): 'critical' | 'warning' | 'info' {
  if (level === 'critical') return 'critical';
  if (level === 'major') return 'warning';
  return 'info';
}

export async function fetchLiveQuality(timeoutMs = 1500): Promise<{
  ok: boolean;
  items: QualityLive[];
  ts: string;
}> {
  try {
    const response = await callGoInternal<{ items: QualityLive[]; time?: string }>(
      '/internal/rtcm/snapshot',
      undefined,
      { method: 'GET', timeoutMs }
    );
    return {
      ok: true,
      items: response?.items ?? [],
      ts: response?.time ?? new Date().toISOString()
    };
  } catch {
    return { ok: false, items: [], ts: new Date().toISOString() };
  }
}

export function mapSample(row: any): QualitySample {
  return {
    id: Number(row.id),
    targetType: row.target_type,
    targetId: Number(row.target_id),
    mountpointId: Number(row.mountpoint_id ?? 0),
    direction: row.direction,
    ts: new Date(row.ts).toISOString(),
    windowSec: Number(row.window_sec ?? 60),
    score: Number(row.score ?? 0),
    state: String(row.state ?? 'unknown'),
    frames: Number(row.frames ?? 0),
    bytes: Number(row.bytes ?? 0),
    crcErrors: Number(row.crc_errors ?? 0),
    parseErrors: Number(row.parse_errors ?? 0),
    unknownMessages: Number(row.unknown_messages ?? 0),
    msmEpochs: Number(row.msm_epochs ?? 0),
    satellites: Number(row.satellites ?? 0),
    signals: Number(row.signals ?? 0),
    cells: Number(row.cells ?? 0),
    avgCnr: row.avg_cnr === null || row.avg_cnr === undefined ? null : Number(row.avg_cnr),
    reportedStationId:
      row.reported_station_id === null || row.reported_station_id === undefined
        ? null
        : Number(row.reported_station_id),
    arpX: row.arp_x === null || row.arp_x === undefined ? null : Number(row.arp_x),
    arpY: row.arp_y === null || row.arp_y === undefined ? null : Number(row.arp_y),
    arpZ: row.arp_z === null || row.arp_z === undefined ? null : Number(row.arp_z),
    arpDeltaM:
      row.arp_delta_m === null || row.arp_delta_m === undefined
        ? null
        : Number(row.arp_delta_m),
    antenna: row.antenna === null || row.antenna === undefined ? null : String(row.antenna),
    ageMs: Number(row.age_ms ?? 0),
    gaps: Number(row.gaps ?? 0),
    cnrAvailable: Boolean(row.cnr_available),
    details: row.details ?? null
  };
}

export async function loadAckMap(alertIds: number[]): Promise<
  Map<number, { ackedAt: string; ackedBy: number; note: string }>
> {
  if (alertIds.length === 0) return new Map();
  const placeholders = alertIds.map(() => '?').join(',');
  const rows = await query<RowDataPacket[]>(
    `SELECT alert_id, web_user_id, acked_at, note
       FROM quality_alert_acks
      WHERE alert_id IN (${placeholders})
      ORDER BY acked_at DESC`,
    alertIds
  );
  const map = new Map<number, { ackedAt: string; ackedBy: number; note: string }>();
  for (const row of rows) {
    const id = Number(row.alert_id);
    if (map.has(id)) continue;
    map.set(id, {
      ackedAt: new Date(row.acked_at).toISOString(),
      ackedBy: Number(row.web_user_id),
      note: String(row.note ?? '')
    });
  }
  return map;
}

export function mapAlert(
  row: any,
  ownerId: number | null,
  ack?: { ackedAt: string; ackedBy: number; note: string }
): QualityAlert {
  const level = ['critical', 'major', 'minor', 'info'].includes(String(row.level))
    ? (String(row.level) as QualityAlert['level'])
    : 'minor';
  const resolvedAt = row.resolved_at ? new Date(row.resolved_at).toISOString() : null;
  return {
    id: Number(row.id),
    targetType: row.target_type,
    targetId: Number(row.target_id),
    mountpointId: Number(row.mountpoint_id ?? 0),
    direction: row.direction,
    eventType: String(row.event_type ?? 'station_alert'),
    code: String(row.code ?? ''),
    level,
    severity: severityForLevel(level),
    firstSeen: new Date(row.first_seen).toISOString(),
    lastSeen: new Date(row.last_seen).toISOString(),
    resolvedAt,
    status: resolvedAt ? 'resolved' : 'open',
    details: row.details ?? null,
    ownerWebUserId: ownerId,
    ackedAt: ack?.ackedAt ?? null,
    ackedBy: ack?.ackedBy ?? null,
    ackNote: ack?.note ?? null
  };
}

export async function loadQualityAlertsByIds(ids: number[]): Promise<any[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return runtimeQuery(`SELECT * FROM quality_alerts WHERE id IN (${placeholders})`, ids);
}

export function parseWindowMinutes(raw: unknown, fallback = 15): number {
  const value = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(24 * 60, value);
}
