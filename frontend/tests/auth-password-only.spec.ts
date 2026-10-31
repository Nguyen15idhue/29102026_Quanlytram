import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P0 Phase 8 password-only mountpoint', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('create, inspect and delete password-only mountpoint', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const name = `E2E_PWONLY_${Date.now()}`;

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/mountpoints');
    await page.getByRole('button', { name: 'Thêm mountpoint' }).click();
    await page.getByLabel('Tên mountpoint').fill(name);
    await page.getByLabel('Cơ chế xác thực').selectOption('password_only');
    await page.getByLabel('Mật khẩu mountpoint').fill('Secret123!');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();

    const row = page.getByRole('row', { name: new RegExp(name) }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('password_only');
    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Chỉ password');
    await expect(dialog).toContainText('đã đặt mật khẩu');
    await expect(dialog).not.toContainText('password_hash');
    await expect(dialog).not.toContainText('Secret123!');
    await dialog.getByRole('button', { name: 'Đóng' }).last().click();

    await page.getByRole('button', { name: `Xóa ${name}` }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Xóa', exact: true })
      .click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
