import { ecefToGeodetic } from './geo';

export type CoordSource = '1005' | 'station' | 'none';

export interface CoordSample {
  reported_station_id?: number | null;
  arp_x?: number | string | null;
  arp_y?: number | string | null;
  arp_z?: number | string | null;
}

export interface StationLatLon {
  lat?: number | string | null;
  lon?: number | string | null;
}

export interface ResolvedCoords {
  lat: number | null;
  lon: number | null;
  coordSource: CoordSource;
  has1005: boolean;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validLatLon(lat: number | null, lon: number | null): boolean {
  return (
    lat !== null &&
    lon !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function resolveStationCoords(
  sample: CoordSample | null | undefined,
  station: StationLatLon
): ResolvedCoords {
  if (sample && sample.reported_station_id !== null && sample.reported_station_id !== undefined) {
    const arpX = finite(sample.arp_x);
    const arpY = finite(sample.arp_y);
    const arpZ = finite(sample.arp_z);
    if (arpX !== null && arpY !== null && arpZ !== null) {
      const point = ecefToGeodetic(arpX / 10000, arpY / 10000, arpZ / 10000);
      if (validLatLon(point.lat, point.lon)) {
        return { lat: point.lat, lon: point.lon, coordSource: '1005', has1005: true };
      }
    }
  }

  const lat = finite(station.lat);
  const lon = finite(station.lon);
  if (validLatLon(lat, lon)) {
    return { lat, lon, coordSource: 'station', has1005: false };
  }

  return { lat: null, lon: null, coordSource: 'none', has1005: false };
}
