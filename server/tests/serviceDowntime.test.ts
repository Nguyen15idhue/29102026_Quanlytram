import { describe, expect, it } from 'vitest';
import {
  buildDowntimeIntervals,
  SERVICE_GAP_MS,
  type ServiceRun
} from '../src/lib/serviceDowntime';

function run(
  started: string,
  lastSeen: string,
  stopped: string | null = null
): ServiceRun {
  return {
    startedAt: new Date(started),
    lastSeenAt: new Date(lastSeen),
    stoppedAt: stopped ? new Date(stopped) : null
  };
}

describe('service downtime', () => {
  it('tạo khoảng system_down giữa hai run', () => {
    const intervals = buildDowntimeIntervals(
      [run('2026-11-01T10:00:00Z', '2026-11-01T10:10:00Z'), run('2026-11-01T11:00:00Z', '2026-11-01T12:00:00Z')],
      new Date('2026-11-01T10:00:00Z'),
      new Date('2026-11-01T12:00:00Z')
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0].from.toISOString()).toBe('2026-11-01T10:10:00.000Z');
    expect(intervals[0].to?.toISOString()).toBe('2026-11-01T11:00:00.000Z');
    expect(intervals[0].reason).toBe('system_down');
  });

  it('dùng stopped_at thật khi service dừng chủ động', () => {
    const intervals = buildDowntimeIntervals(
      [
        run('2026-11-01T10:00:00Z', '2026-11-01T10:12:00Z', '2026-11-01T10:12:00Z'),
        run('2026-11-01T11:00:00Z', '2026-11-01T11:00:00Z')
      ],
      new Date('2026-11-01T09:00:00Z'),
      new Date('2026-11-01T12:00:00Z')
    );

    expect(intervals[0].from.toISOString()).toBe('2026-11-01T10:12:00.000Z');
  });

  it('run cuối heartbeat cũ tạo downtime tới rangeTo', () => {
    const intervals = buildDowntimeIntervals(
      [run('2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')],
      new Date('2026-11-01T10:00:00Z'),
      new Date('2026-11-01T10:05:00Z')
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0].to?.toISOString()).toBe('2026-11-01T10:05:00.000Z');
  });

  it('bỏ qua khoảng nhỏ hơn ngưỡng heartbeat', () => {
    const smallGap = new Date(
      new Date('2026-11-01T10:00:00Z').getTime() + SERVICE_GAP_MS - 1
    ).toISOString();
    const intervals = buildDowntimeIntervals(
      [run('2026-11-01T09:59:00Z', '2026-11-01T10:00:00Z'), run(smallGap, '2026-11-01T11:00:00Z')],
      new Date('2026-11-01T09:00:00Z'),
      new Date('2026-11-01T11:00:00Z')
    );

    expect(intervals).toHaveLength(0);
  });

  it('cắt khoảng downtime theo biên range', () => {
    const intervals = buildDowntimeIntervals(
      [run('2026-11-01T09:00:00Z', '2026-11-01T09:00:00Z'), run('2026-11-01T11:00:00Z', '2026-11-01T11:00:00Z')],
      new Date('2026-11-01T10:00:00Z'),
      new Date('2026-11-01T10:30:00Z')
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0].from.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(intervals[0].to?.toISOString()).toBe('2026-11-01T10:30:00.000Z');
  });
});
