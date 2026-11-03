import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { ApiError } from './http';
import { decryptSecret, secretAad } from './crypto';

export interface EndpointOption {
  host: string;
  port: number;
  mount: string;
  ssl: boolean;
  ntripVersion: 'v1' | 'v2';
  username: string;
  hasPassword: boolean;
  mountpointId: number | null;
}

export interface StationMountpointOption {
  id: number;
  name: string;
  port: number | null;
  requiresAuth: boolean;
}

export interface StationOption {
  id: number;
  name: string;
  companyId: number | null;
  companyName: string | null;
  sourceRole: 'ntrip_client' | 'ntrip_caster';
  source: EndpointOption | null;
  destination: EndpointOption | null;
  mountpoints: StationMountpointOption[];
}

export interface ResolvedStationEndpoint {
  endpoint: {
    host: string;
    port: number;
    mount: string;
    proxy: '';
    ssl: boolean;
    ntripVersion: 'v1' | 'v2';
  };
  credential: { username: string; password: string } | null;
  stationId: number;
  mountpointId: number | null;
}

export interface ScopeClause {
  sql: string;
  params: unknown[];
}

interface StationRow extends RowDataPacket {
  id: number;
  name: string;
  company_id: number | null;
  company_name: string | null;
  source_role: 'ntrip_client' | 'ntrip_caster' | null;
  client_host: string | null;
  client_port: number | null;
  client_mount: string | null;
  client_tls: number | null;
  client_username: string | null;
  client_password_enc: string | null;
  caster_username: string | null;
  caster_password_enc: string | null;
  caster_version: 'v1' | 'v2' | null;
  caster_requires_auth: number | null;
  ntrip_version: 'v1' | 'v2' | null;
  listener_port: number | null;
}

const STATION_SELECT = `
  SELECT s.id, s.name, s.company_id, c.name AS company_name, s.ntrip_version,
         ss.source_role, ss.client_host, ss.client_port, ss.client_mount, ss.client_tls,
         ss.client_username, ss.client_password_enc,
         ss.caster_username, ss.caster_password_enc, ss.caster_version,
         COALESCE(ss.caster_requires_auth, 1) AS caster_requires_auth,
         cl.port AS listener_port
    FROM stations s
    LEFT JOIN companies c ON c.id = s.company_id
    LEFT JOIN station_sources ss ON ss.station_id = s.id
    LEFT JOIN caster_listeners cl ON cl.id = ss.caster_listener_id AND cl.enabled = 1`;

function decryptStoredSecret(payload: string, aad?: string): string {
  // v2 bắt buộc AAD; v1 (dữ liệu cũ) không có AAD.
  if (payload.startsWith('v2:')) {
    if (!aad) throw new Error('Secret v2 thiếu AAD');
    return decryptSecret(payload, undefined, aad);
  }
  return decryptSecret(payload);
}

async function loadMountpoints(stationIds: number[]): Promise<Map<number, StationMountpointOption[]>> {
  const map = new Map<number, StationMountpointOption[]>();
  if (stationIds.length === 0) return map;
  const placeholders = stationIds.map(() => '?').join(',');
  const rows = await query<RowDataPacket[]>(
    `SELECT m.station_id, m.id, m.name, m.requires_auth, MIN(l.port) AS port
       FROM mountpoints m
       LEFT JOIN caster_listener_mountpoints lm ON lm.mountpoint_id = m.id
       LEFT JOIN caster_listeners l ON l.id = lm.listener_id AND l.enabled = 1
      WHERE m.enabled = 1 AND m.station_id IN (${placeholders})
      GROUP BY m.station_id, m.id, m.name, m.requires_auth
      ORDER BY m.name`,
    stationIds
  );
  for (const row of rows) {
    const list = map.get(Number(row.station_id)) ?? [];
    list.push({
      id: Number(row.id),
      name: String(row.name),
      port: row.port === null ? null : Number(row.port),
      requiresAuth: Boolean(row.requires_auth)
    });
    map.set(Number(row.station_id), list);
  }
  return map;
}

function internalEndpoint(
  row: StationRow,
  mountpoint: StationMountpointOption,
  port: number
): EndpointOption {
  return {
    host: '127.0.0.1',
    port,
    mount: mountpoint.name,
    ssl: false,
    ntripVersion: row.caster_version ?? 'v2',
    username: String(row.caster_username ?? ''),
    hasPassword: Boolean(row.caster_password_enc),
    mountpointId: mountpoint.id
  };
}

function clientEndpoint(row: StationRow): EndpointOption | null {
  if (!row.client_host || !row.client_mount) return null;
  return {
    host: String(row.client_host),
    port: Number(row.client_port ?? 1509),
    mount: String(row.client_mount),
    ssl: Boolean(row.client_tls),
    ntripVersion: row.ntrip_version ?? 'v2',
    username: String(row.client_username ?? ''),
    hasPassword: Boolean(row.client_password_enc),
    mountpointId: null
  };
}

