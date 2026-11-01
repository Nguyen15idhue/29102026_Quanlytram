import { describe, expect, it } from 'vitest';
import {
  buildStatusTimeline,
  statusForLiveAge,
  type ConnectionInterval,
  type TimelineSample
} from '../src/lib/statusTimeline';

function sample(iso: string, ageMs: number, state = 'streaming'): TimelineSample {
  return { ts: new Date(iso), ageMs, state };
}

function connection(from: string, to: string | null): ConnectionInterval {
  return { from: new Date(from), to: to ? new Date(to) : null };
}

describe('status timeline', () => {
  it('keeps connected no-data without timeout and disconnects after 10s', () => {
    expect(statusForLiveAge(1_000)).toBe('online');
    expect(statusForLiveAge(1_000, { connected: true })).toBe('online');
    expect(statusForLiveAge(60_000, { connected: true })).toBe('no_data');
    expect(statusForLiveAge(1_000, { connected: false, disconnectAgeMs: 5_000 })).toBe(
      'no_data'
    );
    expect(statusForLiveAge(60_000, { connected: false, disconnectAgeMs: 5_000 })).toBe(
      'no_data'
    );
    expect(statusForLiveAge(60_000, { connected: false, disconnectAgeMs: 10_000 })).toBe(
      'no_data'
    );
    expect(statusForLiveAge(60_000, { connected: false, disconnectAgeMs: 10_001 })).toBe(
      'offline'
    );
    expect(statusForLiveAge(null, { everConnected: false })).toBe('offline');
  });

  it('uses 10 seconds from disconnect before offline', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T11:59:50.000Z'),
      now: new Date('2026-11-01T12:00:20.000Z'),
      bucketSec: 10,
      hasConnectionInfo: true,
      connections: [connection('2026-11-01T10:00:00.000Z', '2026-11-01T12:00:00.000Z')],
      samples: [
        sample('2026-11-01T11:59:50.000Z', 1_000),
        sample('2026-11-01T12:00:00.000Z', 1_000),
        sample('2026-11-01T12:00:10.000Z', 11_000, 'stale')
      ],
      currentStatus: 'offline'
    });

    expect(timeline.buckets[0].status).toBe('online');
    expect(timeline.buckets[1].status).toBe('no_data');
    expect(timeline.buckets[2].status).toBe('offline');
  });

  it('keeps no-data forever while the connection is open', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T11:00:00.000Z'),
      bucketSec: 60,
      hasConnectionInfo: true,
      connections: [connection('2026-11-01T10:00:00.000Z', null)],
      samples: [
        sample('2026-11-01T10:00:00.000Z', 1_000),
        sample('2026-11-01T10:01:00.000Z', 1_000),
        sample('2026-11-01T10:02:00.000Z', 1_000)
      ]
    });

    expect(timeline.buckets[0].status).toBe('online');
    expect(timeline.buckets[3].status).toBe('no_data');
    expect(timeline.current).toBe('no_data');
  });

  it('marks never-connected as offline and before creation as none', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T09:00:00.000Z'),
      now: new Date('2026-11-01T11:00:00.000Z'),
      bucketSec: 1800,
      hasConnectionInfo: true,
      connections: [],
      samples: []
    });

    expect(timeline.buckets[0].status).toBe('none');
    expect(timeline.buckets[1].status).toBe('none');
    expect(timeline.buckets[2].status).toBe('offline');
    expect(timeline.buckets[3].status).toBe('offline');
    expect(timeline.current).toBe('offline');
  });

  it('falls back to data age when connection tracking is unavailable', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T10:00:20.000Z'),
      bucketSec: 5,
      hasConnectionInfo: false,
      samples: [
        sample('2026-11-01T09:59:58.000Z', 1_000),
        sample('2026-11-01T10:00:05.000Z', 1_000),
        sample('2026-11-01T10:00:10.000Z', 10_000, 'stale')
      ]
    });

    expect(timeline.buckets[0].status).toBe('online');
    expect(timeline.buckets[1].status).toBe('no_data');
    expect(timeline.buckets[2].status).toBe('offline');
  });
});
