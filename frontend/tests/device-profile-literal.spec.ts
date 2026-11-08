import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P19 device profile literal', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('literal gửi đúng chuỗi nhập, không ghép tên thiết bị', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    await page.getByRole('link', { name: 'Relay' }).click();
    await page.getByRole('button', { name: /Thêm relay job/ }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByTestId('relay-ua-mode').selectOption('literal');
    await dialog.getByTestId('relay-ua-prefix').fill('NTRIP Demo/1.0');
    await expect(dialog.getByTestId('relay-ua-preview')).toHaveText('NTRIP Demo/1.0');

    await dialog.getByTestId('relay-ua-mode').selectOption('profile');
    await expect(dialog.getByTestId('relay-ua-preview')).not.toHaveText('NTRIP Demo/1.0');
  });
});
