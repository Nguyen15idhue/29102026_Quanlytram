import { describe, expect, it } from 'vitest';
import { buildDowntimeIntervals, type ServiceRun } from '../src/lib/serviceDowntime';
import {
  buildStatusTimeline,
  TIMELINE_RANGES,
  type ConnectionInterval,
  type TimelineRange,
  type TimelineSample
} from '../src/lib/statusTimeline';

function run(started: string, lastSeen: string): ServiceRun {
  return {
    startedAt: new Date(started),
    lastSeenAt: new Date(lastSeen),
    stoppedAt: null
  };
}

function sample(iso: string, frames = 10): TimelineSample {
  return { ts: new Date(iso), ageMs: 500, state: 'streaming', frames, windowSec: 60 };
}

function connection(from: string, to: string): ConnectionInterval {
  return { from: new Date(from), to: new Date(to), reason: '' };
}

function statusAt(
  timeline: ReturnType<typeof buildStatusTimeline>,
  iso: string
): { status: string; reason?: string } | null {
  const at = new Date(iso).getTime();
  for (const segment of timeline.segments) {
    const from = new Date(segment.from).getTime();
    const to = new Date(segment.to).getTime();
    if (at >= from && at < to) return { status: segment.status, reason: segment.reason };
  }
  return null;
}

// Ca thật 02/11: byte cuối 00:23:15 (+07), service restart 08:17:14, byte đầu
// 08:18:14. Session cũ mở xuyên qua khoảng dừng nên phải được downtime cắt.
const now = new Date('2026-11-02T01:21:00.000Z');
const createdAt = new Date('2026-11-01T05:47:04.029Z');
const runs = [
  run('2026-11-01T16:36:55.543Z', '2026-11-01T17:23:20.000Z'),
  run('2026-11-02T01:17:14.824Z', '2026-11-02T01:21:00.000Z')
];
const samples = [
  sample('2026-11-01T17:22:14.000Z'),
  sample('2026-11-01T17:23:14.000Z'),
  sample('2026-11-02T01:18:14.000Z'),
  sample('2026-11-02T01:19:14.000Z'),
  sample('2026-11-02T01:20:14.000Z')
];
const connections = [connection('2026-11-01T16:36:55.543Z', '2026-11-02T01:17:14.824Z')];

describe('timeline ca service dừng 02/11', () => {
  for (const range of Object.keys(TIMELINE_RANGES) as TimelineRange[]) {
    it(`khung ${range}: downtime là offline, sau restart là online`, () => {
      const config = TIMELINE_RANGES[range];
      const rangeFrom = new Date(now.getTime() - config.hours * 3600_000);
      const downtime = buildDowntimeIntervals(runs, rangeFrom, now);
      const timeline = buildStatusTimeline({
        createdAt,
        rangeFrom,
        now,
        bucketSec: config.bucketSec,
        resolutionSec: config.resolutionSec,
        samples,
        connections,
        hasConnectionInfo: true,
        downtime,
        minFramesPerWindow: 10
      });

      const duringShutdown = statusAt(timeline, '2026-11-02T00:30:00.000Z');
      if (duringShutdown) {
        expect(duringShutdown.status).toBe('offline');
        expect(duringShutdown.reason).toBe('system_down');
      }

      const afterRestart = statusAt(timeline, '2026-11-02T01:20:00.000Z');
      expect(afterRestart?.status).toBe('online');

      const covered = timeline.segments.reduce(
        (sum, segment) =>
          sum +
          (new Date(segment.to).getTime() - new Date(segment.from).getTime()) / 1000,
        0
      );
      expect(Math.round(covered)).toBe(Math.round((now.getTime() - rangeFrom.getTime()) / 1000));
      expect(
        timeline.noneSec + timeline.onlineSec + timeline.offlineSec + timeline.noDataSec
      ).toBe(Math.round((now.getTime() - rangeFrom.getTime()) / 1000));
    });
  }
});
