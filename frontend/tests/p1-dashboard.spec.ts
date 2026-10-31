import { expect, request as api, test, type APIRequestContext } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

async function login(context: APIRequestContext, username: string, secret: string) {
  const response = await context.post('/api/auth/login', { data: { username, password: secret } });
  expect(response.status()).toBe(200);
}

test.describe('P1.4 dashboard số liệu và layout', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('số liệu khớp API, giới hạn 5, RBAC user', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const dashboard = await (await page.request.get('/api/ops/dashboard?window=60')).json();
    const stations = await (await page.request.get('/api/stations?page=1&pageSize=1')).json();
    const accounts = await (
      await page.request.get('/api/ntrip-accounts?page=1&pageSize=1')
    ).json();
    const relays = await (await page.request.get('/api/relay-jobs?page=1&pageSize=1')).json();
    expect(dashboard.stations.total).toBe(stations.total);
    expect(dashboard.ntripAccounts.total).toBe(accounts.total);
    expect(dashboard.relays.total).toBe(relays.total);
    expect(dashboard.incidents.length).toBeLessThanOrEqual(5);
    expect(dashboard.recentAudit.length).toBeLessThanOrEqual(5);

    await expect(
      page.locator('.kpi-strip').getByText('Tài khoản NTRIP', { exact: true })
    ).toBeVisible();
    const columns = await page
      .locator('.dashboard-two-col')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);

    await page.setViewportSize({ width: 768, height: 1024 });
    const tabletColumns = await page
      .locator('.dashboard-two-col')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(tabletColumns).toBe(2);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileColumns = await page
      .locator('.dashboard-two-col')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(mobileColumns).toBe(1);
  });

  test('user nhận số liệu tenant', async () => {
    test.skip(!userPassword, 'E2E_USER_PASSWORD is required');
    const context = await api.newContext({ baseURL });
    try {
      await login(context, 'user1', userPassword);
      const dashboard = await (await context.get('/api/ops/dashboard?window=60')).json();
      const stations = await (await context.get('/api/stations?page=1&pageSize=1')).json();
      const relays = await (await context.get('/api/relay-jobs?page=1&pageSize=1')).json();
      expect(dashboard.stations.total).toBe(stations.total);
      expect(dashboard.relays.total).toBe(relays.total);
      expect(dashboard.health).toBeNull();
    } finally {
      await context.dispose();
    }
  });
});
