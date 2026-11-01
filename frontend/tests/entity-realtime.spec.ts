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
    const stations = await (
      await page.request.get(
        '/api/stations?page=1&pageSize=30&q=E2E%20Caster%20Ingest'
      )
    ).json();
    const station = stations.items[0];
    expect(station).toBeTruthy();

    const headers = { 'X-CSRF-Token': me.csrfToken };
    await page.request.post(`/api/stations/${station.id}/disable`, { headers });
    await page.goto('/stations');
    const row = page.getByRole('row', { name: new RegExp(station.name) }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Đã tắt')).toBeVisible();

    await page.request.post(`/api/stations/${station.id}/enable`, { headers });
    await expect(row.getByText('Đã tắt')).toHaveCount(0, { timeout: 2500 });

    await page.request.post(`/api/stations/${station.id}/disable`, { headers });
    await expect(row.getByText('Đã tắt')).toBeVisible({ timeout: 2500 });
    expect(errors).toEqual([]);
  });
});
