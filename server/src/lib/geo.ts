const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

export interface Geodetic {
  lat: number;
  lon: number;
  height: number;
}

export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const lon = Math.atan2(y, x);
  const p = Math.sqrt(x * x + y * y);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let height = 0;

  for (let i = 0; i < 6; i += 1) {
    const sin = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
    height = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + height)));
  }

  return {
    lat: (lat * 180) / Math.PI,
    lon: (lon * 180) / Math.PI,
    height
  };
}

export interface Vn2000 {
  easting: number;
  northing: number;
  centralMeridian: number;
}

export function geodeticToVn2000(lat: number, lon: number, centralMeridian = 105): Vn2000 {
  const a = WGS84_A;
  const e2 = WGS84_E2;
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const lambda0 = (centralMeridian * Math.PI) / 180;
  const k0 = 0.9999;
  const falseEasting = 500000;
  const falseNorthing = 0;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const n = a / Math.sqrt(1 - e2 * sin * sin);
  const t = tan * tan;
  const c = ep2 * cos * cos;
  const aa = cos * (lambda - lambda0);
  const m =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));
  const easting =
    falseEasting +
    k0 *
      n *
      (aa +
        ((1 - t + c) * aa * aa * aa) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa * aa * aa * aa * aa) / 120);
  const northing =
    falseNorthing +
    k0 *
      (m +
        n *
          tan *
          ((aa * aa) / 2 +
            ((5 - t + 9 * c + 4 * c * c) * aa * aa * aa * aa) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa * aa * aa * aa * aa * aa) / 720));
  return { easting, northing, centralMeridian };
}
