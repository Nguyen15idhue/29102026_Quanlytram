import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('Phase 6 quality', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('quality is embedded in station detail, edit stays separate, responsive dark mode', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav.getByRole('link', { name: 'Chất lượng' })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Danh sách trạm' }).click();
    await expect(page.getByRole('heading', { name: 'Danh sách trạm' })).toBeVisible();
    await page.getByPlaceholder('Tìm mã, tên, địa chỉ').fill('Trạm test Hà Nội 01');

    await page
      .getByRole('row', { name: /Trạm test Hà Nội 01/ })
      .first()
      .locator('.link-btn')
      .click();
    await expect(page.getByRole('tab', { name: 'Tổng quan' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.getByRole('tab', { name: 'Chất lượng' }).click();
    await expect(page.getByRole('heading', { name: 'Chất lượng RTCM' })).toBeVisible();
    await expect(
      page
        .getByText('Chưa có dữ liệu chất lượng trạm')
        .or(page.getByText('Điểm chất lượng'))
        .first()
    ).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: 'test-results/quality-station-detail-light.png',
      fullPage: true
    });

    await page.getByRole('button', { name: 'Sửa', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sửa trạm' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chất lượng RTCM' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();

    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/stations');
    await page.getByPlaceholder('Tìm mã, tên, địa chỉ').fill('Trạm test Hà Nội 01');
    await page
      .getByRole('row', { name: /Trạm test Hà Nội 01/ })
      .first()
      .locator('.link-btn')
      .click();
    await page.getByRole('tab', { name: 'Chất lượng' }).click();
    await expect(page.getByRole('heading', { name: 'Chất lượng RTCM' })).toBeVisible();
    await page.screenshot({
      path: 'test-results/quality-station-detail-mobile-dark.png',
      fullPage: true
    });

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/stations');
    await page.getByPlaceholder('Tìm mã, tên, địa chỉ').fill('Trạm test Hà Nội 01');
    await page
      .getByRole('row', { name: /Trạm test Hà Nội 01/ })
      .first()
      .locator('.link-btn')
      .click();
    await page.getByRole('tab', { name: 'Chất lượng' }).click();
    await expect(page.getByRole('heading', { name: 'Chất lượng RTCM' })).toBeVisible();
    await page.screenshot({
      path: 'test-results/quality-station-detail-tablet-dark.png',
      fullPage: true
    });

    expect(errors).toEqual([]);
  });
});
