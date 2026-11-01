import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P0 Phase 6 menu and deep links', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('seven groups, titles, active menu, deep link, Esc/focus and responsive', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await expect(page.locator('.nav-group')).toHaveCount(7);
    const groups = await page.locator('.nav-group-label').allTextContents();
    expect(groups).toEqual([
      'Tổng quan',
      'Trạm',
      'Bản đồ',
      'CORS',
      'Tài khoản',
      'Relay',
      'Hệ thống'
    ]);

    const stationList = await (await page.request.get('/api/stations?pageSize=1')).json();
    const station = stationList.items?.[0];
    if (!station) test.skip(true, 'Cần ít nhất một trạm để kiểm tra điều hướng');

    await page.goto(`/stations/${station.id}?tab=overview`);
    await expect(page.locator('.topbar-left strong')).toHaveText('Chi tiết trạm');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.getByText(station.name).first()).toBeVisible();    await expect(page.locator('a[href="/stations"]')).toHaveClass(/active/);
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
    ).toBe(true);
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/stations$/);

    await page.goto(`/map?station=${station.id}`);
    await expect(page.locator('.topbar-left strong')).toHaveText('Bản đồ vận hành');
    await expect(page.locator('.map-detail')).toContainText(station.name);
    await expect(page.locator('a[href="/map"]')).toHaveClass(/active/);

    await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/open/);
    await page.getByRole('link', { name: 'Danh sách trạm' }).click();
    await expect(page).toHaveURL(/\/stations/);
    await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(mobileOverflow).toBe(false);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/map?station=${station.id}`);
    await expect(page.locator('.map-detail')).toContainText(station.name);
    const tabletOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(tabletOverflow).toBe(false);

    expect(errors).toEqual([]);
  });
});
