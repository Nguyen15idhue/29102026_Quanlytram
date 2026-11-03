import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const changedPassword = `E2e_${Date.now()}!`;

test.describe('Tài khoản: đổi mật khẩu', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('đổi mật khẩu, đăng nhập lại bằng mật khẩu mới rồi khôi phục', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    async function login(candidate: string) {
      await page.goto('/login');
      await page.getByLabel('Tên đăng nhập').fill('superadmin');
      await page.getByLabel('Mật khẩu', { exact: true }).fill(candidate);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    }

    async function logout() {
      await page.getByRole('button', { name: 'Đăng xuất' }).click();
      await expect(page).toHaveURL(/\/login/);
    }

    async function changePassword(current: string, next: string): Promise<boolean> {
      await page.goto('/profile');
      await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill(current);
      await page.getByLabel('Mật khẩu mới', { exact: true }).fill(next);
      await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(next);
      const [response] = await Promise.all([
        page.waitForResponse(
          (item) => item.url().includes('/api/profile/password') && item.request().method() === 'POST'
        ),
        page.getByRole('button', { name: 'Đổi mật khẩu' }).click()
      ]);
      if (response.ok()) {
        await expect(page.getByText('Đã đổi mật khẩu').first()).toBeVisible();
        return true;
      }
      const body = await response.text();
      throw new Error(`Đổi mật khẩu thất bại: HTTP ${response.status()} ${body}`);
    }

    await login(password);

    // Chỉ khôi phục khi server đã thực sự đổi mật khẩu, tránh ghi đè sai.
    let changed = false;
    try {
      changed = await changePassword(password, changedPassword);

      await logout();
      await login(changedPassword);
    } finally {
      if (changed) {
        try {
          if (page.url().includes('/login')) await login(changedPassword);
          await changePassword(changedPassword, password);
          await logout();
          await login(password);
        } catch (error) {
          console.error(
            'KHÔI PHỤC MẬT KHẨU THẤT BẠI: đặt lại SEED_SUPERADMIN_PASSWORD trong .env.local rồi chạy `node scripts/seed-docs-fixtures.mjs --apply`.'
          );
          throw error;
        }
      }
    }

    expect(errors).toEqual([]);
  });
});
