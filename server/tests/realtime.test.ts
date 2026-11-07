import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  canSubscribeResource,
  permissionMap,
  scopeOf,
  type RawData
} from '../src/realtime/filter';
import { parseCookieHeader } from '../src/realtime/socket';

const raw: RawData = {
  ts: '2026-10-30T00:00:00.000Z',
  goOk: true,
  casterOk: true,
  stale: false,
  listenersCount: 1,
  jobs: [
    { id: 1, name: 'Job own', enabled: true, ownerId: 10 },
    { id: 2, name: 'Job sibling', enabled: true, ownerId: 11 },
    { id: 3, name: 'Job outside', enabled: true, ownerId: 99 }
  ],
  relay: [
    {
      jobId: 1,
      state: 'streaming',
      appliedRevision: 2,
      bytesUp: 10,
      bytesDown: 10,
      frames: 3,
      crcErrors: 0
    },
    {
      jobId: 2,
      state: 'backoff',
      appliedRevision: 1,
      bytesUp: 0,
      bytesDown: 0,
      frames: 0,
      crcErrors: 0
    },
    {
      jobId: 3,
      state: 'error',
      appliedRevision: 1,
      bytesUp: 0,
      bytesDown: 0,
      frames: 0,
      crcErrors: 0,
      lastError: '429'
    }
  ],
  stations: [
    { id: 1, enabled: true, status: 'online', ownerId: 10 },
    { id: 2, enabled: true, status: 'online', ownerId: 99 }
  ],
  mountpoints: [
    { id: 1, stationId: 1, ownerId: 10 },
    { id: 2, stationId: 2, ownerId: 99 }
  ],
  connections: [
    {
      id: 1,
      direction: 'rover',
      listenerId: 1,
      mountpointId: 1,
      accountId: null,
      remoteAddr: '127.0.0.1',
      userAgent: '',
      startTs: '2026-10-30T00:00:00.000Z',
      bytesIn: 1,
      bytesOut: 2
    },
    {
      id: 2,
      direction: 'source',
      listenerId: 1,
      mountpointId: 2,
      accountId: null,
      remoteAddr: '127.0.0.2',
      userAgent: '',
      startTs: '2026-10-30T00:00:00.000Z',
      bytesIn: 3,
      bytesOut: 4
    }
  ]
};

const alerts = [
  {
    id: 1,
    type: 'relay.state.backoff',
    severity: 'warning',
    targetType: 'relay_job',
    targetId: 2,
    title: 'Job sibling backoff',
    message: '',
    status: 'open',
    ownerId: 11,
    createdAt: '2026-10-30T00:00:00.000Z'
  },
  {
    id: 2,
    type: 'relay.state.error',
    severity: 'critical',
    targetType: 'relay_job',
    targetId: 3,
    title: 'Job outside error',
    message: '',
    status: 'open',
    ownerId: 99,
    createdAt: '2026-10-30T00:00:00.000Z'
  },
  {
    id: 3,
    type: 'system.go_unavailable',
    severity: 'critical',
    targetType: 'system',
    targetId: null,
    title: 'System',
    message: '',
    status: 'open',
    ownerId: null,
    createdAt: '2026-10-30T00:00:00.000Z'
  }
];

