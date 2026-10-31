import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P0 Phase 5 ops dashboard', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('four zones, impact links, health and responsive', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await expect(page.locator('.kpi-strip').getByText('Trạm', { exact: true })).toBeVisible();
    await expect(page.locator('.kpi-strip').getByText('Tài khoản NTRIP', { exact: true })).toBeVisible();
    await expect(page.getByText('Sự cố mở')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sức khỏe hệ thống' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sự cố cần xử lý' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hoạt động gần đây' })).toBeVisible();
    await expect(page.locator('.ops-health')).toContainText('Node');
    await expect(page.locator('.ops-health')).toContainText('Go');

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.screenshot({ path: 'test-results/dashboard-ops-light.png', fullPage: true });

    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: 'test-results/dashboard-ops-mobile-dark.png', fullPage: true });

    expect(errors).toEqual([]);
  });
});
