import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { evaluateAlerts } from '../lib/alerts';
import { fetchLiveQuality, mapAlert, type QualityLive } from '../lib/quality';
import { sha256 } from '../lib/token';
import { permissionsForRole } from '../rbac/permissions';
import { inScope, subtreeIds, tenantIds } from '../rbac/scope';
import { qualityBus } from './qualityBus';
import { loadBaseData, loadOpenAlerts } from './data';
import {
  buildSnapshot,
  canSubscribeResource,
  permissionMap,
  scopeOf,
  type PermissionMap,
  type RawData,
  type Snapshot
} from './filter';

export interface SocketAuth {
  userId: number;
  sessionId: number;
  tokenHash: string;
  username: string;
  roleId: number;
  roleCode: string;
  roleLevel: number;
}

interface SocketState {
  auth: SocketAuth;
  permissions: PermissionMap;
  subtreeIds: number[];
  tenantIds: number[];
  lastAuthAt: number;
  lastSnapshotSig: string;
  lastRelaySig: string;
  lastConnSig: string;
  lastQualitySig: string;
  knownAlertIds: Set<number>;
  knownQualityAlertIds: Set<number>;
}

const AUTH_REFRESH_MS = 45_000;

export function authRefreshDue(lastAuthAt: number, now = Date.now()): boolean {
  return now - lastAuthAt >= AUTH_REFRESH_MS;
}

export function revokeSessionSockets(sessionId: number): void {
  if (!activeIo) return;
  const room = `session:${sessionId}`;
  activeIo.to(room).emit('auth.revoked');
  activeIo.in(room).disconnectSockets(true);
}

export function revokeUserSockets(userId: number, keepSessionId = 0): void {
  if (!activeIo) return;
  for (const socket of activeIo.sockets.sockets.values()) {
    const state = socket.data.state as SocketState | undefined;
    if (!state || state.auth.userId !== userId) continue;
    if (keepSessionId !== 0 && state.auth.sessionId === keepSessionId) continue;
    socket.emit('auth.revoked');
    socket.disconnect(true);
  }
}

export interface RealtimeHandle {
  io: SocketServer;
  stop: () => Promise<void>;
}

let activeIo: SocketServer | null = null;

export function socketClientCount(): number {
  return activeIo?.engine?.clientsCount ?? 0;
}

export interface EntityChangeEvent {
  entity:
    | 'station'
    | 'mountpoint'
    | 'ntrip_account'
    | 'listener'
    | 'relay_job'
    | 'probe';
  id: number | string;
  action: string;
  ts?: string;
}

