import type { PoolConnection } from 'mysql2/promise';
import { ApiError } from './http';
import { encryptSecret } from './crypto';
import { hashPassword } from './password';
import { uniqueMountpointName } from './stationNaming';

export interface StationSourceInput {
  name: string;
  enabled: boolean;
  source_role: 'ntrip_client' | 'ntrip_caster';
  caster_listener_id?: number | null;
  caster_username?: string;
  caster_password?: string;
  caster_requires_auth?: boolean;
  client_host?: string;
  client_port?: number;
  client_mount?: string;
  client_username?: string;
  client_password?: string;
  client_tls?: boolean;
  client_send_gga?: boolean;
  client_nmea_interval_sec?: number;
  client_gga_lat?: number | null;
  client_gga_lon?: number | null;
}

export interface CreatedStationResources {
  mountpointId: number;
  mountpointName: string;
  accountId: number | null;
  accountUsername: string | null;
}

export async function createStationResources(
  conn: PoolConnection,
  stationId: number,
  data: StationSourceInput,
  ownerId: number,
  actorId: number
): Promise<CreatedStationResources> {
  const mountpointName = await uniqueMountpointName(conn, data.name);
  const mountpointEnabled = data.enabled ? 1 : 0;
  const pausedBy = data.enabled ? null : stationId;
  const [mountpointResult] = await conn.query<any>(
    `INSERT INTO mountpoints
       (name, station_id, enabled, paused_by_station_id, description,
        owner_web_user_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      mountpointName,
      stationId,
      mountpointEnabled,
      pausedBy,
      'Tự sinh khi tạo trạm',
      ownerId,
      actorId
    ]
  );
  const mountpointId = Number(mountpointResult.insertId);

  if (data.source_role === 'ntrip_caster') {
    if (!data.caster_listener_id) {
      throw new ApiError(400, 'INVALID_LISTENER', 'Caster listener là bắt buộc');
    }
    const [listeners] = await conn.query<any[]>(
      'SELECT id, owner_web_user_id FROM caster_listeners WHERE id = ? LIMIT 1',
      [data.caster_listener_id]
    );
    if (listeners.length === 0) {
      throw new ApiError(400, 'INVALID_LISTENER', 'Caster listener không tồn tại');
    }
    await conn.query(
      `INSERT INTO station_sources
         (station_id, source_role, caster_version, caster_username,
          caster_password_enc, caster_requires_auth, caster_listener_id)
       VALUES (?, 'ntrip_caster', 'v2', ?, ?, ?, ?)`,
      [
        stationId,
        data.caster_username ?? '',
        data.caster_password ? encryptSecret(data.caster_password) : null,
        data.caster_requires_auth === false ? 0 : 1,
        data.caster_listener_id
      ]
    );
    await conn.query(
      'INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id) VALUES (?, ?)',
      [data.caster_listener_id, mountpointId]
    );

    const username = String(data.caster_username ?? '').trim();
    const [existingAccounts] = await conn.query<any[]>(
      'SELECT id FROM ntrip_accounts WHERE username = ? LIMIT 1',
      [username]
    );
    if (existingAccounts.length > 0) {
      throw new ApiError(
        409,
        'ACCOUNT_EXISTS',
        'Username NTRIP đã tồn tại; chọn username khác cho trạm'
      );
    }
    if (!data.caster_password) {
      throw new ApiError(400, 'PASSWORD_REQUIRED', 'Caster password là bắt buộc');
    }
    const passwordHash = await hashPassword(data.caster_password);
    const [accountResult] = await conn.query<any>(
      `INSERT INTO ntrip_accounts
         (username, password_hash, enabled, max_connections, owner_web_user_id,
          created_by, managed_by_station_id)
       VALUES (?, ?, 1, 1, ?, ?, ?)`,
      [username, passwordHash, ownerId, actorId, stationId]
    );
    const accountId = Number(accountResult.insertId);
    await conn.query(
      'INSERT INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
      [accountId, mountpointId]
    );
    await conn.query(
      'INSERT INTO account_listener_acl (account_id, listener_id) VALUES (?, ?)',
      [accountId, data.caster_listener_id]
    );
    return {
      mountpointId,
      mountpointName,
      accountId,
      accountUsername: username
    };
  }

  await conn.query(
    `INSERT INTO station_sources
       (station_id, source_role, client_host, client_port, client_mount,
        client_username, client_password_enc, client_tls, client_send_gga,
        client_nmea_interval_sec, client_gga_lat, client_gga_lon)
     VALUES (?, 'ntrip_client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stationId,
      data.client_host ?? '',
      data.client_port ?? 1509,
      data.client_mount ?? '',
      data.client_username ?? '',
      data.client_password ? encryptSecret(data.client_password) : null,
      data.client_tls ? 1 : 0,
      data.client_send_gga ? 1 : 0,
      data.client_nmea_interval_sec ?? 0,
      data.client_send_gga ? data.client_gga_lat ?? null : null,
      data.client_send_gga ? data.client_gga_lon ?? null : null
    ]
  );

  return {
    mountpointId,
    mountpointName,
    accountId: null,
    accountUsername: null
  };
}