describe('realtime payload filtering', () => {
  it('limits own scope to owner records', () => {
    const permissions = permissionMap([
      { code: 'relay.view', scope: 'own' },
      { code: 'connections.view', scope: 'own' },
      { code: 'stations.view', scope: 'own' },
      { code: 'alerts.view', scope: 'own' },
      { code: 'system_health.view', scope: 'all' }
    ]);
    const snapshot = buildSnapshot(raw, alerts, permissions, 10, [10, 11]);
    expect(snapshot.relays.map((item) => item.jobId)).toEqual([1]);
    expect(snapshot.connections.map((item) => item.id)).toEqual([1]);
    expect(snapshot.summary.stations).toBe(1);
    expect(snapshot.summary.openAlerts).toBe(0);
    expect(snapshot.summary.relayStreaming).toBe(1);
    expect(snapshot.summary.listeners).toBe(1);
  });

  it('uses tenant ids only for tenant scoped permissions', () => {
    const permissions = permissionMap([
      { code: 'stations.view', scope: 'tenant' },
      { code: 'relay.view', scope: 'tenant' },
      { code: 'alerts.view', scope: 'own' }
    ]);
    const snapshot = buildSnapshot(raw, alerts, permissions, 20, [20, 21], [10, 11]);
    expect(snapshot.summary.stations).toBe(1);
    expect(snapshot.relays.map((item) => item.jobId)).toEqual([1, 2]);
    expect(snapshot.alerts).toEqual([]);
  });

  it('limits subtree scope and never leaks outside owner', () => {
    const permissions = permissionMap([
      { code: 'relay.view', scope: 'subtree' },
      { code: 'alerts.view', scope: 'subtree' }
    ]);
    const snapshot = buildSnapshot(raw, alerts, permissions, 10, [10, 11]);
    expect(snapshot.relays.map((item) => item.jobId).sort()).toEqual([1, 2]);
    expect(snapshot.alerts.map((item) => item.id)).toEqual([1]);
    expect(snapshot.summary.relayBackoff).toBe(1);
    expect(snapshot.summary.openAlerts).toBe(1);
  });

  it('giữ cờ stale khi Go mất kết nối', () => {
    const permissions = permissionMap([{ code: 'relay.view', scope: 'all' }]);
    const snapshot = buildSnapshot({ ...raw, goOk: false, stale: true }, alerts, permissions, 10, [10]);
    expect(snapshot.stale).toBe(true);
    expect(snapshot.relays.map((item) => item.jobId)).toEqual([3, 1, 2]);
  });

  it('returns empty sections when permission is none', () => {
    const snapshot = buildSnapshot(raw, alerts, {}, 10, [10]);
    expect(snapshot.relays).toEqual([]);
    expect(snapshot.connections).toEqual([]);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.summary.stations).toBe(0);
    expect(snapshot.summary.listeners).toBe(0);
    expect(snapshot.summary.relayTotal).toBe(0);
  });

  it('all scope sees every record', () => {
    const permissions = permissionMap([
      { code: 'relay.view', scope: 'all' },
      { code: 'connections.view', scope: 'all' },
      { code: 'alerts.view', scope: 'all' }
    ]);
    const snapshot = buildSnapshot(raw, alerts, permissions, 10, []);
    expect(snapshot.relays).toHaveLength(3);
    expect(snapshot.connections).toHaveLength(2);
    expect(snapshot.summary.openAlerts).toBe(3);
  });

  it('tenant sees same-company mountpoint even when owner is super_admin', () => {
    // Mountpoint do super (owner 99) tạo nhưng company 7; admin (id 10,
    // company 7) phải thấy kết nối.
    const companyRaw: RawData = {
      ...raw,
      mountpoints: [
        { id: 1, stationId: 1, ownerId: 99, companyId: 7 },
        { id: 2, stationId: 2, ownerId: 99, companyId: 8 }
      ],
      connections: [
        {
          id: 1,
          direction: 'rover',
          listenerId: 1,
          mountpointId: 1,
          accountId: 5,
          remoteAddr: '127.0.0.1',
          userAgent: '',
          startTs: '2026-10-30T00:00:00.000Z',
          bytesIn: 1,
          bytesOut: 2
        },
        {
          id: 2,
          direction: 'rover',
          listenerId: 1,
          mountpointId: 2,
          accountId: 6,
          remoteAddr: '127.0.0.2',
          userAgent: '',
          startTs: '2026-10-30T00:00:00.000Z',
          bytesIn: 3,
          bytesOut: 4
        }
      ]
    };
    const permissions = permissionMap([{ code: 'connections.view', scope: 'tenant' }]);
    const snapshot = buildSnapshot(companyRaw, [], permissions, 10, [], [], 7);
    expect(snapshot.connections.map((item) => item.id)).toEqual([1]);
  });

  it('tenant without company falls back to owner check (legacy data)', () => {
    const legacyRaw: RawData = {
      ...raw,
      mountpoints: [{ id: 1, stationId: 1, ownerId: 10 }],
      connections: [
        {
          id: 1,
          direction: 'rover',
          listenerId: 1,
          mountpointId: 1,
          accountId: 5,
          remoteAddr: '127.0.0.1',
          userAgent: '',
          startTs: '2026-10-30T00:00:00.000Z',
          bytesIn: 1,
          bytesOut: 2
        }
      ]
    };
    const permissions = permissionMap([{ code: 'connections.view', scope: 'tenant' }]);
    const snapshot = buildSnapshot(legacyRaw, [], permissions, 10, [], [10, 11], 7);
    expect(snapshot.connections.map((item) => item.id)).toEqual([1]);
  });

  it('passes rover GGA position through to snapshot connections', () => {
    const roverRaw: RawData = {
      ...raw,
      mountpoints: [{ id: 1, stationId: 1, ownerId: 10, companyId: 7 }],
      connections: [
        {
          id: 9,
          direction: 'rover',
          listenerId: 1,
          mountpointId: 1,
          accountId: 5,
          remoteAddr: '127.0.0.1',
          userAgent: '',
          startTs: '2026-10-30T00:00:00.000Z',
          bytesIn: 10,
          bytesOut: 20,
          fixType: 'fixed',
          roverLat: 21.0285,
          roverLon: 105.8542,
          roverAlt: 12.5,
          roverSats: 9,
          roverFixTs: '2026-10-30T00:00:01.000Z'
        }
      ]
    };
    const permissions = permissionMap([{ code: 'connections.view', scope: 'all' }]);
    const snapshot = buildSnapshot(roverRaw, [], permissions, 10, [], [], 7);
    expect(snapshot.connections).toHaveLength(1);
    expect(snapshot.connections[0].roverLat).toBeCloseTo(21.0285, 6);
    expect(snapshot.connections[0].roverLon).toBeCloseTo(105.8542, 6);
    expect(snapshot.connections[0].fixType).toBe('fixed');
  });
});

describe('socket authorization helpers', () => {
  it('denies subscribing outside scope', () => {
    const permissions = permissionMap([{ code: 'relay.view', scope: 'subtree' }]);
    expect(canSubscribeResource(permissions, 'relay.view', 10, [10, 11], 11)).toBe(true);
    expect(canSubscribeResource(permissions, 'relay.view', 10, [10, 11], 99)).toBe(false);
  });

  it('denies every resource without permission', () => {
    expect(canSubscribeResource({}, 'relay.view', 10, [10], 10)).toBe(false);
    expect(scopeOf({}, 'connections.view')).toBe('none');
  });
});

describe('socket cookie parsing', () => {
  it('parses and decodes session cookies', () => {
    expect(parseCookieHeader('a=1; cors_sid=abc%20123; empty=')).toEqual({
      a: '1',
      cors_sid: 'abc 123',
      empty: ''
    });
  });

  it('handles missing headers', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });
});
