import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function setRenderer(page: Page, renderer: 'leaflet' | 'maplibre') {
  await page.goto('/system/map-config');
  const field = page.locator('.field', { hasText: 'Renderer' }).first();
  await field.locator('select').selectOption(renderer);
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.getByText('Đã lưu cấu hình bản đồ')).toBeVisible();
}

test.describe('renderer bản đồ', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test.afterEach(async ({ page }) => {
    try {
      await setRenderer(page, 'leaflet');
    } catch {
      // Test chính đã thất bại trước khi đăng nhập.
    }
  });

  test('MapLibre: worker 200, tile và marker thực sự render', async ({ page }) => {
    const errors: string[] = [];
    let tileRequests = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/api/map/tiles/')) tileRequests += 1;
    });
    await page.route('**/api/map/tiles/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG })
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await setRenderer(page, 'maplibre');

    const worker = page.waitForResponse(
      (response) => response.url().includes('maplibre-gl-worker'),
      { timeout: 20_000 }
    );
    await page.goto('/map');
    expect((await worker).status()).toBe(200);

    await expect(page.locator('.maplibre-canvas')).toBeVisible();
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');

    await page.waitForFunction(() => {
      const map = (
        window as unknown as {
          __map?: {
            isSourceLoaded: (id: string) => boolean;
            querySourceFeatures: (id: string) => unknown[];
          };
        }
      ).__map;
      return Boolean(
        map && map.isSourceLoaded('tiles') && map.querySourceFeatures('stations').length > 0
      );
    }, undefined, { timeout: 20_000 });

    expect(tileRequests).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Fit' }).click();
    await expect(page.locator('.maplibre-canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('chuyển đổi Leaflet ↔ MapLibre và giữ lựa chọn sau reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    await setRenderer(page, 'leaflet');
    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();

    await setRenderer(page, 'maplibre');
    await page.goto('/map');
    await expect(page.locator('.maplibre-canvas')).toBeVisible();
    await page.reload();
    await expect(page.locator('.maplibre-canvas')).toBeVisible();

    await setRenderer(page, 'leaflet');
    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });

  test('không có WebGL thì tự fallback Leaflet và hiện banner', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: never[]
      ) {
        if (String(type).includes('webgl')) return null;
        return (original as (...params: never[]) => unknown).call(this, type, ...args);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await setRenderer(page, 'maplibre');
    await page.goto('/map');

    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.getByTestId('renderer-fallback')).toContainText(
      'Trình duyệt không hỗ trợ WebGL'
    );
  });
});
