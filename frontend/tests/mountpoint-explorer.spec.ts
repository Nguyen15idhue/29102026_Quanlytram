import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P1.6 mountpoint drawer gộp Explorer', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('không còn Explorer menu, mở drawer từ danh sách', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Mountpoint Explorer' })).toHaveCount(0);
    await page.goto('/mountpoints');
    const row = page.locator('.data-table tbody tr').first();
    await expect(row).toBeVisible();
    await row.locator('.link-btn').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Online');
    await expect(drawer).toContainText('Relay');
    await expect(page.locator('body')).not.toContainText('password_hash');
    await page.screenshot({
      path: 'test-results/mountpoint-drawer-light.png',
      fullPage: true
    });
    await drawer.getByRole('button', { name: 'Đóng' }).last().click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mountpoints');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);

    expect(errors).toEqual([]);
  });
});
