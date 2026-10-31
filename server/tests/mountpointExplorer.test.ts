import { describe, expect, it } from 'vitest';
import { mountpointSourceState } from '../src/lib/mountpointExplorer';

const now = Date.parse('2026-10-31T10:00:00Z');

describe('mountpointSourceState', () => {
  it('reports disabled before data', () => {
    expect(mountpointSourceState({ enabled: false, latest: null, now })).toBe('disabled');
  });

  it('reports unknown without sample', () => {
    expect(mountpointSourceState({ enabled: true, latest: null, now })).toBe('unknown');
  });

  it('reports online for fresh streaming sample', () => {
    expect(
      mountpointSourceState({
        enabled: true,
        latest: { state: 'streaming', ts: '2026-10-31T09:59:30Z' },
        now
      })
    ).toBe('online');
  });

  it('reports stale/offline/error distinctly', () => {
    expect(
      mountpointSourceState({
        enabled: true,
        latest: { state: 'stale', ts: '2026-10-31T09:59:30Z' },
        now
      })
    ).toBe('stale');
    expect(
      mountpointSourceState({
        enabled: true,
        latest: { state: 'streaming', ts: '2026-10-31T09:55:00Z' },
        now
      })
    ).toBe('offline');
    expect(
      mountpointSourceState({
        enabled: true,
        latest: { state: 'error', ts: '2026-10-31T09:59:59Z' },
        now
      })
    ).toBe('error');
  });
});