export function emitEntityChange(event: EntityChangeEvent): void {
  activeIo?.emit('entity.changed', {
    ...event,
    ts: event.ts ?? new Date().toISOString()
  });
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const raw = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export async function loadSessionByToken(token: string): Promise<SocketAuth | null> {
  const tokenHash = sha256(token);
  const rows = await query<RowDataPacket[]>(
    `SELECT s.id AS session_id,
            u.id, u.username, u.role_id,
            r.code AS role_code, r.level AS role_level
       FROM web_sessions s
       JOIN web_users u ON u.id = s.web_user_id
       JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ?
        AND s.expires_at > UTC_TIMESTAMP(3)
        AND u.status = 'active'
      LIMIT 1`,
    [tokenHash]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    userId: Number(row.id),
    sessionId: Number(row.session_id),
    tokenHash,
    username: String(row.username),
    roleId: Number(row.role_id),
    roleCode: String(row.role_code),
    roleLevel: Number(row.role_level)
  };
}

async function refreshAuth(auth: SocketAuth): Promise<SocketAuth | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT s.id AS session_id,
            u.id, u.username, u.role_id,
            r.code AS role_code, r.level AS role_level
       FROM web_sessions s
       JOIN web_users u ON u.id = s.web_user_id
       JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ?
        AND s.expires_at > UTC_TIMESTAMP(3)
        AND u.status = 'active'
      LIMIT 1`,
    [auth.tokenHash]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...auth,
    sessionId: Number(row.session_id),
    userId: Number(row.id),
    username: String(row.username),
    roleId: Number(row.role_id),
    roleCode: String(row.role_code),
    roleLevel: Number(row.role_level)
  };
}

async function stateForSocket(socket: Socket): Promise<SocketState | null> {
  const state = socket.data.state as SocketState | undefined;
  if (!state) return null;
  if (!authRefreshDue(state.lastAuthAt)) return state;
  state.lastAuthAt = Date.now();
  const latest = await refreshAuth(state.auth);
  if (!latest || latest.userId !== state.auth.userId) return null;
  if (latest.roleId !== state.auth.roleId || latest.sessionId !== state.auth.sessionId) {
    const [permissions, ids, tenants] = await Promise.all([
      permissionsForRole(latest.roleId).then(permissionMap),
      subtreeIds(latest.userId),
      tenantIds(latest.userId)
    ]);
    state.auth = latest;
    state.permissions = permissions;
    state.subtreeIds = ids;
    state.tenantIds = tenants;
    state.lastSnapshotSig = '';
    state.lastRelaySig = '';
    state.lastConnSig = '';
    state.lastQualitySig = '';
    state.knownAlertIds = new Set();
    state.knownQualityAlertIds = new Set();
  }
  return state;
}

async function sendSnapshot(
  socket: Socket,
  state: SocketState,
  raw?: RawData,
  alerts?: Awaited<ReturnType<typeof loadOpenAlerts>>
): Promise<void> {  const data = raw ?? (await loadBaseData());
  const alertItems = alerts ?? (await loadOpenAlerts());
  const snapshot = buildSnapshot(
    data,
    alertItems,
    state.permissions,
    state.auth.userId,
    state.subtreeIds,
    state.tenantIds
  );
  const snapshotSig = snapshotSignature(snapshot);
  socket.emit('snapshot', snapshot);
  state.lastSnapshotSig = snapshotSig;
  state.lastRelaySig = JSON.stringify(snapshot.relays);
  state.lastConnSig = JSON.stringify(snapshot.connections);
  state.knownAlertIds = new Set(snapshot.alerts.map((alert) => alert.id));
}

function snapshotSignature(snapshot: Snapshot): string {
  const { ts: _ts, ...rest } = snapshot;
  return JSON.stringify(rest);
}

function qualityOwner(data: RawData, targetType: string, targetId: number): number | null {
  if (targetType === 'station') {
    return data.stations.find((station) => station.id === targetId)?.ownerId ?? null;
  }
  if (targetType === 'relay_job') {
    return data.jobs.find((job) => job.id === targetId)?.ownerId ?? null;
  }
  return null;
}

export function initRealtime(httpServer: HttpServer): RealtimeHandle {
  const io = new SocketServer(httpServer, {

    path: '/socket.io',
    cors: {
      origin: config.corsOrigin,
      credentials: true
    },
    serveClient: false
  });
  activeIo = io;

  const onQualityAck = (event: unknown) => {
    io.emit('quality.alert.ack', event);
  };
  qualityBus.on('ack', onQualityAck);

  io.use(async (socket, next) => {
    try {
      const cookie = parseCookieHeader(socket.handshake.headers.cookie);
      const token = cookie[config.session.cookieName];
      if (!token) return next(new Error('UNAUTHENTICATED'));
      const auth = await loadSessionByToken(token);
      if (!auth) return next(new Error('UNAUTHENTICATED'));
      const [permissions, ids, tenants] = await Promise.all([
        permissionsForRole(auth.roleId).then(permissionMap),
        subtreeIds(auth.userId),
        tenantIds(auth.userId)
      ]);
      const state: SocketState = {
        auth,
        permissions,
        subtreeIds: ids,
        tenantIds: tenants,
        lastAuthAt: Date.now(),
        lastSnapshotSig: '',
        lastRelaySig: '',
        lastConnSig: '',
        lastQualitySig: '',
        knownAlertIds: new Set(),
        knownQualityAlertIds: new Set()
      };
      socket.data.state = state;
      next();
    } catch {
      next(new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', (socket) => {
    const state = socket.data.state as SocketState;
    socket.join(`user:${state.auth.userId}`);
    socket.join(`session:${state.auth.sessionId}`);

    socket.on('snapshot:request', async () => {
      try {
        const current = await stateForSocket(socket);
        if (!current) {
          socket.emit('auth.revoked');
          socket.disconnect(true);
          return;
        }
        await sendSnapshot(socket, current);
      } catch {
        socket.emit('server.error', { code: 'SNAPSHOT_FAILED' });
      }
    });

    socket.on('subscribe', async (payload: unknown, ack?: (result: unknown) => void) => {
      try {
        const current = await stateForSocket(socket);
        if (!current) {
          ack?.({ ok: false, error: 'UNAUTHENTICATED' });
          socket.disconnect(true);
          return;
        }
        const request = payload as { type?: string; id?: number };
        const resourceId = Number(request?.id ?? 0);
        if (request?.type === 'station' && resourceId > 0) {
          const rows = await query<RowDataPacket[]>(
            'SELECT owner_web_user_id FROM stations WHERE id = ? LIMIT 1',
            [resourceId]
          );
          const ownerId = rows[0]?.owner_web_user_id ?? null;
          if (
            rows.length === 0 ||
            !canSubscribeResource(
              current.permissions,
              'quality.view',
              current.auth.userId,
              current.subtreeIds,
              ownerId === null ? null : Number(ownerId),
              current.tenantIds
            )
          ) {
            ack?.({ ok: false, error: 'FORBIDDEN' });
            return;
          }
          socket.join(`station:${resourceId}`);
          ack?.({ ok: true, room: `station:${resourceId}` });
          return;
        }
        if (request?.type === 'relay' && resourceId > 0) {
          const rows = await query<RowDataPacket[]>(
            'SELECT owner_web_user_id FROM relay_jobs WHERE id = ? AND deleted_at IS NULL LIMIT 1',
            [resourceId]
          );
          const ownerId = rows[0]?.owner_web_user_id ?? null;
          const owner = ownerId === null ? null : Number(ownerId);
          const allowed =
            canSubscribeResource(
              current.permissions,
              'relay.view',
              current.auth.userId,
              current.subtreeIds,
              owner,
              current.tenantIds
            ) ||
            canSubscribeResource(
              current.permissions,
              'quality.view',
              current.auth.userId,
              current.subtreeIds,
              owner,
              current.tenantIds
            );
          if (rows.length === 0 || !allowed) {
            ack?.({ ok: false, error: 'FORBIDDEN' });
            return;
          }
          socket.join(`relay:${resourceId}`);
          ack?.({ ok: true, room: `relay:${resourceId}` });
          return;
        }
        if (request?.type === 'caster') {
          if (scopeOf(current.permissions, 'connections.view') === 'none') {
            ack?.({ ok: false, error: 'FORBIDDEN' });
            return;
          }
          socket.join('caster');
          ack?.({ ok: true, room: 'caster' });
          return;
        }
        ack?.({ ok: false, error: 'INVALID_RESOURCE' });
      } catch {
        ack?.({ ok: false, error: 'SUBSCRIBE_FAILED' });
      }
    });

    void sendSnapshot(socket, state).catch(() => {
      socket.emit('server.error', { code: 'SNAPSHOT_FAILED' });
    });
  });

  let running = true;
  let ticking = false;
  let lastSessionId = 0;

  async function tick(): Promise<void> {
    if (!running || ticking) return;
    ticking = true;
    try {
      const data = await loadBaseData();
      await evaluateAlerts(data);
      const alerts = await loadOpenAlerts();
      const [liveQuality, qualityAlertRows] = await Promise.all([
        fetchLiveQuality(),
        runtimeQuery<RowDataPacket[]>(
          `SELECT * FROM quality_alerts
            WHERE resolved_at IS NULL
            ORDER BY last_seen DESC
            LIMIT 100`
        )
      ]);

      const maxRows = await runtimeQuery<RowDataPacket[]>(
        'SELECT MAX(id) AS max_id FROM relay_sessions'
      );
      const maxSessionId = Number(maxRows[0]?.max_id ?? 0);
      let newSessions: RowDataPacket[] = [];
      if (lastSessionId === 0) {
        lastSessionId = maxSessionId;
      } else if (maxSessionId > lastSessionId) {
        newSessions = await runtimeQuery<RowDataPacket[]>(
          `SELECT id, relay_job_id, start_ts, end_ts, duration_sec, result, close_reason, message
             FROM relay_sessions
            WHERE id > ?
            ORDER BY id ASC
            LIMIT 200`,
          [lastSessionId]
        );
        lastSessionId = maxSessionId;
      }

      for (const socket of io.sockets.sockets.values()) {
        const state = await stateForSocket(socket);
        if (!state) {
          socket.emit('auth.revoked');
          socket.disconnect(true);
          continue;
        }
        const snapshot = buildSnapshot(
          data,
          alerts,
          state.permissions,
          state.auth.userId,
          state.subtreeIds,
          state.tenantIds
        );
        const snapshotSig = snapshotSignature(snapshot);
        if (snapshotSig !== state.lastSnapshotSig) {
          state.lastSnapshotSig = snapshotSig;
          socket.emit('snapshot', snapshot);

          const relaySig = JSON.stringify(snapshot.relays);
          if (relaySig !== state.lastRelaySig) {
            socket.emit('relay.updated', { ts: snapshot.ts, items: snapshot.relays });
            state.lastRelaySig = relaySig;
          }

          const connSig = JSON.stringify(snapshot.connections);
          if (connSig !== state.lastConnSig) {
            socket.emit('connection.updated', { ts: snapshot.ts, items: snapshot.connections });
            state.lastConnSig = connSig;
          }

          const newAlerts = snapshot.alerts.filter((alert) => !state.knownAlertIds.has(alert.id));
          state.knownAlertIds = new Set(snapshot.alerts.map((alert) => alert.id));
          if (newAlerts.length > 0) {
            socket.emit('alert.created', { ts: snapshot.ts, items: newAlerts });
          }

          const qualityScope = scopeOf(state.permissions, 'quality.view');
          const qualityIds =
            qualityScope === 'tenant' ? state.tenantIds : state.subtreeIds;
          const disabledStations = new Set(
            data.stations
              .filter((station) => !station.enabled || station.status === 'locked')
              .map((station) => station.id)
          );
          const visibleQuality: QualityLive[] =
            qualityScope === 'none'
              ? []
              : liveQuality.items.filter((item) => {
                  if (item.targetType === 'station' && disabledStations.has(item.targetId)) {
                    return false;
                  }
                  return inScope(
                    qualityScope,
                    state.auth.userId,
                    qualityIds,
                    qualityOwner(data, item.targetType, item.targetId)
                  );
                });
          socket.emit('quality.snapshot', { ts: liveQuality.ts, items: visibleQuality });
          const qualitySig = JSON.stringify(visibleQuality);
          if (qualitySig !== state.lastQualitySig) {
            socket.emit('quality.updated', { ts: liveQuality.ts, items: visibleQuality });
            state.lastQualitySig = qualitySig;
          }

          const visibleQualityAlerts =
            qualityScope === 'none'
              ? []
              : (qualityAlertRows as any[])
                  .filter((row) =>
                    inScope(
                      qualityScope,
                      state.auth.userId,
                      qualityIds,
                      qualityOwner(data, String(row.target_type), Number(row.target_id))
                    )
                  )
                  .map((row) =>
                    mapAlert(
                      row,
                      qualityOwner(data, String(row.target_type), Number(row.target_id))
                    )
                  );
          const newQualityAlerts = visibleQualityAlerts.filter(
            (alert) => !state.knownQualityAlertIds.has(alert.id)
          );
          state.knownQualityAlertIds = new Set(visibleQualityAlerts.map((alert) => alert.id));
          if (newQualityAlerts.length > 0) {
            socket.emit('quality.alert', { ts: liveQuality.ts, items: newQualityAlerts });
          }
        }

        if (newSessions.length > 0) {
          const visibleJobIds = new Set(snapshot.relays.map((relay) => relay.jobId));
          for (const row of newSessions) {
            if (!visibleJobIds.has(Number(row.relay_job_id))) continue;
            socket.emit('relay.session', {
              ts: snapshot.ts,
              session: {
                id: Number(row.id),
                jobId: Number(row.relay_job_id),
                startTs: row.start_ts,
                endTs: row.end_ts,
                durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
                result: String(row.result ?? ''),
                closeReason: String(row.close_reason ?? ''),
                message: String(row.message ?? '')
              }
            });
          }
        }
      }
    } catch (err) {
      console.warn('[realtime] tick failed', err instanceof Error ? err.message : err);
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(() => void tick(), config.realtime.pollMs);
  timer.unref?.();

  return {
    io,
    stop: async () => {
      running = false;
      clearInterval(timer);
      qualityBus.off('ack', onQualityAck);
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      activeIo = null;
    }
  };
}
