import { describe, expect, it } from 'vitest';
import {
  buildReliability,
  metadataStatusFor,
  qualityStatusFor,
  sampleHasArp,
  sampleMetadataOk,
  transportStatusFor
} from '../src/lib/stationDetail';

describe('station transport status', () => {
  it('keeps transport independent from quality score', () => {
    expect(transportStatusFor('streaming', 1_200)).toBe('online');
    expect(transportStatusFor('streaming', 5_000)).toBe('online');
    expect(transportStatusFor('streaming', 12_000)).toBe('offline');
    expect(transportStatusFor('streaming', 45_000)).toBe('offline');
    expect(transportStatusFor('error', 1_000)).toBe('offline');
    expect(transportStatusFor('streaming', null)).toBe('offline');
    expect(transportStatusFor('streaming', 60_000, { connected: true })).toBe('no_data');
    expect(transportStatusFor('streaming', 1_000, { everConnected: false })).toBe(
      'offline'
    );
    expect(
      transportStatusFor('streaming', 60_000, { disconnectAgeMs: 5_000 })
    ).toBe('no_data');
    expect(
      transportStatusFor('streaming', 60_000, { disconnectAgeMs: 11_000 })
    ).toBe('offline');
  });
});

describe('station quality status', () => {
  it('requires metadata and MSM for good status', () => {
    expect(
      qualityStatusFor({ score: 92, state: 'streaming', metadataOk: true, hasMsm: true })
    ).toBe('good');
    expect(
      qualityStatusFor({ score: 92, state: 'streaming', metadataOk: false, hasMsm: true })
    ).toBe('warning');
    expect(
      qualityStatusFor({ score: 74, state: 'streaming', metadataOk: true, hasMsm: true })
    ).toBe('warning');
    expect(
      qualityStatusFor({ score: 48, state: 'streaming', metadataOk: true, hasMsm: false })
    ).toBe('critical');
    expect(
      qualityStatusFor({ score: null, state: 'unknown', metadataOk: false, hasMsm: false })
    ).toBe('unknown');
  });
});

describe('station metadata status', () => {
  it('flags missing metadata while streaming', () => {
    expect(
      metadataStatusFor({
        present: true,
        streaming: true,
        reportedStationId: null,
        hasArp: false,
        antenna: ''
      })
    ).toBe('critical');
    expect(
      metadataStatusFor({
        present: true,
        streaming: true,
        reportedStationId: 1005,
        hasArp: true,
        antenna: ''
      })
    ).toBe('warning');
    expect(
      metadataStatusFor({
        present: true,
        streaming: true,
        reportedStationId: 1005,
        hasArp: true,
        antenna: 'TRM'
      })
    ).toBe('ok');
  });

  it('reads 1005/1006 fields from a quality sample', () => {
    const sample = {
      reported_station_id: 1005,
      arp_x: 1,
      arp_y: 2,
      arp_z: 3
    };
    expect(sampleHasArp(sample)).toBe(true);
    expect(sampleMetadataOk(sample)).toBe(true);
    expect(sampleMetadataOk({ ...sample, arp_z: null })).toBe(false);
  });
});

describe('station reliability', () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');

  it('counts samples and marks incomplete windows', () => {
    const samples = [
      { ts: '2026-10-31T11:45:00.000Z', state: 'streaming', frames: 10 },
      { ts: '2026-10-31T11:46:00.000Z', state: 'streaming', frames: 10 },
      { ts: '2026-10-31T11:47:00.000Z', state: 'error', frames: 0 }
    ];
    const reliability = buildReliability(samples, { windowSec: 900, now });
    expect(reliability.windowSec).toBe(900);
    expect(reliability.sampleCount).toBe(3);
    expect(reliability.validSampleCount).toBe(2);
    expect(reliability.dataCompleteness).toBeCloseTo(2 / 15);
    expect(reliability.observationStartedAt).toBe('2026-10-31T11:45:00.000Z');
    expect(reliability.scoreUpdatedAt).toBe('2026-10-31T11:47:00.000Z');
  });

  it('returns empty reliability without samples', () => {
    expect(buildReliability([], { windowSec: 900, now })).toEqual({
      windowSec: 900,
      sampleCount: 0,
      validSampleCount: 0,
      dataCompleteness: 0,
      observationStartedAt: null,
      scoreUpdatedAt: null,
      lastDataAt: null
    });
  });
});
