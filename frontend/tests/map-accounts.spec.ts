import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('lớp tài khoản trên bản đồ', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('khớp danh sách online và không có username rỗng', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const overview = await (await page.request.get('/api/map/overview')).json();
    const online = await (
      await page.request.get('/api/connections?page=1&pageSize=100')
    ).json();

    expect(Array.isArray(overview.accounts)).toBe(true);
    expect(overview.counts.accounts).toBe(online.total);
    for (const account of overview.accounts) {
      expect(String(account.username).trim()).not.toBe('');
      expect(account.stationId === null || Number.isInteger(account.stationId)).toBe(true);
      // hasCoords = có GGA rover hoặc gắn được trạm.
      const hasRover =
        account.roverLat !== null &&
        account.roverLon !== null &&
        Number.isFinite(Number(account.roverLat)) &&
        Number.isFinite(Number(account.roverLon));
      expect(account.hasCoords).toBe(hasRover || account.stationId !== null);
      expect(typeof account.roverStale).toBe('boolean');
    }
    expect(overview.counts.accountsOutsideStations).toBe(
      overview.accounts.filter((account: { stationId: number | null }) => account.stationId === null)
        .length
    );
  });
});
