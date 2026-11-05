import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('lịch sử relay', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('lọc sự kiện theo loại và không lỗi trang', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/history');
    await page.getByRole('tab', { name: 'Sự kiện' }).click();
    await page.getByRole('button', { name: /Bộ lọc/ }).click();
    const filter = page.getByLabel('Loại sự kiện');
    await expect(filter).toBeVisible();

    const request = page.waitForRequest((item) =>
      item.url().includes('/api/history/events?') && item.url().includes('type=reconnect')
    );
    await filter.fill('reconnect');
    expect((await request).url()).toContain('type=reconnect');

    await expect(page.getByRole('tab', { name: 'Sự kiện' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(errors).toEqual([]);
  });
});
