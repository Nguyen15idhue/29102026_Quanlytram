import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function setRenderer(page: Page, renderer: 'leaflet' | 'maplibre') {
  await page.goto('/system/map-config');
  await page
    .locator('.field', { hasText: 'Renderer' })
    .first()
    .locator('select')
    .selectOption(renderer);
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.getByText('Đã lưu cấu hình bản đồ')).toBeVisible();
}

test.describe('pin tài khoản trên MapLibre', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test.afterEach(async ({ page }) => {
    try {
      await setRenderer(page, 'leaflet');
    } catch {
      // Test chính đã thất bại trước khi đăng nhập.
    }
  });

  test('mỗi kết nối có pin hình người, khớp danh sách online', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await setRenderer(page, 'maplibre');
    await page.goto('/map');
    await expect(page.locator('.maplibre-canvas')).toBeVisible();

    const overview = await (await page.request.get('/api/map/overview')).json();
    // Pin hiển thị: có GGA rover (kể cả ngoài trạm) hoặc gắn được trạm.
    const expected = (
      overview.accounts as Array<{
        stationId: number | null;
        roverLat: number | null;
        roverLon: number | null;
      }>
    ).filter(
      (item) =>
        (item.roverLat !== null &&
          item.roverLon !== null &&
          Number.isFinite(Number(item.roverLat)) &&
          Number.isFinite(Number(item.roverLon))) ||
        item.stationId !== null
    ).length;
    if (expected > 0) {
      await expect(page.locator('.map-account-pin')).toHaveCount(expected, {
        timeout: 20_000
      });
    }
    expect(overview.counts.accounts).toBe(Number(overview.accounts.length));
  });
});
