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

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P06-2 map filters, address search and interactions', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('filters, URL state, markers, popup, address search, responsive and dark mode', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await stubTiles(page);
    await page.route('**/api/geo/search**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ label: 'Hồ Hoàn Kiếm, Hà Nội', lat: 21.0287, lon: 105.8524 }]
        })
      })
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto('/map?layer=stations');

    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();
    await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
    await expect(page.locator('.leaflet-interactive')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText('2 có toạ độ')).toBeVisible();
    await expect(page.locator('.marker-cluster')).toHaveCount(0);

    await page.getByLabel('Layer bản đồ').selectOption('online');
    await expect(page).toHaveURL(/layer=online/);
    await expect(page.locator('.leaflet-interactive')).toHaveCount(1);

    await page.getByRole('button', { name: /Xoá lọc/ }).click();
    await expect(page).toHaveURL(/layer=stations/);
    await expect(page.locator('.leaflet-interactive')).toHaveCount(2);

    await page
      .getByPlaceholder('Tìm trạm, ID, vùng, địa chỉ, owner')
      .fill('Hà Nội');
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.locator('.map-list-item')).toHaveCount(2);

    await page.getByRole('button', { name: /Xoá lọc/ }).click();
    await expect(page.locator('.map-list-item')).toHaveCount(4);

    await page.locator('.map-list-item').first().click();
    await expect(page).toHaveURL(/station=/);
    await expect(page.getByRole('button', { name: /Mở chi tiết trạm/ })).toBeVisible();
    await page.getByRole('button', { name: /Mở chi tiết trạm/ }).click();
    await expect(page).toHaveURL(/\/stations\/\d+/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();

    await page.getByLabel('Tìm địa chỉ').fill('Hồ Hoàn Kiếm');
    await expect(page.locator('.address-results button')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('.address-results button').first().click();
    await expect(page.locator('.leaflet-tooltip')).toContainText('Hồ Hoàn Kiếm');
    await expect(page).toHaveURL(/\/map/);

    await page.getByLabel('Nền bản đồ').selectOption('satellite');
    await expect(page).toHaveURL(/mode=satellite/);
    await expect(page.locator('.leaflet-control-attribution')).toContainText('Esri');

    await page.getByRole('button', { name: /Fit kết quả/ }).click();

    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.leaflet-container')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/map?layer=stations');
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(mobileOverflow).toBe(false);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/map?layer=issues');
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();
    const tabletOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(tabletOverflow).toBe(false);

    expect(errors).toEqual([]);
  });

  test('tile failure shows banner and retry clears it', async ({ page }) => {
    await page.route('**/api/map/tiles/**', (route) => route.abort());
    await login(page);
    await page.goto('/map?layer=stations');
    await expect(page.getByTestId('tile-error-banner')).toBeVisible({ timeout: 15_000 });

    await page.unroute('**/api/map/tiles/**');
    await stubTiles(page);
    await page.getByRole('button', { name: /Thử lại/ }).click();
    await expect(page.getByTestId('tile-error-banner')).toHaveCount(0, { timeout: 15_000 });
  });
});
