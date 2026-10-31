import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P1 mountpoint tối giản', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('tạo, xem drawer và xóa mountpoint', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const name = `E2E_MP_MIN_${Date.now()}`;

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/mountpoints');
    await page.getByRole('button', { name: 'Thêm mountpoint' }).click();
    await page.getByLabel('Tên mountpoint').fill(name);
    await page.getByLabel('Ghi chú').fill('P1 minimal');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();

    const row = page.getByRole('row', { name: new RegExp(name) }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('enabled');
    await row.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Online');
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng' }).last().click();

    await page.getByRole('button', { name: `Xóa ${name}` }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Xóa', exact: true })
      .click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
