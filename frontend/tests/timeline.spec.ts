import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const reasonLabels: Record<string, string> = {
  system_down: 'hệ thống dừng',
  source_network: 'mất kết nối nguồn',
  source_silent: 'nguồn không có dữ liệu',
  source_auth: 'sai xác thực',
  disabled: 'đã tắt/khoá'
};

test.describe('P09 timeline trạng thái', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('4 khung, none hiển thị và reason offline', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const list = await (
      await page.request.get('/api/stations?page=1&pageSize=50')
    ).json();
    const station =
      list.items?.find((item: { name: string }) => item.name === 'TestHauLoc') ??
      list.items?.[0];
    expect(station).toBeTruthy();

    await page.goto(`/stations/${station.id}?tab=data`);
    const timeline = page.locator('.entity-timeline');
    await expect(timeline).toBeVisible({ timeout: 15_000 });

    for (const label of ['1 giờ', '24 giờ', '7 ngày', '30 ngày']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(timeline).toBeVisible();
      await expect(timeline).toContainText('Tỷ lệ online');
    }

    await page.getByRole('button', { name: '30 ngày', exact: true }).click();
    await expect(timeline).toContainText('trước khi tạo');
    const noneSegment = page.locator('.timeline-segment.none').first();
    await expect(noneSegment).toHaveCount(1);
    const noneBackground = await noneSegment.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    );
    expect(noneBackground).not.toBe('rgba(0, 0, 0, 0)');
    await expect(timeline).toContainText('độ phân giải');

    const api = await (
      await page.request.get(`/api/stations/${station.id}/timeline?range=24h`)
    ).json();
    const reasons = new Set<string>(
      (api.segments ?? [])
        .filter((segment: { status?: string; reason?: string }) => segment.status === 'offline')
        .map((segment: { reason?: string }) => segment.reason)
        .filter((value: string | undefined): value is string => Boolean(value))
    );
    if (reasons.size > 0) {
      const text = await timeline.innerText();
      const visible = [...reasons]
        .map((reason) => reasonLabels[reason])
        .filter(Boolean)
        .some((label) => text.includes(label));
      expect(visible).toBeTruthy();
    }

    await page.screenshot({
      path: 'test-results/p09-timeline-1440.png',
      fullPage: true
    });
    expect(errors).toEqual([]);
  });

  for (const viewport of [
    { width: 768, height: 900, name: '768' },
    { width: 390, height: 844, name: '390' }
  ]) {
    test(`timeline hiển thị ở ${viewport.name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto('/login');
      await page.getByLabel('Tên đăng nhập').fill('superadmin');
      await page.getByLabel('Mật khẩu').fill(password);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

      const list = await (
        await page.request.get('/api/stations?page=1&pageSize=50')
      ).json();
      const station =
        list.items?.find((item: { name: string }) => item.name === 'TestHauLoc') ??
        list.items?.[0];
      expect(station).toBeTruthy();

      await page.goto(`/stations/${station.id}?tab=data`);
      await expect(page.locator('.entity-timeline')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: '30 ngày', exact: true }).click();
      await expect(page.locator('.entity-timeline')).toContainText('trước khi tạo');

      await page.screenshot({
        path: `test-results/p09-timeline-${viewport.name}.png`,
        fullPage: true
      });
      expect(errors).toEqual([]);
    });
  }
});