function stationOption(
  row: StationRow,
  mountpoints: StationMountpointOption[]
): StationOption {
  const internal = mountpoints.filter(
    (mountpoint) => mountpoint.port !== null || row.listener_port !== null
  );
  const first = internal[0] ?? null;
  const source =
    first && (first.port ?? row.listener_port) !== null
      ? internalEndpoint(row, first, Number(first.port ?? row.listener_port))
      : clientEndpoint(row);
  return {
    id: Number(row.id),
    name: String(row.name),
    companyId: row.company_id === null ? null : Number(row.company_id),
    companyName: row.company_name === null ? null : String(row.company_name),
    sourceRole: row.source_role ?? 'ntrip_caster',
    source,
    destination: first
      ? internalEndpoint(row, first, Number(first.port ?? row.listener_port))
      : null,
    mountpoints: mountpoints.map((mountpoint) => ({
      ...mountpoint,
      port: mountpoint.port ?? row.listener_port
    }))
  };
}

export async function loadStationOptions(scope: ScopeClause): Promise<StationOption[]> {
  const rows = await query<StationRow[]>(
    `${STATION_SELECT}
      WHERE s.enabled = 1 AND s.status <> 'locked' AND (${scope.sql})
      ORDER BY s.name`,
    scope.params
  );
  const mountpoints = await loadMountpoints(rows.map((row) => Number(row.id)));
  return rows.map((row) => stationOption(row, mountpoints.get(Number(row.id)) ?? []));
}

export async function resolveStationEndpoint(
  scope: ScopeClause,
  stationId: number,
  mountpointId: number | null,
  direction: 'source' | 'destination'
): Promise<ResolvedStationEndpoint> {
  const rows = await query<StationRow[]>(
    `${STATION_SELECT}
      WHERE s.id = ? AND (${scope.sql})
      LIMIT 1`,
    [stationId, ...scope.params]
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'STATION_NOT_FOUND', 'Không tìm thấy trạm trong phạm vi quyền');
  if (!row.listener_port && !row.client_host) {
    throw new ApiError(400, 'STATION_NO_ENDPOINT', 'Trạm chưa có listener hoặc cấu hình nguồn');
  }

  const mountpoints = (await loadMountpoints([stationId])).get(stationId) ?? [];
  const selected =
    mountpointId !== null
      ? mountpoints.find((mountpoint) => mountpoint.id === mountpointId) ?? null
      : mountpoints[0] ?? null;
  if (mountpointId !== null && !selected) {
    throw new ApiError(400, 'STATION_MOUNTPOINT_NOT_FOUND', 'Mountpoint không thuộc trạm đã chọn');
  }

  const port = selected ? selected.port ?? row.listener_port : null;
  let endpoint: ResolvedStationEndpoint['endpoint'];
  let username = '';
  let encrypted: string | null = null;
  let aad: string | undefined;
  let requiresAuth = false;

  if (selected && port !== null) {
    endpoint = {
      host: '127.0.0.1',
      port: Number(port),
      mount: selected.name,
      proxy: '',
      ssl: false,
      ntripVersion: row.caster_version ?? 'v2'
    };
    username = String(row.caster_username ?? '');
    encrypted = row.caster_password_enc;
    requiresAuth = selected.requiresAuth;
    // Trạm nguồn no-auth: đẩy dữ liệu vào mountpoint local không cần credential
    // (chiều đọc vẫn do requires_auth của mountpoint quyết định).
    if (direction === 'destination' && Number(row.caster_requires_auth ?? 1) === 0) {
      requiresAuth = false;
      username = '';
      encrypted = null;
    }
  } else if (direction === 'source') {
    const client = clientEndpoint(row);
    if (!client) {
      throw new ApiError(400, 'STATION_NO_ENDPOINT', 'Trạm chưa có mountpoint hoặc nguồn NTRIP');
    }
    endpoint = { ...client, proxy: '' };
    username = client.username;
    encrypted = row.client_password_enc;
    aad = secretAad('station_sources', 'client_password_enc', stationId);
    requiresAuth = true;
  } else {
    throw new ApiError(400, 'STATION_NO_ENDPOINT', 'Trạm đích chưa có mountpoint trên caster');
  }

  if (requiresAuth && !encrypted) {
    throw new ApiError(
      400,
      'STATION_CREDENTIAL_REQUIRED',
      'Trạm chưa có mật khẩu NTRIP để relay dùng'
    );
  }
  const credential =
    username || encrypted
      ? {
          username,
          password: encrypted ? decryptStoredSecret(encrypted, aad) : ''
        }
      : null;
  return {
    endpoint,
    credential,
    stationId,
    mountpointId: selected ? selected.id : null
  };
}
