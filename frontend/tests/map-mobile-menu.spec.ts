import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test.describe('menu mobile trên bản đồ', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('menu mở trên bản đồ, click được và Esc đóng', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/map/tiles/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG })
    );

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/map');
    await expect(page.locator('.map-shell')).toBeVisible();

    const sidebar = page.locator('.sidebar');
    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(sidebar).toHaveClass(/open/);
    await page.waitForTimeout(250);

    // Điểm giữa một mục menu phải thuộc sidebar: chứng minh overlay bản đồ
    // (z-index 1100-1400) không còn phủ lên drawer mobile.
    const target = sidebar.getByRole('link', { name: 'Tài khoản NTRIP' });
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    const hitSidebar = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('.sidebar') !== null,
      { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
    );
    expect(hitSidebar).toBe(true);

    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/open/);
  });
});
