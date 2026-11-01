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

test.describe('P0 Phase 3 unified map', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('redirects, markers, panel, filters and responsive', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await stubTiles(page);
    await page.setViewportSize({ width: 1440, height: 900 });

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
    await expect(page.locator('.map-pin')).toHaveCount(2, { timeout: 15_000 });

    await page.goto('/online/map');
    await expect(page).toHaveURL(/\/map\?layer=online/);
    await expect(page.getByRole('row')).toHaveCount(0);

    await page.getByRole('button', { name: 'Lớp bản đồ' }).click();
    await page
      .locator('#map-layers-popover')
      .getByRole('combobox', { name: 'Layer bản đồ' })
      .selectOption('stations');
    await page.keyboard.press('Escape');
    await page.getByLabel('Tìm trạm hoặc địa chỉ').fill('Hà Nội');
    await expect(page).toHaveURL(/[?&]q=/);
    await page.getByRole('button', { name: 'Danh sách trạm' }).click();
    await expect(page.locator('.map-list-item')).toHaveCount(2);
    await page.locator('.map-list-item').first().click();
    await expect(page).toHaveURL(/station=/);
    await expect(page.getByRole('button', { name: /Mở chi tiết trạm/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/unified-map-light.png', fullPage: true });

    await page.getByRole('button', { name: /Mở chi tiết trạm/ }).click();
    await expect(page).toHaveURL(/\/stations\/\d+/);
    await expect(page.getByText('Trạm test Hà Nội 01').first()).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();

    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.leaflet-container')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/map?layer=issues');
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: 'test-results/unified-map-mobile-dark.png', fullPage: true });

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/map?layer=stations');
    await expect(page.getByRole('heading', { name: 'Bản đồ vận hành' })).toBeVisible();
    const tabletOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(tabletOverflow).toBe(false);

    expect(errors).toEqual([]);
  });
});
