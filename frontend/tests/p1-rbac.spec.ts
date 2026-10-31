import { expect, request as api, test, type APIRequestContext } from '@playwright/test';

const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

async function login(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function loginApi(context: APIRequestContext, username: string, password: string) {
  const response = await context.post('/api/auth/login', { data: { username, password } });
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('P1.2 RBAC tenant và menu', () => {
  test.skip(!adminPassword, 'E2E_ADMIN_PASSWORD is required');

  test('admin không xem sức khỏe, phân quyền chỉ đọc', async ({ page }) => {
    await login(page, 'admin', adminPassword);
    await expect(page.locator('a[href="/system/health"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Phân quyền' })).toBeVisible();

    await page.goto('/roles');
    await expect(page.getByRole('heading', { name: /Vai trò/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lưu quyền' })).toHaveCount(0);

    const response = await page.request.get('/api/system/health');
    expect(response.status()).toBe(403);

    const me = await (await page.request.get('/api/auth/me')).json();
    const createRole = await page.request.post('/api/roles', {
      headers: { 'X-CSRF-Token': me.csrfToken },
      data: { code: 'e2e_denied_role', name: 'E2E Denied', level: 20 }
    });
    expect(createRole.status()).toBe(403);
  });

  test('user xem trạm toàn công ty nhưng không sửa', async ({ page }) => {
    test.skip(!userPassword, 'E2E_USER_PASSWORD is required');
    await login(page, 'user1', userPassword);
    await expect(page.getByRole('link', { name: 'Danh sách trạm' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Relay jobs' })).toBeVisible();
    await expect(page.locator('a[href="/caster"]')).toHaveCount(0);
    await expect(page.locator('a[href="/system/health"]')).toHaveCount(0);
    await expect(page.locator('a[href="/web-users"]')).toHaveCount(0);

    await page.goto('/stations');
    await expect(page.getByRole('heading', { name: /Danh sách trạm/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm trạm' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Xóa / })).toHaveCount(0);

    const me = await (await page.request.get('/api/auth/me')).json();
    const headers = { 'X-CSRF-Token': me.csrfToken };
    const stations = await (
      await page.request.get('/api/stations?page=1&pageSize=20')
    ).json();
    expect(stations.total).toBeGreaterThan(0);
    const stationId = stations.items[0].id;

    const createStation = await page.request.post('/api/stations', {
      headers,
      data: { code: `E2E_DENY_${Date.now()}`, name: 'Không được tạo', host: '' }
    });
    expect(createStation.status()).toBe(403);

    const deleteStation = await page.request.delete(`/api/stations/${stationId}`, { headers });
    expect(deleteStation.status()).toBe(403);

    const jobs = await (
      await page.request.get('/api/relay-jobs?page=1&pageSize=20')
    ).json();
    if (jobs.items.length > 0) {
      const editJob = await page.request.patch(`/api/relay-jobs/${jobs.items[0].id}`, {
        headers,
        data: { name: 'Không được sửa' }
      });
      expect(editJob.status()).toBe(403);
    }
  });

  test('công ty A không thấy trạm công ty B', async () => {
    test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD is required');
    const suffix = Date.now();
    const superCtx = await api.newContext({ baseURL });
    const adminBCtx = await api.newContext({ baseURL });
    const adminACtx = await api.newContext({ baseURL });
    let adminBId: number | null = null;
    let stationId: number | null = null;
    try {
      const superAuth = await loginApi(
        superCtx,
        'superadmin',
        process.env.E2E_PASSWORD ?? ''
      );
      const roles = await (await superCtx.get('/api/roles')).json();
      const adminRole = roles.items.find((role: { code: string }) => role.code === 'admin');

      const adminBUsername = `e2e_admin_b_${suffix}`;
      const adminBPassword = 'TenantB!2026';
      const createUser = await superCtx.post('/api/web-users', {
        headers: { 'X-CSRF-Token': superAuth.csrfToken },
        data: {
          username: adminBUsername,
          password: adminBPassword,
          display_name: 'E2E Admin B',
          role_id: adminRole.id,
          parent_user_id: superAuth.user.id
        }
      });
      expect(createUser.status()).toBe(201);
      adminBId = (await createUser.json()).item.id;

      const adminBAuth = await loginApi(adminBCtx, adminBUsername, adminBPassword);
      const stationCode = `E2E_TB_${suffix}`;
      const createStation = await adminBCtx.post('/api/stations', {
        headers: { 'X-CSRF-Token': adminBAuth.csrfToken },
        data: { code: stationCode, name: 'Trạm công ty B', host: '' }
      });
      expect(createStation.status()).toBe(201);
      stationId = (await createStation.json()).item.id;

      await loginApi(adminACtx, 'admin', adminPassword);
      const aList = await (
        await adminACtx.get(`/api/stations?page=1&pageSize=20&q=${stationCode}`)
      ).json();
      expect(aList.total).toBe(0);

      const bList = await (
        await adminBCtx.get(`/api/stations?page=1&pageSize=20&q=${stationCode}`)
      ).json();
      expect(bList.total).toBe(1);
    } finally {
      if (stationId !== null && adminBId !== null) {
        const adminBList = await adminBCtx.get('/api/web-users?page=1&pageSize=20');
        if (adminBList.ok()) {
          const me = await adminBCtx.get('/api/auth/me');
          const csrf = me.ok() ? (await me.json()).csrfToken : '';
          await adminBCtx.delete(`/api/stations/${stationId}`, {
            headers: { 'X-CSRF-Token': csrf }
          });
        }
      }
      if (adminBId !== null) {
        const me = await superCtx.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await superCtx.delete(`/api/web-users/${adminBId}`, {
          headers: { 'X-CSRF-Token': csrf }
        });
      }
      await superCtx.dispose();
      await adminBCtx.dispose();
      await adminACtx.dispose();
    }
  });
});
