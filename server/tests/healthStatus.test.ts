import { describe, expect, it } from 'vitest';
import { hostHealthStatus, nodeHealthStatus, overallHealthStatus } from '../src/lib/healthStatus';

describe('health status thresholds and fallback', () => {
  it('classifies node thresholds', () => {
    const MB = 1024 * 1024;
    expect(nodeHealthStatus({ heapUsedBytes: 38 * MB, rssPercent: 12, eventLoopLagMs: 0.4 })).toBe('ok');
    expect(nodeHealthStatus({ heapUsedBytes: 450 * MB, rssPercent: 20, eventLoopLagMs: 10 })).toBe('warn');
    expect(nodeHealthStatus({ heapUsedBytes: 100 * MB, rssPercent: 75, eventLoopLagMs: 10 })).toBe('warn');
    expect(nodeHealthStatus({ heapUsedBytes: 100 * MB, rssPercent: 20, eventLoopLagMs: 250 })).toBe('warn');
    expect(nodeHealthStatus({ heapUsedBytes: 800 * MB, rssPercent: 20, eventLoopLagMs: 10 })).toBe('error');
    expect(nodeHealthStatus({ heapUsedBytes: 100 * MB, rssPercent: 90, eventLoopLagMs: 10 })).toBe('error');
    expect(nodeHealthStatus({ heapUsedBytes: 100 * MB, rssPercent: 20, eventLoopLagMs: 1200 })).toBe('error');
  });

  it('classifies host thresholds and null disk as non-fatal', () => {
    expect(hostHealthStatus({ memoryPercent: 50, diskPercent: null })).toBe('ok');
    expect(hostHealthStatus({ memoryPercent: 95, diskPercent: 50 })).toBe('warn');
    expect(hostHealthStatus({ memoryPercent: 50, diskPercent: 98 })).toBe('error');
  });

  it('degrades overall when a metric is unknown', () => {
    expect(overallHealthStatus(['ok', 'unknown'])).toBe('warn');
    expect(overallHealthStatus(['ok', 'error'])).toBe('error');
  });
});
