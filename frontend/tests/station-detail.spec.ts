import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('Phase 1 station detail', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('deep link tabs, separate statuses, connections, metadata and history', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations/80?tab=connection');
    await expect(page.getByText('THA Hậu Lộc').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Kết nối' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByText('Mountpoint & relay')).toBeVisible();
    await expect(page.getByText('import THA_HauLoc').first()).toBeVisible();
    await page.screenshot({
      path: 'test-results/station-detail-connections-light.png',
      fullPage: true
    });

    await page.getByRole('tab', { name: 'Hoạt động' }).click();
    const activity = page.locator('.activity-panel');
    await expect(activity).toBeVisible();
    await expect(activity).toContainText('Sự kiện');
    await expect(activity).toContainText('Kết nối');
    await expect(activity).toContainText('Uptime');
    await expect(page).toHaveURL(/tab=activity/);
    await page.screenshot({
      path: 'test-results/station-activity-light.png',
      fullPage: true
    });

    await page.getByRole('tab', { name: 'Metadata' }).click();
    await expect(page.getByText('1005 Station ID')).toBeVisible();
    await expect(page.getByText('Message type')).toBeVisible();
    await expect(page).toHaveURL(/tab=metadata/);

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.locator('.timeline')).toBeVisible();
    await expect(page.locator('.source-summary')).toContainText('quality');
    await expect(page).toHaveURL(/tab=history/);

    await page.getByRole('tab', { name: 'Tổng quan' }).click();
    const statusGrid = page.locator('.detail-status-grid').last();
    await expect(statusGrid).toContainText('Transport');
    await expect(statusGrid).toContainText('Quality');
    await expect(statusGrid).toContainText('Metadata');
    await expect(page).toHaveURL(/\/stations\/80$/);

    await page.goto('/stations?page=1&pageSize=10&q=THA');
    await page
      .getByRole('row', { name: /THA Hậu Lộc/ })
      .first()
      .locator('.link-btn')
      .click();
    await expect(page).toHaveURL(/\/stations\/80/);
    await page.reload();
    await expect(page.getByText('THA Hậu Lộc').first()).toBeVisible();
    await expect(page).toHaveURL(/q=THA/);
    await page.getByRole('button', { name: 'Đóng', exact: true }).last().click();
    await expect(page).toHaveURL(/\/stations\?/);
    await expect(page).toHaveURL(/q=THA/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/stations/80?tab=overview');
    await expect(page.getByText('THA Hậu Lộc').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: 'test-results/station-detail-mobile.png',
      fullPage: true
    });

    expect(errors).toEqual([]);
  });
});
