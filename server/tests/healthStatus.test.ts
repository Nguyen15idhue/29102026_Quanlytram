import { describe, expect, it } from 'vitest';
import { hostHealthStatus, nodeHealthStatus, overallHealthStatus } from '../src/lib/healthStatus';

describe('health status thresholds and fallback', () => {
  it('classifies node thresholds', () => {
    expect(nodeHealthStatus({ heapPercent: 50, eventLoopLagMs: 10 })).toBe('ok');
    expect(nodeHealthStatus({ heapPercent: 85, eventLoopLagMs: 10 })).toBe('warn');
    expect(nodeHealthStatus({ heapPercent: 50, eventLoopLagMs: 1200 })).toBe('error');
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
