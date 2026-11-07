import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P18-5 không prefill port', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('form relay thủ công port trống và bắt buộc', async ({ page }) => {
    await login(page);
    await page.goto('/relay-jobs');
    await page.getByRole('button', { name: 'Thêm relay job' }).click();
    const source = page.locator('.relay-form-section').nth(0);
    await expect(source.getByLabel('Nguồn port')).toHaveValue('');
    await expect(source.getByLabel('Nguồn port')).toHaveAttribute('placeholder', /Nhập port/);
    // Submit thiếu port phải báo lỗi client, không tạo job.
    await source.getByLabel('Nguồn host').fill('example.invalid');
    await source.getByLabel('Nguồn mount').fill('NO-PORT');
    await page.locator('.relay-form-section').nth(2).getByLabel('Tên').fill(`P185-${Date.now()}`);
    const dest = page.locator('.relay-form-section').nth(1);
    await dest.getByLabel('Đích host').fill('example.invalid');
    await dest.getByLabel('Đích mount').fill('NO-PORT-DOWN');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    // Thiếu port: form không được submit thành công (dialog vẫn mở).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(source.getByLabel('Nguồn port')).toHaveValue('');
  });

  test('form caster tạo mới port trống', async ({ page }) => {
    await login(page);
    await page.goto('/caster');
    await page.getByRole('button', { name: 'Thêm listener' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('input[type="number"]')).toHaveValue('');
    await expect(dialog.locator('input[type="number"]')).toHaveAttribute('placeholder', /Nhập port/);
    await dialog.getByRole('button', { name: 'Hủy' }).click();
  });

  test('form trạm client port trống khi chọn ntrip_client', async ({ page }) => {
    await login(page);
    await page.goto('/stations');
    const add = page.getByRole('button', { name: /Thêm trạm/ });
    if (await add.count()) {
      await add.first().click();
      const dialog = page.getByRole('dialog');
      const role = dialog.getByLabel('Vai trò nguồn');
      if (await role.count()) {
        await role.selectOption('ntrip_client');
        await expect(dialog.getByLabel('Client port')).toHaveValue('');
      }
      await dialog.getByRole('button', { name: 'Hủy' }).click().catch(() => {});
    }
  });
});
