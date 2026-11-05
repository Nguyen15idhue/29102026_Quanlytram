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
    // Trả cấu hình về Leaflet để các test khác không phụ thuộc thứ tự.
    try {
      await setRenderer(page, 'leaflet');
    } catch {
      // Bỏ qua: test chính đã thất bại trước khi đăng nhập.
    }
  });

  test('MapLibre hiển thị nền, attribution và nhận Fit', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/map/tiles/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG })
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await setRenderer(page, 'maplibre');

    await page.goto('/map');
    await expect(page.locator('.maplibre-canvas')).toBeVisible();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');

    await page.getByRole('button', { name: 'Fit' }).click();
    await expect(page.locator('.maplibre-canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
