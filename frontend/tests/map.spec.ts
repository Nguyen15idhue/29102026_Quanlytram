import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('Phase 8 maps', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('station map, online map and online list render', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations/map');
    await expect(page.getByRole('heading', { name: 'Bản đồ trạm' })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();

    await page.goto('/online');
    await expect(page.getByRole('heading', { name: 'Danh sách online' })).toBeVisible();

    await page.goto('/online/map');
    await expect(page.getByRole('heading', { name: 'Bản đồ online' })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
