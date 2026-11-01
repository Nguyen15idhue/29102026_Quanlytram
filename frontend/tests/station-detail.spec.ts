import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('Phase 1 station detail', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('deep link tabs, status, timeline and history', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const list = await (
      await page.request.get(
        `/api/stations?page=1&pageSize=1&q=${encodeURIComponent('Trạm test Hà Nội 01')}`
      )
    ).json();
    const station = list.items?.[0];
    expect(station).toBeTruthy();

    await page.goto(`/stations/${station.id}?tab=data`);
    await expect(page.getByText(station.name).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Dữ liệu' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const timeline = page.locator('.entity-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText('online');
    await expect(timeline).toContainText('offline');
    await expect(timeline).toContainText('không có dữ liệu');
    await expect(timeline).toContainText('Tỷ lệ online');
    await expect(timeline).toContainText('Không có dữ liệu');
    await expect(page).toHaveURL(/tab=data/);
    await page.screenshot({
      path: 'test-results/station-data-light.png',
      fullPage: true
    });

    await page.getByRole('tab', { name: 'Chất lượng' }).click();
    await expect(page.getByRole('heading', { name: 'Chất lượng RTCM' })).toBeVisible();
    await expect(
      page
        .getByText('Chưa có dữ liệu chất lượng trạm')
        .or(page.getByRole('heading', { name: 'Sky plot' }))
        .first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/tab=quality/);

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.locator('.timeline, .table-state').first()).toBeVisible();
    await expect(page).toHaveURL(/tab=history/);

    await page.getByRole('tab', { name: 'Tổng quan' }).click();
    await expect(page.locator('.entity-status')).toContainText('Hiện tại');
    await expect(page.locator('.entity-status')).toContainText('Trạng thái');
    await expect(page.getByText('ID trạm')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/stations/${station.id}$`));

    await page.goto(`/stations?page=1&pageSize=10&q=${encodeURIComponent(station.name)}`);
    await page
      .getByRole('row')
      .filter({ hasText: station.name })
      .first()
      .locator('.link-btn')
      .click();
    await expect(page).toHaveURL(new RegExp(`/stations/${station.id}`));
    await page.reload();
    await expect(page.getByText(station.name).first()).toBeVisible();
    await page.getByRole('button', { name: 'Đóng', exact: true }).last().click();
    await expect(page).toHaveURL(/\/stations\?/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/stations/${station.id}?tab=overview`);
    await expect(page.getByText(station.name).first()).toBeVisible();
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
