import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('Bản đồ — nhãn quần đảo Việt Nam', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('hiện từ zoom mặc định và ẩn khi zoom nhỏ hơn', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await login(page);
    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();

    // Zoom mặc định lấy từ cấu hình (6) và không bị fit markers ghi đè.
    const labels = page.locator('.map-archipelago');
    await expect(labels).toHaveCount(2);
    await expect(labels.filter({ hasText: 'Quần đảo Hoàng Sa' })).toBeVisible();
    await expect(labels.filter({ hasText: 'Quần đảo Trường Sa' })).toBeVisible();

    await page.locator('.leaflet-control-zoom-out').click();
    await page.locator('.leaflet-control-zoom-out').click();
    await expect(labels).toHaveCount(0);

    await page.locator('.leaflet-control-zoom-in').click();
    await page.locator('.leaflet-control-zoom-in').click();
    await expect(labels).toHaveCount(2);

    await page.screenshot({ path: 'test-results/map-archipelago.png', fullPage: true });
    expect(errors).toEqual([]);
  });
});
