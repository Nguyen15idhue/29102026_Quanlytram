import type { PermissionEntry } from '../rbac/permissions';
import { inScope, Scope } from '../rbac/scope';

export interface RawJob {
  id: number;
  name: string;
  enabled: boolean;
  ownerId: number | null;
}

export interface RawStation {
  id: number;
  ownerId: number | null;
}

export interface RawMountpoint {
  id: number;
  ownerId: number | null;
}

export interface RawRelayMetric {
  jobId: number;
  state: string;
  appliedRevision: number;
  bytesUp: number;
  bytesDown: number;
  frames: number;
  crcErrors: number;
  lastDataAt?: string;
  lastError?: string;
}

export interface RawConnection {
  id: number;
  direction: string;
  listenerId: number;
  mountpointId: number;
  accountId: number | null;
  remoteAddr: string;
  userAgent: string;
  startTs: string;
  bytesIn: number;
  bytesOut: number;
}

export interface RawAlert {
  id: number;
  type: string;
  severity: string;
  targetType: string;
  targetId: number | null;
  title: string;
  message: string;
  status: string;
  ownerId: number | null;
  createdAt: string;
}

export interface RawData {
  relay: RawRelayMetric[];
  connections: RawConnection[];
  jobs: RawJob[];
  stations: RawStation[];
  mountpoints: RawMountpoint[];
  listenersCount: number;
  goOk: boolean;
  casterOk: boolean;
  ts: string;
}

export interface SnapshotRelay {
  jobId: number;
  name: string;
  enabled: boolean;
  state: string;
  appliedRevision: number;
  bytesUp: number;
  bytesDown: number;
  frames: number;
  crcErrors: number;
  lastDataAt: string | null;
  lastError: string | null;
}

export interface SnapshotConnection {
  id: number;
  direction: string;
  listenerId: number;
  mountpointId: number;
  accountId: number | null;
  remoteAddr: string;
  startTs: string;
  bytesIn: number;
  bytesOut: number;
}

export interface SnapshotAlert {
  id: number;
  type: string;
  severity: string;
  targetType: string;
  targetId: number | null;
  title: string;
  message: string;
  status: string;
  createdAt: string;
}

export interface Snapshot {
  ts: string;
  summary: {
    stations: number;
    relayTotal: number;
    relayStreaming: number;
    relayBackoff: number;
    relayError: number;
    relayPending: number;
    connections: number;
    listeners: number;
    openAlerts: number;
  };
  relays: SnapshotRelay[];
  connections: SnapshotConnection[];
  alerts: SnapshotAlert[];
}

export type PermissionMap = Record<string, Scope>;

export function permissionMap(permissions: PermissionEntry[]): PermissionMap {
  const map: PermissionMap = {};
  for (const permission of permissions) map[permission.code] = permission.scope;
  return map;
}

export function scopeOf(map: PermissionMap, code: string): Scope {
  return map[code] ?? 'none';
}

export function canSubscribeResource(
  map: PermissionMap,
  code: string,
  userId: number,
  subtreeIds: number[],
  ownerId: number | null
): boolean {
  const scope = scopeOf(map, code);
  if (scope === 'none') return false;
  return inScope(scope, userId, subtreeIds, ownerId);
}

export function buildSnapshot(
  raw: RawData,
  alerts: RawAlert[],
  permissions: PermissionMap,
  userId: number,
  subtreeIds: number[]
): Snapshot {
  const jobById = new Map(raw.jobs.map((job) => [job.id, job]));
  const mountpointById = new Map(raw.mountpoints.map((item) => [item.id, item]));

  const relayScope = scopeOf(permissions, 'relay.view');
  const relays: SnapshotRelay[] =
    relayScope === 'none'
      ? []
      : raw.relay
          .flatMap((metric) => {
            const job = jobById.get(metric.jobId);
            if (!job) return [];
            if (!inScope(relayScope, userId, subtreeIds, job.ownerId)) return [];
            return [
              {
                jobId: job.id,
                name: job.name,
                enabled: job.enabled,
                state: metric.state,
                appliedRevision: metric.appliedRevision,
                bytesUp: metric.bytesUp,
                bytesDown: metric.bytesDown,
                frames: metric.frames,
                crcErrors: metric.crcErrors,
                lastDataAt: metric.lastDataAt ?? null,
                lastError: metric.lastError ?? null
              }
            ];
          })
          .sort((a, b) => a.name.localeCompare(b.name));

  const connectionScope = scopeOf(permissions, 'connections.view');
  const connections: SnapshotConnection[] =
    connectionScope === 'none'
      ? []
      : raw.connections
          .filter((item) => {
            const mountpoint = mountpointById.get(item.mountpointId);
            if (!mountpoint) return connectionScope === 'all';
            return inScope(connectionScope, userId, subtreeIds, mountpoint.ownerId);
          })
          .map((item) => ({
            id: item.id,
            direction: item.direction,
            listenerId: item.listenerId,
            mountpointId: item.mountpointId,
            accountId: item.accountId,
            remoteAddr: item.remoteAddr,
            startTs: item.startTs,
            bytesIn: item.bytesIn,
            bytesOut: item.bytesOut
          }));

  const stationScope = scopeOf(permissions, 'stations.view');
  const stations =
    stationScope === 'none'
      ? 0
      : raw.stations.filter((station) =>
          inScope(stationScope, userId, subtreeIds, station.ownerId)
        ).length;

  const alertScope = scopeOf(permissions, 'alerts.view');
  const visibleAlerts: SnapshotAlert[] =
    alertScope === 'none'
      ? []
      : alerts
          .filter((alert) => inScope(alertScope, userId, subtreeIds, alert.ownerId))
          .map((alert) => ({
            id: alert.id,
            type: alert.type,
            severity: alert.severity,
            targetType: alert.targetType,
            targetId: alert.targetId,
            title: alert.title,
            message: alert.message,
            status: alert.status,
            createdAt: alert.createdAt
          }));

  const relayStreaming = relays.filter((item) => item.state === 'streaming').length;
  const relayBackoff = relays.filter((item) => item.state === 'backoff').length;
  const relayError = relays.filter((item) => item.state === 'error').length;
  const relayPending = relays.filter(
    (item) => item.state === 'pending' || item.state === 'connecting'
  ).length;

  return {
    ts: raw.ts,
    summary: {
      stations,
      relayTotal: relays.length,
      relayStreaming,
      relayBackoff,
      relayError,
      relayPending,
      connections: connections.length,
      listeners: scopeOf(permissions, 'settings.view') === 'all' ? raw.listenersCount : 0,
      openAlerts: visibleAlerts.filter((alert) => alert.status === 'open').length
    },
    relays,
    connections,
    alerts: visibleAlerts
  };
}
