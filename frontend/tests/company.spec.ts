import { expect, test } from '@playwright/test';

const superPassword = process.env.E2E_PASSWORD ?? '';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';

async function login(page: any, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P05 UI công ty', () => {
  test.skip(!superPassword, 'E2E_PASSWORD is required');

  test('super tạo, sửa, disable và xóa công ty; responsive/dark', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);

    await page.getByRole('link', { name: 'Công ty' }).click();
    await expect(page.getByRole('heading', { name: 'Công ty' })).toBeVisible();

    const code = `e2e_${Date.now()}`;
    const name = `Công ty E2E ${code.slice(-4)}`;
    await page.getByRole('button', { name: 'Thêm công ty' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mã công ty').fill(code);
    await dialog.getByLabel('Tên công ty').fill(name);
    await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(page.getByRole('button', { name: code })).toBeVisible();

    await page.getByRole('button', { name: `Sửa ${name}` }).click();
    const edit = page.getByRole('dialog');
    await edit.getByLabel('Tên công ty').fill(`${name} sửa`);
    await edit.getByRole('button', { name: 'Cập nhật' }).click();
    await expect(page.getByText(`${name} sửa`, { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: `Vô hiệu hóa ${name} sửa` }).click();
    await expect(page.getByText('Đã vô hiệu hóa công ty').first()).toBeVisible();

    await page.getByRole('button', { name: `Xóa ${name} sửa` }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Xóa', exact: true })
      .click();
    await expect(page.getByRole('button', { name: code })).toHaveCount(0);

    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/companies');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
  });

  test('admin không thấy menu Công ty và không có CRUD listener', async ({ page }) => {
    test.skip(!adminPassword, 'E2E_ADMIN_PASSWORD is required');
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'admin', adminPassword);
    await expect(page.getByRole('link', { name: 'Công ty' })).toHaveCount(0);
    await page.goto('/caster');
    await expect(page.getByRole('heading', { name: 'Caster' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm listener' })).toHaveCount(0);
  });
});
