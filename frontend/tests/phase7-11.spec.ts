import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('Phase 7-11 operational flows', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('alerts, caster, relay, profile and user import/export', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Cảnh báo' })).toBeVisible();
    await page.getByRole('button', { name: /Bộ lọc/ }).click();
    await expect(page.getByLabel('Level cảnh báo')).toBeVisible();
    await expect(page.getByLabel('Trạng thái đọc')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đánh dấu đã đọc' })).toBeVisible();

    await page.goto('/caster');
    await expect(page.getByRole('heading', { name: 'Caster' })).toBeVisible();
    const listenerRow = page.locator('tbody tr').first();
    if (await listenerRow.count()) {
      await listenerRow.locator('.link-btn').click();
      const detail = page.getByRole('dialog');
      await expect(detail.getByText('Port', { exact: true })).toBeVisible();
      await expect(detail.getByText('Vai trò', { exact: true })).toBeVisible();
      await expect(detail.getByText('Mountpoint', { exact: true })).toBeVisible();
      await detail.getByRole('button', { name: 'Đóng' }).last().click();
    }

    await page.goto('/relay-jobs');
    const relayRow = page.locator('tbody tr').first();
    if (await relayRow.count()) {
      await relayRow.locator('.link-btn').click();
      const detail = page.getByRole('dialog');
      await expect(detail.locator('dt').filter({ hasText: /^Nguồn$/ })).toBeVisible();
      await expect(detail.locator('dt').filter({ hasText: /^Đích$/ })).toBeVisible();
      await expect(detail.locator('dt', { hasText: 'Revision' })).toBeVisible();
      await detail.getByRole('button', { name: 'Đóng' }).last().click();
    }

    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Trang cá nhân' })).toBeVisible();
    await expect(page.getByLabel('Tên hiển thị')).toBeVisible();
    await expect(page.getByLabel('Mật khẩu hiện tại')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phiên đăng nhập' })).toBeVisible();

    await page.goto('/web-users');
    await expect(page.getByRole('heading', { name: 'Người dùng web' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Excel/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Import/ })).toBeVisible();
  });
});
