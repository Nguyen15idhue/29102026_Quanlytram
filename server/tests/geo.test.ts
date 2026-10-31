import { describe, expect, it } from 'vitest';
import { ecefToGeodetic, geodeticToVn2000 } from '../src/lib/geo';

describe('geo conversion', () => {
  it('converts ECEF equator/prime meridian to WGS84', () => {
    const point = ecefToGeodetic(6378137, 0, 0);
    expect(point.lat).toBeCloseTo(0, 9);
    expect(point.lon).toBeCloseTo(0, 9);
    expect(point.height).toBeCloseTo(0, 3);
  });

  it('projects the central meridian to VN2000 false easting', () => {
    const point = geodeticToVn2000(0, 105);
    expect(point.easting).toBeCloseTo(500000, 3);
    expect(point.northing).toBeCloseTo(0, 3);
  });
});
