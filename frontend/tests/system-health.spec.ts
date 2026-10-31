import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P0 Phase 4 system health', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('four cards, fallback text, refresh and responsive', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('link', { name: 'System Health' }).click();
    await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Node', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Host / VPS' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'MySQL' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Go runtime' })).toBeVisible();
    await expect(page.getByText('tự làm mới 12s')).toBeVisible();
    await expect(page.getByText('Không thu thập network metric ở P0')).toBeVisible();
    await expect(page.getByText(/cache 12s/)).toBeVisible();

    const response = page.waitForResponse((res) => res.url().includes('/api/system/health'));
    await page.getByRole('button', { name: 'Tải lại' }).click();
    await expect((await response).status()).toBe(200);

    await page.screenshot({ path: 'test-results/system-health-light.png', fullPage: true });
    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: 'test-results/system-health-mobile-dark.png', fullPage: true });

    expect(errors).toEqual([]);
  });
});
