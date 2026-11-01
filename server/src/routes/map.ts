import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { asyncHandler } from '../lib/http';
import {
  getMapConfig,
  isMapMode,
  parseTileCoord,
  MapMode
} from '../lib/mapConfig';
import { fetchCasterConnections } from '../lib/caster';
import {
  aggregateFixStatus,
  AccountFixStatus,
  normalizeFixType
} from '../lib/mapAccountStatus';
import { resolveStationCoords } from '../lib/mapCoords';
import { fetchLiveQuality } from '../lib/quality';
import { transportStatusFor } from '../lib/stationDetail';
import { fetchTile, TRANSPARENT_PNG } from '../lib/tileProxy';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { listScope, scopeIdsFor } from '../rbac/access';
import { permissionsForRole } from '../rbac/permissions';
import { inScope, Scope, scopeClause, subtreeIds, tenantIds } from '../rbac/scope';

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

const TRANSPORT_VALUES = new Set(['online', 'stale', 'no_data', 'offline', 'error', 'unknown']);

function parseList(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function relayScopeClause(scope: Scope, actorId: number): Promise<{ sql: string; params: unknown[] }> {
  if (scope === 'all') return { sql: '1=1', params: [] };
  if (scope === 'tenant') return { sql: '__TENANT__', params: [] };
  if (scope === 'own') return { sql: 'r.owner_web_user_id = ?', params: [actorId] };
  if (scope === 'subtree') {
    const ids = await subtreeIds(actorId);
    return {
      sql: scopeClause('subtree', actorId, ids, 'r.owner_web_user_id').sql,
      params: ids
    };
  }
  return { sql: '1=0', params: [] };
}

mapRouter.get(
  '/tiles/:z/:x/:y',
  asyncHandler(async (req, res) => {
    const config = await getMapConfig();
    if (config.tileMode !== 'proxy') {
      res.status(404).json({
        error: { code: 'TILE_PROXY_DISABLED', message: 'Tile proxy đang tắt' }
      });
      return;
    }
    const coord = parseTileCoord(req.params.z, req.params.x, req.params.y);
    if (!coord) {
      res.status(400).json({
        error: { code: 'INVALID_TILE', message: 'Toạ độ tile không hợp lệ' }
      });
      return;
    }
    const modeRaw = String(req.query.mode ?? 'streets');
    if (!isMapMode(modeRaw)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: 'Mode tile không hợp lệ' }
      });
      return;
    }
    const mode = modeRaw as MapMode;
    const result = await fetchTile(mode, coord.z, coord.x, coord.y);
    if (!result) {
      res.status(502);
      res.setHeader('X-Tile-Proxy-Status', 'fallback');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(TRANSPARENT_PNG);
      return;
    }
    res.status(200);
    res.setHeader('X-Tile-Proxy-Status', 'ok');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(result.buffer);
  })
);

