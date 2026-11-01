import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { asyncHandler } from '../lib/http';
import { ecefToGeodetic } from '../lib/geo';
import { fetchLiveQuality } from '../lib/quality';
import { transportStatusFor } from '../lib/stationDetail';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { listScope, scopeIdsFor } from '../rbac/access';

export const mapRouter = Router();
mapRouter.use(requireAuth);
mapRouter.use(csrfProtection);

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

function sourceTypeOf(row: RowDataPacket, relayJobCount: number): string {
  if (relayJobCount > 0 && (!row.source_type || row.source_type === 'manual')) {
    return 'relay_caster';
  }
  if (row.source_type) return String(row.source_type);
  if (row.ntrip_mode === 'ntrip_client') return 'probe_client';
  return 'manual';
}

mapRouter.get(
  '/overview',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 's.owner_web_user_id');
    const params: unknown[] = [...scope.params];
    let where = scope.sql;
    const q = String(req.query.q || '').trim();
    if (q) {
      where += ' AND (s.name LIKE ? OR s.region LIKE ? OR s.address LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const region = String(req.query.region || '').trim();
    if (region) {
      where += ' AND s.region = ?';
      params.push(region);
    }
    const owner = Number(req.query.owner || 0);
    if (Number.isInteger(owner) && owner > 0) {
      where += ' AND s.owner_web_user_id = ?';
      params.push(owner);
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT s.id, s.name, s.region, s.address, s.source_type, s.ntrip_mode,
              s.enabled, s.status,
              s.owner_web_user_id, u.display_name AS owner_name
         FROM stations s
         LEFT JOIN web_users u ON u.id = s.owner_web_user_id
        WHERE ${where}
        ORDER BY s.id
        LIMIT 1000`,
      params
    );
    const stationIds = rows.map((row) => Number(row.id));
    const [latestRows, mountpointRows, live] = await Promise.all([
      stationIds.length
        ? runtimeQuery<RowDataPacket[]>(
            `SELECT target_id, state, score, ts, arp_x, arp_y, arp_z, reported_station_id
               FROM (
                 SELECT qs.*, ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY ts DESC, id DESC) AS rn
                   FROM quality_samples qs
                  WHERE target_type = 'station' AND direction = 'ingest'
                    AND target_id IN (${placeholders(stationIds)})
               ) ranked WHERE rn = 1`,
            stationIds
          )
        : [],
      stationIds.length
        ? query<RowDataPacket[]>(
            `SELECT m.id, m.station_id, m.name,
                    (SELECT COUNT(*) FROM relay_jobs r
                      WHERE r.deleted_at IS NULL AND r.upstream_mount = m.name) AS relay_count
               FROM mountpoints m WHERE m.station_id IN (${placeholders(stationIds)})`,
            stationIds
          )
        : [],
      fetchLiveQuality(1500)
    ]);

    const latestMap = new Map<number, any>();
    for (const row of latestRows) latestMap.set(Number(row.target_id), row);
    const liveMap = new Map<number, any>();
    for (const item of live.items) {
      if (item.targetType === 'station' && item.direction === 'ingest') {
        liveMap.set(item.targetId, item);
      }
    }
    const mountpointCount = new Map<number, number>();
    const relayCount = new Map<number, number>();
    const stationByMountpoint = new Map<number, number>();
    const mountpointIds: number[] = [];
    for (const row of mountpointRows) {
      const stationId = Number(row.station_id);
      mountpointCount.set(stationId, (mountpointCount.get(stationId) ?? 0) + 1);
      relayCount.set(stationId, (relayCount.get(stationId) ?? 0) + Number(row.relay_count ?? 0));
      mountpointIds.push(Number(row.id));
      stationByMountpoint.set(Number(row.id), stationId);
    }

    const onlineSets = new Map<number, Set<string>>();
    if (mountpointIds.length > 0) {
      const connectionRows = await runtimeQuery<RowDataPacket[]>(
        `SELECT id, mountpoint_id, account_id FROM caster_connections
          WHERE end_ts IS NULL AND mountpoint_id IN (${placeholders(mountpointIds)})`,
        mountpointIds
      );
      for (const row of connectionRows) {
        const stationId = stationByMountpoint.get(Number(row.mountpoint_id));
        if (!stationId) continue;
        const set = onlineSets.get(stationId) ?? new Set<string>();
        set.add(row.account_id === null ? `conn:${row.id}` : `account:${row.account_id}`);
        onlineSets.set(stationId, set);
      }
    }

    const now = Date.now();
    const items = rows.map((row) => {
      const stationId = Number(row.id);
      const latest = latestMap.get(stationId) ?? null;
      const has1005 =
        latest?.reported_station_id !== null &&
        latest?.reported_station_id !== undefined &&
        latest?.arp_x !== null &&
        latest?.arp_x !== undefined &&
        latest?.arp_y !== null &&
        latest?.arp_y !== undefined &&
        latest?.arp_z !== null &&
        latest?.arp_z !== undefined;
      let lat: number | null = null;
      let lon: number | null = null;
      if (has1005) {
        const point = ecefToGeodetic(
          Number(latest.arp_x) / 10000,
          Number(latest.arp_y) / 10000,
          Number(latest.arp_z) / 10000
        );
        lat = point.lat;
        lon = point.lon;
      }
      const liveItem = liveMap.get(stationId);
      const ageMs = liveItem
        ? liveItem.ageMs
        : latest?.ts
          ? Math.max(0, now - new Date(latest.ts).getTime())
          : null;
      const stationOff = Number(row.enabled) === 0 || String(row.status) === 'locked';
      const state = stationOff ? 'disabled' : liveItem?.state ?? latest?.state;
      const score = stationOff
        ? null
        : liveItem
          ? liveItem.score
          : latest
            ? Number(latest.score)
            : null;
      const relays = relayCount.get(stationId) ?? 0;
      return {
        id: stationId,
        name: String(row.name),
        lat,
        lon,
        has1005,
        transport: stationOff ? 'offline' : transportStatusFor(state, ageMs),
        quality: state ? String(state) : 'unknown',
        score,
        sourceType: sourceTypeOf(row, relays),
        mountpointCount: mountpointCount.get(stationId) ?? 0,
        relayJobCount: relays,
        onlineAccounts: onlineSets.get(stationId)?.size ?? 0,
        region: String(row.region ?? ''),
        address: String(row.address ?? ''),
        ownerWebUserId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
        ownerName: row.owner_name ?? null
      };
    });

    const counts = {
      all: items.length,
      online: items.filter((item) => item.transport === 'online').length,
      issues: items.filter(
        (item) => item.transport === 'no_data' || item.transport === 'offline' || item.transport === 'error'
      ).length,
      online_accounts: items.filter((item) => item.onlineAccounts > 0).length,
      missing_1005: items.filter((item) => !item.has1005).length
    };
    const layer = String(req.query.layer || 'all');
    const filtered = items.filter((item) => {
      if (layer === 'online') return item.transport === 'online';
      if (layer === 'issues') {
        return item.transport === 'no_data' || item.transport === 'offline' || item.transport === 'error';
      }
      if (layer === 'online_accounts') return item.onlineAccounts > 0;
      if (layer === 'missing_1005') return !item.has1005;
      return true;
    });

    const [regionRows, ownerRows] = await Promise.all([
      query<RowDataPacket[]>(
        `SELECT DISTINCT s.region FROM stations s
          WHERE ${scope.sql} AND s.region <> '' ORDER BY s.region`,
        scope.params
      ),
      query<RowDataPacket[]>(
        `SELECT DISTINCT s.owner_web_user_id, u.display_name AS owner_name
           FROM stations s
           LEFT JOIN web_users u ON u.id = s.owner_web_user_id
          WHERE ${scope.sql} AND s.owner_web_user_id IS NOT NULL
          ORDER BY owner_name`,
        scope.params
      )
    ]);

    res.json({
      items: filtered.slice(0, 1000),
      total: filtered.length,
      counts,
      regions: regionRows.map((row) => String(row.region)),
      owners: ownerRows.map((row) => ({
        id: Number(row.owner_web_user_id),
        name: String(row.owner_name ?? row.owner_web_user_id)
      })),
      filters: { q, region, owner: owner > 0 ? owner : null, layer }
    });
  })
);

