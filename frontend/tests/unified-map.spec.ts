import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P0 Phase 3 unified map', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('redirects, markers, panel, drawer, filters and responsive', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
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
    await expect(page.locator('.leaflet-interactive')).toHaveCount(3);

    await page.goto('/online/map');
    await expect(page).toHaveURL(/\/map\?layer=online/);
    await expect(page.getByRole('row')).toHaveCount(0);

    await page.getByLabel('Layer bản đồ').selectOption('stations');
    await page.getByPlaceholder('Tìm trạm, vùng, địa chỉ').fill('THA');
    await expect(page).toHaveURL(/q=THA/);
    await page.getByRole('button', { name: /THA_HauLoc/ }).first().click();
    await expect(page).toHaveURL(/station=80/);
    await expect(page.getByText('Mở chi tiết trạm')).toBeVisible();
    await page.screenshot({ path: 'test-results/unified-map-light.png', fullPage: true });

    await page.getByRole('button', { name: /Mở chi tiết trạm/ }).click();
    await expect(page).toHaveURL(/\/stations\/80/);
    await expect(page.getByText('THA_HauLoc').first()).toBeVisible();
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
