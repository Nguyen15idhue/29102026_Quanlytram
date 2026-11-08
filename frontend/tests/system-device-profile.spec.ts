import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? '';

async function login(page: import('@playwright/test').Page, username: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(secret);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P19 device profile trong Hệ thống', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('super admin đổi profile probe và khôi phục cấu hình cũ', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', password);
    await page.goto('/system?tab=device');

    await expect(page.getByRole('heading', { name: 'Device profile ngụy trang' })).toBeVisible();
    const probe = page.getByTestId('system-device-probe');
    await expect(probe).toBeVisible();
    const original = await probe.inputValue();

    await probe.selectOption('trimble_da2');
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/system/device-profile') && response.request().method() === 'PUT'
    );
    await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText('Đã lưu device profile mặc định')).toBeVisible();

    await probe.selectOption(original);
    const restored = page.waitForResponse(
      (response) =>
        response.url().includes('/api/system/device-profile') && response.request().method() === 'PUT'
    );
    await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
    expect((await restored).status()).toBe(200);

    await page.screenshot({ path: 'test-results/system-device-profile-light.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Device profile ngụy trang' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: 'test-results/system-device-profile-mobile.png', fullPage: true });
  });

  test('user chỉ xem device profile, không sửa cấu hình hệ thống', async ({ page }) => {
    test.skip(!userPassword, 'E2E_USER_PASSWORD is required');
    await login(page, 'docs.user', userPassword);

    const list = await page.request.get('/api/device-profiles');
    expect(list.status()).toBe(200);

    const update = await page.request.put('/api/system/device-profile', {
      data: { defaultCode: 'gnss_internet_radio', probeCode: 'gnss_internet_radio' }
    });
    expect(update.status()).toBe(403);
  });
});
