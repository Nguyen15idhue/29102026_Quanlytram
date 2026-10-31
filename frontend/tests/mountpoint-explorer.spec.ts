import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P0 Phase 2 mountpoint explorer', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('search, detail chain, filters, responsive', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('link', { name: 'Mountpoint Explorer' }).click();
    await expect(page.getByRole('heading', { name: 'Mountpoint Explorer' })).toBeVisible();
    await page.getByPlaceholder('Tìm mountpoint hoặc trạm').fill('THA');
    await expect(page.getByRole('row', { name: /THA_HauLoc/ }).first()).toBeVisible();

    await page.getByRole('row', { name: /THA_HauLoc/ }).first().click();
    await expect(page.getByText('Relay lấy mountpoint')).toBeVisible();
    await expect(page.getByText('import THA_HauLoc').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mở trạm' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mở relay' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('password_hash');
    await page.screenshot({
      path: 'test-results/mountpoint-explorer-detail-light.png',
      fullPage: true
    });

    await page.getByRole('button', { name: 'Mở relay' }).click();
    await expect(page).toHaveURL(/\/relay-jobs\?job=\d+/);
    await expect(page.getByRole('heading', { name: 'import THA_HauLoc' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Mountpoint Explorer' })).toBeVisible();
    await page.getByRole('row', { name: /THA_HauLoc/ }).first().click();
    await page.getByRole('button', { name: 'Đóng' }).last().click();
    await page.getByLabel('Lọc trạng thái').selectOption('online');
    await expect(page).toHaveURL(/state=online/);
    await expect(page.getByRole('row', { name: /THA_HauLoc/ }).first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mountpoints/explorer?q=THA');
    await expect(page.getByRole('row', { name: /THA_HauLoc/ }).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);

    expect(errors).toEqual([]);
  });
});
