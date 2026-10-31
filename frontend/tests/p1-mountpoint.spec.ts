import { expect, request as api, test, type APIRequestContext } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

async function login(context: APIRequestContext) {
  const response = await context.post('/api/auth/login', {
    data: { username: 'superadmin', password }
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('P1.6 mountpoint và listener', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('API tối giản, listener tạo kèm mountpoint, impact xóa', async () => {
    const context = await api.newContext({ baseURL });
    const suffix = Date.now();
    let mountpointId: number | null = null;
    let listenerId: number | null = null;
    try {
      const auth = await login(context);
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      const name = `E2E_MP_${suffix}`;
      const mountpoint = await context.post('/api/mountpoints', {
        headers,
        data: { name, enabled: true, description: 'P1.6 test' }
      });
      expect(mountpoint.status()).toBe(201);
      const mp = (await mountpoint.json()).item;
      mountpointId = mp.id;
      expect(mp).not.toHaveProperty('auth_mode');
      expect(mp).not.toHaveProperty('service_type');
      expect(mp).not.toHaveProperty('has_password');

      const listener = await context.post('/api/caster/listeners', {
        headers,
        data: {
          name: `E2E Listener ${suffix}`,
          port: 16000 + (suffix % 1000),
          enabled: false,
          mountpointIds: [mp.id]
        }
      });
      expect(listener.status()).toBe(201);
      listenerId = (await listener.json()).item.id;

      const impact = await (
        await context.get(`/api/mountpoints/${mp.id}/impact`)
      ).json();
      expect(impact.listeners).toHaveLength(1);
      expect(impact.listeners[0].id).toBe(listenerId);

      const patch = await context.patch(`/api/caster/listeners/${listenerId}`, {
        headers,
        data: { name: `E2E Listener renamed ${suffix}` }
      });
      expect(patch.status()).toBe(200);
      const impactAfter = await (
        await context.get(`/api/mountpoints/${mp.id}/impact`)
      ).json();
      expect(impactAfter.listeners).toHaveLength(1);
    } finally {
      if (listenerId !== null) {
        const me = await context.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await context.delete(`/api/caster/listeners/${listenerId}`, {
          headers: { 'X-CSRF-Token': csrf }
        });
      }
      if (mountpointId !== null) {
        const me = await context.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await context.delete(`/api/mountpoints/${mountpointId}`, {
          headers: { 'X-CSRF-Token': csrf }
        });
      }
      await context.dispose();
    }
  });

  test('UI bảng 4 thông tin, không Explorer, mở drawer', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/mountpoints');
    await expect(page.locator('a[href="/mountpoints/explorer"]')).toHaveCount(0);
    const headers = await page.locator('.data-table thead th').allTextContents();
    expect(headers).toContain('Tên');
    expect(headers).toContain('Trạm');
    expect(headers).toContain('Trạng thái');
    expect(headers).toContain('Ghi chú');
    expect(headers).not.toContain('Auth');

    await page.locator('.data-table tbody tr').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Online');
  });
});
