import { expect, test, type Page } from '@playwright/test';

const superPassword = process.env.E2E_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? '';

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P06-3 super admin map config', () => {
  test.skip(!superPassword, 'E2E_PASSWORD is required');

  test('super admin edits and tests config, no secret exposed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);
    await page.getByRole('link', { name: 'Cấu hình bản đồ' }).click();
    await expect(page).toHaveURL(/\/system\/map-config/);
    await expect(page.getByRole('heading', { name: 'Cấu hình bản đồ' })).toBeVisible();

    const zoomInput = page.getByLabel('Zoom mặc định');
    await expect(zoomInput).toBeVisible();
    await zoomInput.fill('7');
    await page.getByRole('button', { name: /Lưu cấu hình/ }).click();
    await expect(page.getByText('Đã lưu cấu hình bản đồ')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Zoom mặc định')).toHaveValue('7');

    await page.getByLabel('Zoom mặc định').fill('6');
    await page.getByRole('button', { name: /Lưu cấu hình/ }).click();
    await expect(page.getByText('Đã lưu cấu hình bản đồ')).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).not.toContain('apikey');
    expect(bodyText.toLowerCase()).not.toContain('secret=');
  });

  test('user does not see map config menu or page actions', async ({ page }) => {
    test.skip(!userPassword, 'E2E_USER_PASSWORD is required');
    await login(page, 'user1', userPassword);
    await expect(page.getByRole('link', { name: 'Cấu hình bản đồ' })).toHaveCount(0);
    await page.goto('/system/map-config');
    await expect(page.getByText('Bạn không có quyền truy cập trang này.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Lưu cấu hình/ })).toHaveCount(0);
  });
});
