import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const STATION = { lat: 21.0285, lon: 105.8542 };
const ROVER_A = { lat: 21.03, lon: 105.86 };
const ROVER_C = { lat: 21.04, lon: 105.87 };

function mockedOverview() {
  return {
    items: [
      {
        id: 1,
        name: 'Trạm mock',
        lat: STATION.lat,
        lon: STATION.lon,
        coordSource: 'station',
        hasCoords: true,
        transport: 'online',
        quality: 'unknown',
        score: null,
        sourceType: 'manual',
        mountpointCount: 1,
        relayJobCount: null,
        onlineAccounts: 2,
        accountStatus: 'fixed',
        connectedAccounts: [
          { id: 11, username: 'roverA', fixType: 'fixed' },
          { id: 12, username: 'roverB', fixType: 'single' }
        ],
        region: '',
        address: '',
        companyId: null,
        companyName: null,
        ownerWebUserId: null,
        ownerName: null
      }
    ],
    total: 1,
    truncated: false,
    accounts: [
      {
        connectionId: 101,
        accountId: 11,
        username: 'roverA',
        mountpointId: 1,
        stationId: 1,
        hasCoords: true,
        roverLat: ROVER_A.lat,
        roverLon: ROVER_A.lon,
        roverAlt: 10,
        roverSats: 8,
        roverFixTs: new Date().toISOString(),
        roverStale: false,
        fixType: 'fixed',
        startTs: new Date().toISOString(),
        bytesIn: 100,
        bytesOut: 200
      },
      {
        connectionId: 102,
        accountId: 12,
        username: 'roverB',
        mountpointId: 1,
        stationId: 1,
        hasCoords: true,
        roverLat: null,
        roverLon: null,
        roverAlt: null,
        roverSats: null,
        roverFixTs: null,
        roverStale: true,
        fixType: 'single',
        startTs: new Date().toISOString(),
        bytesIn: 50,
        bytesOut: 60
      },
      {
        connectionId: 103,
        accountId: 13,
        username: 'roverC',
        mountpointId: 9,
        stationId: null,
        hasCoords: true,
        roverLat: ROVER_C.lat,
        roverLon: ROVER_C.lon,
        roverAlt: null,
        roverSats: 7,
        roverFixTs: new Date().toISOString(),
        roverStale: false,
        fixType: 'float',
        startTs: new Date().toISOString(),
        bytesIn: 10,
        bytesOut: 20
      }
    ],
    counts: {
      all: 1,
      online: 1,
      issues: 0,
      online_accounts: 1,
      accounts: 3,
      accountsOutsideStations: 1,
      withCoords: 1,
      missingCoords: 0,
      missing_1005: 1,
      stationStatus: { online: 1, stale: 0, no_data: 0, offline: 0, error: 0, unknown: 0 },
      accountStatus: { none: 0, single: 1, fixed: 1, float: 1, rtd: 0, error: 0 },
      filtered: 1
    },
    layersAvailable: ['stations', 'online', 'issues', 'missing_coords', 'online_accounts'],
    regions: [],
    owners: [],
    filters: { q: '', region: '', owner: null, layer: 'stations', transport: [], status: null, hasCoords: null, companyId: null }
  };
}

async function stubOverview(page: Page) {
  await page.route('**/api/map/overview*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockedOverview()) })
  );
}

test.describe('pin rover GGA trên bản đồ', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('rover có GGA vẽ pin riêng, không trùng trạm (Leaflet)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/map/tiles/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG })
    );

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await stubOverview(page);
    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();

    // 1 pin trạm (.map-pin) + 3 pin tài khoản (.map-account-wrapper):
    // A rover, B fallback trạm, C orphan rover.
    await expect(page.locator('.map-pin')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('.map-account-wrapper')).toHaveCount(3, { timeout: 10_000 });

    const markerPoints = await page.evaluate(() => {
      const map = (window as unknown as { __leafletMap?: { eachLayer(cb: (l: unknown) => void): void } }).__leafletMap;
      if (!map) return null;
      const pts: Array<[number, number]> = [];
      map.eachLayer((layer) => {
        const marker = layer as { getLatLng?: () => { lat: number; lng: number } };
        if (marker.getLatLng) {
          const ll = marker.getLatLng();
          pts.push([ll.lat, ll.lng]);
        }
      });
      return pts;
    });
    expect(markerPoints).not.toBeNull();
    const close = (a: [number, number], b: [number, number]) =>
      Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    // Rover A và C phải có marker đúng tọa độ GGA, tách khỏi trạm.
    expect(markerPoints!.some((p) => close(p, [ROVER_A.lat, ROVER_A.lon]))).toBe(true);
    expect(markerPoints!.some((p) => close(p, [ROVER_C.lat, ROVER_C.lon]))).toBe(true);
    // Trạm vẫn có marker riêng.
    expect(markerPoints!.some((p) => close(p, [STATION.lat, STATION.lon]))).toBe(true);
    expect(errors).toEqual([]);
  });
});
