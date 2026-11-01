import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function stubTiles(page: Page) {
  await page.route('**/api/map/tiles/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG })
  );
}

test.describe('Phase 8 maps', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('station map, online map and online list render', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await stubTiles(page);

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations/map');
    await expect(page).toHaveURL(/\/map\?layer=stations/);
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
    await expect(page.getByText('2 có toạ độ')).toBeVisible();
    await expect(page.getByText('2 thiếu toạ độ')).toBeVisible();
    await expect(page.locator('.leaflet-interactive')).toHaveCount(2, { timeout: 10_000 });

    await page.goto('/online');
    await expect(page.getByRole('heading', { name: 'Danh sách online' })).toBeVisible();

    await page.goto('/online/map');
    await expect(page).toHaveURL(/\/map\?layer=online/);
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
