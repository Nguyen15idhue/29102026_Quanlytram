import { describe, expect, it } from 'vitest';
import {
  buildTileUrl,
  DEFAULT_MAP_CONFIG,
  MODE_PROVIDERS,
  normalizeMapConfig,
  parseTileCoord,
  sanitizeMapConfig,
  validateMapConfigInput
} from '../src/lib/mapConfig';
import { resolveStationCoords } from '../src/lib/mapCoords';

describe('map config', () => {
  it('uses allowlisted providers and never the OSM root', () => {
    expect(new URL(MODE_PROVIDERS.streets.template).hostname).toBe('tile.openstreetmap.de');
    expect(new URL(MODE_PROVIDERS.streets.fallbackTemplate!).hostname).toBe(
      'a.tile.openstreetmap.fr'
    );
    expect(new URL(MODE_PROVIDERS.satellite.template).hostname).toBe(
      'server.arcgisonline.com'
    );
    expect(new URL(MODE_PROVIDERS.terrain.template).hostname).toBe('a.tile.opentopomap.org');
    for (const mode of Object.values(MODE_PROVIDERS)) {
      expect(mode.template).not.toContain('tile.openstreetmap.org');
    }
  });

  it('strips secret-like keys from stored config', () => {
    const normalized = normalizeMapConfig({ ...DEFAULT_MAP_CONFIG, apiKey: 'secret-value' });
    expect((normalized as Record<string, unknown>).apiKey).toBeUndefined();
    expect(JSON.stringify(sanitizeMapConfig(normalized))).not.toContain('secret-value');
  });

  it('rejects direct tile urls outside the allowlist', () => {
    const unsafe = {
      ...DEFAULT_MAP_CONFIG,
      tileMode: 'direct' as const,
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
    };
    expect(() => validateMapConfigInput(unsafe)).toThrow(/allowlist/);
  });

  it('accepts proxy config with its internal tile url', () => {
    const config = validateMapConfigInput(DEFAULT_MAP_CONFIG);
    expect(config.tileMode).toBe('proxy');
    expect(config.tileUrl.startsWith('/api/map/tiles')).toBe(true);
  });

  it('builds z/x/y tile urls including the Esri y/x order', () => {
    expect(buildTileUrl('https://tile.openstreetmap.de/{z}/{x}/{y}.png', 5, 24, 15)).toBe(
      'https://tile.openstreetmap.de/5/24/15.png'
    );
    expect(
      buildTileUrl(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        5,
        24,
        15
      )
    ).toContain('/tile/5/15/24');
  });

  it('validates tile coordinates', () => {
    expect(parseTileCoord('5', '24', '15')).toEqual({ z: 5, x: 24, y: 15 });
    expect(parseTileCoord('5', '32', '15')).toBeNull();
    expect(parseTileCoord('23', '0', '0')).toBeNull();
    expect(parseTileCoord('x', '0', '0')).toBeNull();
    expect(parseTileCoord('5', '-1', '0')).toBeNull();
  });
});

describe('map coordinates', () => {
  const arpX = -16495806947;
  const arpY = 57644480705;
  const arpZ = 21676882385;

  it('prefers 1005 coordinates when present and valid', () => {
    const coords = resolveStationCoords(
      { reported_station_id: 483, arp_x: arpX, arp_y: arpY, arp_z: arpZ },
      { lat: 10, lon: 10 }
    );
    expect(coords.coordSource).toBe('1005');
    expect(coords.has1005).toBe(true);
    expect(coords.lat).toBeGreaterThan(19.9);
    expect(coords.lat).toBeLessThan(22);
    expect(coords.lon).toBeGreaterThan(104);
    expect(coords.lon).toBeLessThan(107);
  });

  it('falls back to station lat/lon', () => {
    const coords = resolveStationCoords(
      { reported_station_id: null, arp_x: null, arp_y: null, arp_z: null },
      { lat: 21.0285, lon: 105.8542 }
    );
    expect(coords.coordSource).toBe('station');
    expect(coords.lat).toBeCloseTo(21.0285, 6);
    expect(coords.lon).toBeCloseTo(105.8542, 6);
    expect(coords.has1005).toBe(false);
  });

  it('returns none when neither source is valid', () => {
    const coords = resolveStationCoords(
      { reported_station_id: 1, arp_x: null, arp_y: null, arp_z: null },
      { lat: null, lon: null }
    );
    expect(coords.coordSource).toBe('none');
    expect(coords.lat).toBeNull();
    expect(coords.lon).toBeNull();
  });

  it('ignores out-of-range station coordinates', () => {
    const coords = resolveStationCoords(null, { lat: 200, lon: 300 });
    expect(coords.coordSource).toBe('none');
  });
});
