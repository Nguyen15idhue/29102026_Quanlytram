import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('Realtime entity invalidation', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('station list updates when another actor toggles station', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const me = await (await page.request.get('/api/auth/me')).json();
    // Fixture do scripts/seed-docs-fixtures.mjs tạo; tránh tên cũ đã bị xoá khỏi DB.
    const stationName = 'DOCS-Trạm Hà Nội';
    const stations = await (
      await page.request.get(
        `/api/stations?page=1&pageSize=30&q=${encodeURIComponent(stationName)}`
      )
    ).json();
    const station = stations.items.find(
      (item: { name: string }) => item.name === stationName
    );
    expect(station, `Thiếu fixture "${stationName}", chạy scripts/seed-docs-fixtures.mjs --apply`).toBeTruthy();

    const headers = { 'X-CSRF-Token': me.csrfToken };
    const wasEnabled = Boolean(station.enabled);
    try {
      await page.request.post(`/api/stations/${station.id}/disable`, { headers });
      await page.goto('/stations');
      const row = page.getByRole('row', { name: new RegExp(station.name) }).first();
      await expect(row).toBeVisible();
      await expect(row.getByRole('button', { name: `Bật ${station.name}` })).toBeVisible();

      await page.request.post(`/api/stations/${station.id}/enable`, { headers });
      await expect(row.getByRole('button', { name: `Tắt ${station.name}` })).toBeVisible({
        timeout: 2500
      });
    } finally {
      if (!wasEnabled) {
        await page.request.post(`/api/stations/${station.id}/disable`, { headers });
      }
    }
    expect(errors).toEqual([]);
  });
});
