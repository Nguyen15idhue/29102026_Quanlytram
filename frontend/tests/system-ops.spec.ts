import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? '';

test.describe('P07 system optimize and automation', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('tabs, optimize cards, automation table and edit dialog', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/system?tab=optimize');
    await expect(page.getByRole('heading', { name: 'Tối ưu chỉ số' })).toBeVisible();
    await expect(page.getByText('Gợi ý tối ưu')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Database' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Go runtime' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Tối ưu' })).toHaveAttribute('aria-selected', 'true');

    await page.goto('/system?tab=automation');
    await expect(page.getByRole('heading', { name: 'Tự động hóa' })).toBeVisible();
    await expect(page.getByText('maintenance_jobs').first()).toBeVisible();
    await expect(page.getByText('Nhật ký audit').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lịch sử chạy' })).toBeVisible();

    const auditRow = page.locator('tr', { hasText: 'Nhật ký audit' }).first();
    await auditRow.getByRole('button', { name: 'Sửa' }).click();
    await expect(page.getByRole('heading', { name: 'Sửa cấu hình job' })).toBeVisible();
    await page.getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByRole('heading', { name: 'Sửa cấu hình job' })).toHaveCount(0);

    await auditRow.getByRole('button', { name: 'Chạy thử' }).click();
    await expect(page.getByText(/Chạy thử Nhật ký audit/).first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/system?tab=automation');
    await expect(page.getByRole('heading', { name: 'Tự động hóa' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);

    expect(errors).toEqual([]);
  });

  test('user không thấy tab Tối ưu/Tự động hóa và API 403', async ({ page }) => {
    test.skip(!userPassword, 'E2E_USER_PASSWORD is required');
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('user1');
    await page.getByLabel('Mật khẩu').fill(userPassword);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/system?tab=automation');
    await expect(page.getByRole('tab', { name: 'Sức khỏe' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Tối ưu' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Tự động hóa' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Tự động hóa' })).toHaveCount(0);

    const response = await page.request.get('/api/system/optimize');
    expect(response.status()).toBe(403);
  });
});
