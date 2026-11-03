import { expect, test, type Page } from '@playwright/test';

const superPassword = process.env.E2E_PASSWORD ?? '';
const wallyPassword = process.env.E2E_WALLY_PASSWORD ?? '12345678';
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('Dữ liệu chuyển từ hệ thống cũ', () => {
  test.skip(!superPassword, 'E2E_PASSWORD is required');
  // Chạy riêng sau khi DB ở trạng thái cuối (không có fixture DOCS/E2E).
  test.skip(process.env.E2E_LEGACY_ONLY !== '1', 'đặt E2E_LEGACY_ONLY=1 để chạy');

  test('superadmin và wally thấy 36 trạm/31 mountpoint/67 relay, không còn dữ liệu test', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/map/tiles/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG })
    );

    await login(page, 'superadmin', superPassword);
    const stations = (await (await page.request.get('/api/stations?page=1&pageSize=100')).json()) as {
      items: Array<{ name: string }>;
      total: number;
    };
    expect(stations.total).toBe(36);
    expect(stations.items.some((item) => /DOCS|E2E/i.test(item.name))).toBe(false);

    const mountpoints = (await (
      await page.request.get('/api/mountpoints?page=1&pageSize=100')
    ).json()) as { total: number };
    expect(mountpoints.total).toBe(31);

    const relays = (await (await page.request.get('/api/relay-jobs?page=1&pageSize=100')).json()) as {
      items: Array<{ enabled: boolean }>;
      total: number;
    };
    expect(relays.total).toBe(67);
    expect(relays.items.every((item) => item.enabled === false)).toBe(true);

    const accounts = (await (
      await page.request.get('/api/ntrip-accounts?page=1&pageSize=100')
    ).json()) as { total: number };
    expect(accounts.total).toBe(3);

    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.map-pin')).toHaveCount(36, { timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/stations');
    await expect(page.getByRole('heading', { name: 'Danh sách trạm' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, 'wally', wallyPassword);
    const wallyRelays = (await (
      await page.request.get('/api/relay-jobs?page=1&pageSize=100')
    ).json()) as { total: number };
    expect(wallyRelays.total).toBe(67);

    expect(errors).toEqual([]);
  });
});
