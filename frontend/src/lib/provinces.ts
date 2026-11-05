export interface ProvinceFeature {
  type: 'Feature';
  properties: { name?: string };
  geometry: { type: string; coordinates: unknown };
}

let cache: Promise<ProvinceFeature[]> | null = null;

/** Nạp ranh giới tỉnh một lần, dùng chung cho cả Leaflet và MapLibre. */
export function loadProvinces(): Promise<ProvinceFeature[]> {
  if (!cache) {
    cache = fetch('/geo/vietnam-provinces.geojson')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => (Array.isArray(data?.features) ? (data.features as ProvinceFeature[]) : []))
      .catch((error) => {
        cache = null;
        throw error;
      });
  }
  return cache;
}

export function provinceCollection(features: ProvinceFeature[]): unknown {
  return { type: 'FeatureCollection', features };
}

/**
 * Tâm bbox của geometry — đủ tốt để đặt nhãn tỉnh, không cần thêm thư viện.
 */
export function featureCenter(feature: ProvinceFeature): [number, number] | null {
  const points: number[][] = [];
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push([value[0], value[1]]);
      return;
    }
    for (const item of value) walk(item);
  };
  walk(feature.geometry?.coordinates);
  if (points.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}
