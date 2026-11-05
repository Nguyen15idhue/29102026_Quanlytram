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
  const field = page.locator('.field', { hasText: 'Renderer' }).first();
  await field.locator('select').selectOption(renderer);
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.getByText('Đã lưu cấu hình bản đồ')).toBeVisible();
}

async function openBasePanel(page: Page) {
  await page.getByRole('button', { name: 'Nền bản đồ' }).click();
}

test.describe('lớp ranh giới tỉnh', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test.afterEach(async ({ page }) => {
    try {
      await setRenderer(page, 'leaflet');
    } catch {
      // Test chính đã thất bại trước khi đăng nhập.
    }
  });

  test('Leaflet: bật/tắt và giữ trạng thái sau reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await setRenderer(page, 'leaflet');
    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();

    const labels = page.locator('.map-province-label');
    await expect(labels.first()).toBeAttached({ timeout: 15_000 });
    expect(await labels.count()).toBeGreaterThanOrEqual(30);

    await openBasePanel(page);
    await page.getByLabel('Ranh giới & tên tỉnh').uncheck();
    await expect(page).toHaveURL(/provinces=0/);
    await expect(labels).toHaveCount(0);

    await page.reload();
    await expect(labels).toHaveCount(0);

    await openBasePanel(page);
    await page.getByLabel('Ranh giới & tên tỉnh').check();
    await expect(labels.first()).toBeAttached();
    expect(await labels.count()).toBeGreaterThanOrEqual(30);
  });

  test('MapLibre: có line layer + nhãn và tắt được', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await setRenderer(page, 'maplibre');
    await page.goto('/map');
    await expect(page.locator('.maplibre-canvas')).toBeVisible();

    await page.waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __map?: { getLayer: (id: string) => unknown } }).__map?.getLayer(
            'provinces-line'
          )
        ),
      undefined,
      { timeout: 20_000 }
    );

    const labels = page.locator('.map-province-label');
    await expect(labels.first()).toBeAttached({ timeout: 15_000 });
    expect(await labels.count()).toBeGreaterThanOrEqual(30);

    await openBasePanel(page);
    await page.getByLabel('Ranh giới & tên tỉnh').uncheck();
    await page.waitForFunction(
      () =>
        !(window as unknown as { __map?: { getLayer: (id: string) => unknown } }).__map?.getLayer(
          'provinces-line'
        ),
      undefined,
      { timeout: 10_000 }
    );
    await expect(labels).toHaveCount(0);

    await page.reload();
    await expect(labels).toHaveCount(0);
  });
});
