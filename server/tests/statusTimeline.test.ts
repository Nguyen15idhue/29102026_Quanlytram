import { describe, expect, it } from 'vitest';
import {
  buildStatusTimeline,
  offlineReasonFromClose,
  statusForLiveAge,
  type ConnectionInterval,
  type DowntimeInterval,
  type TimelineSample
} from '../src/lib/statusTimeline';

function sample(
  iso: string,
  frames = 10,
  state = 'streaming',
  ageMs = 500,
  windowSec = 60
): TimelineSample {
  return { ts: new Date(iso), ageMs, state, frames, windowSec };
}

function connection(from: string, to: string | null, reason?: string): ConnectionInterval {
  return { from: new Date(from), to: to ? new Date(to) : null, reason };
}

function downtime(
  from: string,
  to: string,
  reason: DowntimeInterval['reason'] = 'system_down'
): DowntimeInterval {
  return { from: new Date(from), to: new Date(to), reason };
}

function openConnection(from = '2026-11-01T10:00:00.000Z'): ConnectionInterval[] {
  return [connection(from, null)];
}

describe('status timeline', () => {
  it('dùng frame/60s cho no_data và online khi kết nối còn sống', () => {
    expect(statusForLiveAge(1_000)).toBe('online');
    expect(statusForLiveAge(1_000, { connected: true })).toBe('online');
    expect(statusForLiveAge(60_000, { connected: true })).toBe('no_data');
    expect(statusForLiveAge(null, { connected: true })).toBe('no_data');
    expect(
      statusForLiveAge(1_000, {
        connected: true,
        framesRecent: 9,
        minFramesPerWindow: 10
      })
    ).toBe('no_data');
    expect(
      statusForLiveAge(1_000, {
        connected: true,
        framesRecent: 10,
        minFramesPerWindow: 10
      })
    ).toBe('online');
    expect(statusForLiveAge(null, { everConnected: false })).toBe('offline');
    expect(statusForLiveAge(60_000, { connected: false, disconnectAgeMs: 10_001 })).toBe(
      'offline'
    );
  });

  it('phân loại online/no_data theo số frame trong cửa sổ', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T10:03:00.000Z'),
      bucketSec: 60,
      resolutionSec: 10,
      hasConnectionInfo: true,
      connections: openConnection(),
      minFramesPerWindow: 10,
      samples: [
        sample('2026-11-01T10:00:00.000Z', 10),
        sample('2026-11-01T10:01:00.000Z', 10),
        sample('2026-11-01T10:02:00.000Z', 3),
        sample('2026-11-01T10:03:00.000Z', 3)
      ]
    });

    expect(timeline.buckets[0].status).toBe('online');
    expect(timeline.buckets[1].status).toBe('no_data');
    expect(timeline.buckets[2].status).toBe('no_data');
    expect(timeline.noDataSec).toBeGreaterThan(0);
    expect(timeline.offlineSec).toBe(0);
  });

  it('offline khi không có kết nối và không có dữ liệu', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T10:05:00.000Z'),
      bucketSec: 60,
      resolutionSec: 60,
      hasConnectionInfo: true,
      connections: [],
      samples: []
    });

    expect(timeline.buckets.every((bucket) => bucket.status === 'offline')).toBe(true);
    expect(timeline.current).toBe('offline');
    expect(timeline.offlineSec).toBe(300);
  });

  it('downtime hệ thống biến khoảng mất kết nối thành offline system_down', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T10:10:00.000Z'),
      bucketSec: 60,
      resolutionSec: 10,
      hasConnectionInfo: true,
      connections: [connection('2026-11-01T10:00:00.000Z', '2026-11-01T10:10:00.000Z')],
      downtime: [downtime('2026-11-01T10:03:00.000Z', '2026-11-01T10:07:00.000Z')],
      minFramesPerWindow: 10,
      samples: [
        sample('2026-11-01T10:00:00.000Z', 10),
        sample('2026-11-01T10:01:00.000Z', 10),
        sample('2026-11-01T10:02:00.000Z', 10),
        sample('2026-11-01T10:08:00.000Z', 10),
        sample('2026-11-01T10:09:00.000Z', 10)
      ]
    });

    expect(timeline.buckets[4].status).toBe('offline');
    expect(timeline.buckets[4].reason).toBe('system_down');
    expect(timeline.offlineReasons.system_down).toBeGreaterThan(0);
    expect(timeline.current).toBe('online');
  });

  it('không nối hai sample streaming cách nhau quá 120 giây', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T10:11:00.000Z'),
      bucketSec: 60,
      resolutionSec: 60,
      hasConnectionInfo: true,
      connections: openConnection(),
      minFramesPerWindow: 10,
      samples: [
        sample('2026-11-01T10:00:00.000Z', 10),
        sample('2026-11-01T10:10:00.000Z', 10)
      ]
    });

    expect(timeline.buckets[5].status).toBe('no_data');
    expect(timeline.buckets[5].status).not.toBe('online');
    expect(timeline.current).toBe('online');
  });

  it('none trước khi tạo và segment phủ kín khung', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T09:00:00.000Z'),
      now: new Date('2026-11-01T11:00:00.000Z'),
      bucketSec: 1800,
      resolutionSec: 60,
      hasConnectionInfo: true,
      connections: [],
      samples: []
    });

    expect(timeline.buckets[0].status).toBe('none');
    expect(timeline.buckets[1].status).toBe('none');
    expect(timeline.buckets[2].status).toBe('offline');
    expect(timeline.segments[0].status).toBe('none');
    expect(timeline.segments[0].from).toBe('2026-11-01T09:00:00.000Z');
    expect(timeline.segments[0].to).toBe('2026-11-01T10:00:00.000Z');

    const covered = timeline.segments.reduce(
      (sum, segment) =>
        sum +
        (new Date(segment.to).getTime() - new Date(segment.from).getTime()) / 1000,
      0
    );
    expect(covered).toBe(7200);
  });

  it('bucket rộng lấy trạng thái chiếm phần lớn thời gian', () => {
    const samples: TimelineSample[] = [];
    for (let minute = 0; minute < 60; minute += 1) {
      const at = new Date(Date.UTC(2026, 10, 1, 10, minute, 0));
      samples.push(sample(at.toISOString(), minute >= 10 && minute < 15 ? 0 : 10));
    }
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T11:00:00.000Z'),
      bucketSec: 3600,
      resolutionSec: 60,
      hasConnectionInfo: true,
      connections: openConnection(),
      minFramesPerWindow: 10,
      samples
    });

    expect(timeline.buckets).toHaveLength(1);
    expect(timeline.buckets[0].status).toBe('online');
    expect(timeline.noDataSec).toBeGreaterThanOrEqual(280);
    expect(timeline.noDataSec).toBeLessThanOrEqual(320);
  });

  it('tổng thời lượng không đổi theo độ rộng bucket', () => {
    const samples: TimelineSample[] = [];
    for (let minute = 0; minute < 60; minute += 1) {
      const at = new Date(Date.UTC(2026, 10, 1, 10, minute, 0));
      samples.push(sample(at.toISOString(), minute >= 10 && minute < 15 ? 0 : 10));
    }
    const base = {
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T10:00:00.000Z'),
      now: new Date('2026-11-01T11:00:00.000Z'),
      resolutionSec: 60,
      hasConnectionInfo: true,
      connections: openConnection(),
      minFramesPerWindow: 10,
      samples
    };
    const narrow = buildStatusTimeline({ ...base, bucketSec: 60 });
    const wide = buildStatusTimeline({ ...base, bucketSec: 3600 });

    expect(narrow.onlineSec).toBe(wide.onlineSec);
    expect(narrow.offlineSec).toBe(wide.offlineSec);
    expect(narrow.noDataSec).toBe(wide.noDataSec);
  });

  it('map close_reason sang reason offline', () => {
    expect(offlineReasonFromClose('auth_failed')).toBe('source_auth');
    expect(offlineReasonFromClose('network')).toBe('source_network');
    expect(offlineReasonFromClose('timeout')).toBe('source_network');
    expect(offlineReasonFromClose('disabled')).toBe('disabled');
    expect(offlineReasonFromClose('eof')).toBe('source_silent');
  });

  it('trả contract đầy đủ segments, currentReason và tổng khung', () => {
    const timeline = buildStatusTimeline({
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      rangeFrom: new Date('2026-11-01T09:00:00.000Z'),
      now: new Date('2026-11-01T11:00:00.000Z'),
      bucketSec: 600,
      resolutionSec: 60,
      hasConnectionInfo: true,
      connections: [],
      samples: [],
      currentStatus: 'offline',
      currentReason: 'system_down'
    });

    expect(timeline.segments[0].status).toBe('none');
    expect(timeline.segments[timeline.segments.length - 1].to).toBe(
      '2026-11-01T11:00:00.000Z'
    );
    expect(timeline.current).toBe('offline');
    expect(timeline.currentReason).toBe('system_down');
    expect(timeline.offlineReasons.system_down).toBeGreaterThan(0);
    expect(
      timeline.noneSec + timeline.onlineSec + timeline.offlineSec + timeline.noDataSec
    ).toBe(7200);
  });
});
