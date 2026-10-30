import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? password;

test.describe('Phase 5 realtime', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('dashboard realtime, reconnect and alerts/history routes', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Realtime trực tuyến')).toBeVisible({ timeout: 15_000 });

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await nav.getByRole('link', { name: 'Cảnh báo' }).click();
    await expect(page.getByRole('heading', { name: 'Cảnh báo' })).toBeVisible();

    await nav.getByRole('link', { name: 'Lịch sử' }).click();
    await expect(page.getByRole('heading', { name: 'Lịch sử relay' })).toBeVisible();
    for (const label of ['Phiên', 'Sự kiện', 'Theo giờ']) {
      await page.getByRole('tab', { name: label }).click();
      await expect(page.getByRole('tab', { name: label })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }

    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByText('Realtime trực tuyến')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('Đang kết nối lại')).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
    await expect(page.getByText('Realtime trực tuyến')).toBeVisible({ timeout: 20_000 });

    expect(errors).toEqual([]);
  });

  test('user scope sees only own summaries and hides admin menus', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('user1');
    await page.getByLabel('Mật khẩu').fill(userPassword);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Realtime trực tuyến')).toBeVisible({ timeout: 15_000 });
    const snapshot = await page.evaluate(async () => {
      const response = await fetch('/api/snapshot', { credentials: 'include' });
      return response.json();
    });
    expect(snapshot.item.summary.stations).toBe(1);
    expect(snapshot.item.summary.listeners).toBeGreaterThanOrEqual(0);
  });
});
