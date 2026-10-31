import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const suffix = Date.now().toString().slice(-7);

test.describe('Phase 3.5 UI', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('login, dark mode, paginated tables, modal CRUD', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await expect(page.getByText('Quản lý trạm CORS')).toBeVisible();
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/dashboard-dark.png', fullPage: true });
    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: 'test-results/dashboard-light.png', fullPage: true });

    await page.getByRole('link', { name: 'Danh sách trạm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Danh sách trạm', exact: true })).toBeVisible();
    await expect(page.getByText(/\d+–\d+ \/ \d+/)).toBeVisible();
    await page.screenshot({ path: 'test-results/stations-light.png', fullPage: true });

    await page.getByRole('button', { name: 'Thêm trạm' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Mã trạm').fill(`UI${suffix}`);
    await dialog.getByLabel('Tên trạm').fill(`UI test ${suffix}`);
    await dialog.getByLabel('Host').fill('127.0.0.1');
    await expect(dialog.getByLabel('Port')).toHaveValue('1509');
    await dialog.getByLabel('Port').fill('1509');
    await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByText(`UI test ${suffix}`).first()).toBeVisible();

    await page.getByRole('button', { name: `Sửa UI${suffix}` }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Hủy' }).click();

    await page.getByRole('button', { name: `Xóa UI${suffix}` }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Xóa' }).click();
    await expect(page.getByText(`UI test ${suffix}`)).toHaveCount(0);

    for (const route of ['/mountpoints', '/relay-jobs', '/caster', '/ntrip-accounts', '/web-users', '/roles']) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      await page.screenshot({
        path: `test-results/${route.replace('/', '')}-light.png`,
        fullPage: true
      });
    }

    await page.goto('/stations');
    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/stations-dark.png', fullPage: true });

    expect(errors).toEqual([]);
  });
});

test.describe('Phase 3.5 mobile', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('mobile drawer and dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });

    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/mobile-drawer.png', fullPage: true });
    await page.getByRole('link', { name: 'Danh sách trạm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Danh sách trạm', exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/stations-mobile.png', fullPage: true });
  });
});