mapRouter.get(
  '/overview',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const perms = await permissionsForRole(req.auth!.roleId);
    const scopeOf = (code: string): Scope =>
      (perms.find((item) => item.code === code)?.scope ?? 'none') as Scope;
    const qualityScope = scopeOf('quality.view');
    const relayScope = scopeOf('relay.view');
    const connectionsScope = scopeOf('connections.view');
    const qualityAllowed = qualityScope !== 'none';
    const relayAllowed = relayScope !== 'none';
    const connectionsAllowed = connectionsScope !== 'none';
    const qualityIds =
      qualityScope === 'tenant'
        ? await tenantIds(req.auth!.id)
        : qualityScope === 'subtree'
          ? await subtreeIds(req.auth!.id)
          : [];

    const ids = await scopeIdsFor(req);
    const scope = listScope(req, ids, 's.owner_web_user_id', { companyColumn: 's.company_id' });
    const params: unknown[] = [...scope.params];
    let where = scope.sql;

    const isSuper = req.auth!.roleCode === 'super_admin';
    const companyIdParam = Number(req.query.companyId || 0);
    if (isSuper && Number.isInteger(companyIdParam) && companyIdParam > 0) {
      where += ' AND s.company_id = ?';
      params.push(companyIdParam);
    }
    const baseWhere = where;
    const baseParams: unknown[] = [...params];

    const q = String(req.query.q || '').trim();
    if (q) {
      where +=
        ' AND (s.name LIKE ? OR CAST(s.id AS CHAR) LIKE ? OR s.region LIKE ?' +
        ' OR s.address LIKE ? OR u.display_name LIKE ? OR c.name LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like);
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
    const status = String(req.query.status || '').trim();
    if (status === 'active') {
      where += " AND s.enabled = 1 AND s.status <> 'locked'";
    } else if (status === 'disabled') {
      where += ' AND s.enabled = 0';
    } else if (status === 'locked') {
      where += " AND s.status = 'locked'";
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT s.id, s.name, s.region, s.address, s.source_type, s.ntrip_mode,
              s.enabled, s.status, s.company_id, s.lat, s.lon,
              s.owner_web_user_id, u.display_name AS owner_name, c.name AS company_name
         FROM stations s
         LEFT JOIN web_users u ON u.id = s.owner_web_user_id
         LEFT JOIN companies c ON c.id = s.company_id
        WHERE ${where}
        ORDER BY s.id
        LIMIT 1000`,
      params
    );
    const stationIds = rows.map((row) => Number(row.id));

    const relayCountByMount = new Map<string, number>();
    if (relayAllowed && stationIds.length > 0) {
      const relayScopeValue = await relayScopeClause(relayScope, req.auth!.id);
      const useTenant = relayScopeValue.sql === '__TENANT__';
      const relaySql = useTenant ? 'r.company_id = ?' : relayScopeValue.sql;
      const relayParams = useTenant
        ? [req.auth!.companyId ?? -1]
        : relayScopeValue.params;
      const relayRows = await query<RowDataPacket[]>(
        `SELECT r.upstream_mount, COUNT(*) AS c
           FROM relay_jobs r
          WHERE r.deleted_at IS NULL AND r.upstream_mount IS NOT NULL
            AND ${relaySql}
          GROUP BY r.upstream_mount`,
        relayParams
      );
      for (const row of relayRows) {
        relayCountByMount.set(String(row.upstream_mount), Number(row.c));
      }
    }

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
            `SELECT m.id, m.station_id, m.name
               FROM mountpoints m WHERE m.station_id IN (${placeholders(stationIds)})`,
            stationIds
          )
        : [],
      qualityAllowed ? fetchLiveQuality(1500) : Promise.resolve({ items: [] as any[] })
    ]);

    const latestMap = new Map<number, RowDataPacket>();
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
      relayCount.set(
        stationId,
        (relayCount.get(stationId) ?? 0) + (relayCountByMount.get(String(row.name)) ?? 0)
      );
      mountpointIds.push(Number(row.id));
      stationByMountpoint.set(Number(row.id), stationId);
    }

    const onlineSets = new Map<number, Set<string>>();
    const openAccountIdsByStation = new Map<number, Set<number>>();
    const fixTypeByStationAccount = new Map<number, Map<number, AccountFixStatus>>();

    function addOpenConnection(
      stationId: number,
      connectionId: number,
      accountId: number | null,
      fixType: string | undefined
    ): void {
      const set = onlineSets.get(stationId) ?? new Set<string>();
      set.add(accountId === null ? `conn:${connectionId}` : `account:${accountId}`);
      onlineSets.set(stationId, set);
      if (accountId === null) return;
      const open = openAccountIdsByStation.get(stationId) ?? new Set<number>();
      open.add(accountId);
      openAccountIdsByStation.set(stationId, open);
      const fixMap =
        fixTypeByStationAccount.get(stationId) ?? new Map<number, AccountFixStatus>();
      fixMap.set(accountId, normalizeFixType(fixType));
      fixTypeByStationAccount.set(stationId, fixMap);
    }

    if (connectionsAllowed) {
      const caster = await fetchCasterConnections();
      if (caster.available) {
        for (const item of caster.items) {
          if (item.direction !== 'rover') continue;
          const stationId = stationByMountpoint.get(Number(item.mountpointId));
          if (!stationId) continue;
          const accountId =
            item.accountId === null || item.accountId === undefined
              ? null
              : Number(item.accountId);
          addOpenConnection(stationId, Number(item.id), accountId, item.fixType);
        }
      } else if (mountpointIds.length > 0) {
        const connectionRows = await runtimeQuery<RowDataPacket[]>(
          `SELECT id, mountpoint_id, account_id FROM caster_connections
            WHERE end_ts IS NULL AND mountpoint_id IN (${placeholders(mountpointIds)})`,
          mountpointIds
        );
        for (const row of connectionRows) {
          const stationId = stationByMountpoint.get(Number(row.mountpoint_id));
          if (!stationId) continue;
          const accountId =
            row.account_id === null || row.account_id === undefined
              ? null
              : Number(row.account_id);
          addOpenConnection(stationId, Number(row.id), accountId, undefined);
        }
      }
    }

    const accountUsernameById = new Map<number, string>();
    if (connectionsAllowed) {
      const accountIds = new Set<number>();
      for (const ids of openAccountIdsByStation.values()) {
        for (const id of ids) accountIds.add(id);
      }
      if (accountIds.size > 0) {
        const values = [...accountIds];
        const rows = await query<RowDataPacket[]>(
          `SELECT id, username FROM ntrip_accounts WHERE id IN (${placeholders(values)})`,
          values
        );
        for (const row of rows) {
          accountUsernameById.set(Number(row.id), String(row.username ?? ''));
        }
      }
    }

    const now = Date.now();
    const actorId = req.auth!.id;
    const items = rows.map((row) => {
      const stationId = Number(row.id);
      const ownerId =
        row.owner_web_user_id === null || row.owner_web_user_id === undefined
          ? null
          : Number(row.owner_web_user_id);
      const qualityVisible =
        qualityAllowed && inScope(qualityScope, actorId, qualityIds, ownerId);
      const latest = latestMap.get(stationId) ?? null;
      const coords = resolveStationCoords(latest as never, { lat: row.lat, lon: row.lon });
      const liveItem = liveMap.get(stationId);
      const ageMs = liveItem
        ? liveItem.ageMs
        : latest?.ts
          ? Math.max(0, now - new Date(latest.ts).getTime())
          : null;
      const connectedAccounts: Array<{
        id: number;
        username: string;
        fixType: AccountFixStatus;
      }> = [];
      if (connectionsAllowed) {
        const openIds = openAccountIdsByStation.get(stationId);
        const fixMap = fixTypeByStationAccount.get(stationId);
        if (openIds) {
          for (const accountId of openIds) {
            connectedAccounts.push({
              id: accountId,
              username: accountUsernameById.get(accountId) ?? '',
              fixType: normalizeFixType(fixMap?.get(accountId))
            });
          }
        }
      }
      const accountStatus = connectionsAllowed
        ? aggregateFixStatus(connectedAccounts.map((item) => item.fixType))
        : null;
      const stationOff = Number(row.enabled) === 0 || String(row.status) === 'locked';
      const state = stationOff ? 'disabled' : liveItem?.state ?? latest?.state;
      const transport = stationOff
        ? 'offline'
        : qualityVisible
          ? transportStatusFor(state, ageMs)
          : 'unknown';
      const score = qualityVisible
        ? liveItem
          ? liveItem.score
          : latest
            ? Number(latest.score)
            : null
        : null;
      const relays = relayCount.get(stationId) ?? 0;
      const onlineAccounts = connectionsAllowed
        ? onlineSets.get(stationId)?.size ?? 0
        : 0;
      return {
        id: stationId,
        name: String(row.name),
        lat: coords.lat,
        lon: coords.lon,
        coordSource: coords.coordSource,
        hasCoords: coords.lat !== null && coords.lon !== null,
        qualityVisible,
        has1005: qualityVisible && coords.has1005,
        transport,
        quality: qualityVisible && state ? String(state) : 'unknown',
        score,
        sourceType: sourceTypeOf(row, relays),
        mountpointCount: mountpointCount.get(stationId) ?? 0,
        relayJobCount: relayAllowed ? relays : null,
        onlineAccounts,
        accountStatus,
        connectedAccounts,
        region: String(row.region ?? ''),
        address: String(row.address ?? ''),
        companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
        companyName: row.company_name ?? null,
        ownerWebUserId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
        ownerName: row.owner_name ?? null
      };
    });

    const transportFilter = parseList(req.query.transport).filter((value) =>
      TRANSPORT_VALUES.has(value)
    );
    const hasCoordsFilter = String(req.query.hasCoords ?? '').trim();
    let filtered = items;
    if (transportFilter.length > 0) {
      filtered = filtered.filter((item) => transportFilter.includes(String(item.transport)));
    }
    if (hasCoordsFilter === '1' || hasCoordsFilter === 'true') {
      filtered = filtered.filter((item) => item.hasCoords);
    } else if (hasCoordsFilter === '0' || hasCoordsFilter === 'false') {
      filtered = filtered.filter((item) => !item.hasCoords);
    }
    const layer = String(req.query.layer || 'all');
    filtered = filtered.filter((item) => {
      if (layer === 'online') return item.transport === 'online';
      if (layer === 'issues') {
        return (
          item.transport === 'no_data' ||
          item.transport === 'offline' ||
          item.transport === 'error'
        );
      }
      if (layer === 'online_accounts') return connectionsAllowed && item.onlineAccounts > 0;
      if (layer === 'missing_coords') return !item.hasCoords;
      if (layer === 'missing_1005') return !item.has1005;
      return true;
    });

    const [regionRows, ownerRows] = await Promise.all([
      query<RowDataPacket[]>(
        `SELECT DISTINCT s.region FROM stations s
          WHERE ${baseWhere} AND s.region <> '' ORDER BY s.region`,
        baseParams
      ),
      query<RowDataPacket[]>(
        `SELECT DISTINCT s.owner_web_user_id, u.display_name AS owner_name
           FROM stations s
           LEFT JOIN web_users u ON u.id = s.owner_web_user_id
          WHERE ${baseWhere} AND s.owner_web_user_id IS NOT NULL
          ORDER BY owner_name`,
        baseParams
      )
    ]);

    const layersAvailable = ['stations', 'online', 'issues', 'missing_coords'];
    if (connectionsAllowed) layersAvailable.push('online_accounts');

    const stationStatus = {
      online: 0,
      stale: 0,
      no_data: 0,
      offline: 0,
      error: 0,
      unknown: 0
    };
    for (const item of items) {
      const value = String(item.transport);
      if (value in stationStatus) {
        stationStatus[value as keyof typeof stationStatus] += 1;
      } else {
        stationStatus.unknown += 1;
      }
    }

    const accountStatusCounts: Record<AccountFixStatus, number> = {
      single: 0,
      fixed: 0,
      float: 0,
      rtd: 0,
      error: 0
    };
    if (connectionsAllowed) {
      const uniqueAccounts = new Map<number, AccountFixStatus>();
      for (const item of filtered) {
        for (const account of item.connectedAccounts) {
          const previous = uniqueAccounts.get(account.id);
          uniqueAccounts.set(
            account.id,
            previous
              ? aggregateFixStatus([previous, account.fixType]) ?? account.fixType
              : account.fixType
          );
        }
      }
      for (const status of uniqueAccounts.values()) accountStatusCounts[status] += 1;
    }

    const counts = {
      all: items.length,
      online: items.filter((item) => item.transport === 'online').length,
      issues: items.filter(
        (item) =>
          item.transport === 'no_data' ||
          item.transport === 'offline' ||
          item.transport === 'error'
      ).length,
      online_accounts: connectionsAllowed
        ? items.filter((item) => item.onlineAccounts > 0).length
        : 0,
      withCoords: items.filter((item) => item.hasCoords).length,
      missingCoords: items.filter((item) => !item.hasCoords).length,
      missing_1005: items.filter((item) => item.qualityVisible && !item.has1005).length,
      stationStatus,
      accountStatus: accountStatusCounts,
      filtered: filtered.length
    };

    res.json({
      items: filtered
        .slice(0, 1000)
        .map(({ qualityVisible: _qualityVisible, ...item }) => item),
      total: filtered.length,
      counts,
      layersAvailable,
      regions: regionRows.map((row) => String(row.region)),
      owners: ownerRows.map((row) => ({
        id: Number(row.owner_web_user_id),
        name: String(row.owner_name ?? row.owner_web_user_id)
      })),
      filters: {
        q,
        region,
        owner: owner > 0 ? owner : null,
        layer,
        transport: transportFilter,
        status: status || null,
        hasCoords: hasCoordsFilter || null,
        companyId: isSuper && Number.isInteger(companyIdParam) && companyIdParam > 0
          ? companyIdParam
          : null
      }
    });
  })
);
