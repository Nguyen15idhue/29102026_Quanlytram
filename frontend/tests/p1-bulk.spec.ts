import { expect, request as api, test, type APIRequestContext } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

async function loginApi(context: APIRequestContext, username: string, secret: string) {
  const response = await context.post('/api/auth/login', { data: { username, password: secret } });
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('P1.3 bulk action và shared table', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('chọn trang, bulk bar, reset khi đổi trang, mobile không tràn', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations');
    await page.getByRole('checkbox', { name: 'Chọn tất cả dòng trên trang hiện tại' }).check();
    const bar = page.getByRole('region', { name: 'Hành động hàng loạt' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(/Đã chọn \d+/);
    await bar.getByRole('button', { name: 'Bỏ chọn' }).click();
    await expect(bar).toHaveCount(0);

    await page.getByRole('checkbox', { name: /^Chọn trạm / }).first().check();
    await expect(bar).toBeVisible();
    await page.goto('/stations?page=2');
    await expect(bar).toHaveCount(0);

    await page.goto('/ntrip-accounts');
    await page.locator('table tbody tr').first().click();
    const aclSearch = page.getByRole('textbox', { name: 'Mountpoint được phép tìm kiếm' });
    await expect(aclSearch).toBeVisible();
    await aclSearch.focus();
    await aclSearch.fill('khong-co-mountpoint-nay');
    await expect(page.getByText('Không tìm thấy lựa chọn.')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/stations');
    await page.getByRole('checkbox', { name: 'Chọn tất cả dòng trên trang hiện tại' }).check();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
  });

  test('bulk API các module được nối route và validate action', async () => {
    const context = await api.newContext({ baseURL });
    try {
      const auth = await loginApi(context, 'superadmin', password);
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      for (const path of [
        '/api/stations/bulk',
        '/api/mountpoints/bulk',
        '/api/caster/listeners/bulk',
        '/api/ntrip-accounts/bulk',
        '/api/relay-jobs/bulk',
        '/api/web-users/bulk'
      ]) {
        const response = await context.post(path, {
          headers,
          data: { ids: [1], action: 'khong-hop-le' }
        });
        expect(response.status(), path).toBe(400);
      }
      const alertResponse = await context.post('/api/alerts/bulk-ack', {
        headers,
        data: { ids: [] }
      });
      expect(alertResponse.status()).toBe(400);
    } finally {
      await context.dispose();
    }
  });

  test('bulk API station, audit batch, cross-tenant bị chặn', async () => {
    const superCtx = await api.newContext({ baseURL });
    const adminCtx = await api.newContext({ baseURL });
    const ids: number[] = [];
    try {
      const auth = await loginApi(superCtx, 'superadmin', password);
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      for (let index = 1; index <= 2; index += 1) {
        const code = `E2E_BULK_${Date.now()}_${index}`;
        const response = await superCtx.post('/api/stations', {
          headers,
          data: { code, name: `Bulk ${index}`, host: '' }
        });
        expect(response.status()).toBe(201);
        ids.push((await response.json()).item.id);
      }

      const disabled = await superCtx.post('/api/stations/bulk', {
        headers,
        data: { ids, action: 'disable' }
      });
      expect(disabled.status()).toBe(200);
      expect((await disabled.json()).result.updated).toBe(2);

      const listed = await (
        await superCtx.get('/api/stations?page=1&pageSize=20&q=E2E_BULK_')
      ).json();
      for (const id of ids) {
        expect(
          Boolean(listed.items.find((item: { id: number }) => item.id === id).enabled)
        ).toBe(false);
      }

      await loginApi(adminCtx, 'admin', adminPassword);
      const adminMe = await (await adminCtx.get('/api/auth/me')).json();
      const denied = await adminCtx.post('/api/stations/bulk', {
        headers: { 'X-CSRF-Token': adminMe.csrfToken },
        data: { ids, action: 'delete' }
      });
      expect(denied.status()).toBe(200);
      expect((await denied.json()).result.forbidden).toBe(2);

      const audit = await (
        await superCtx.get('/api/audit-logs?pageSize=20&action=bulk_disable&entityType=station')
      ).json();
      expect(audit.items.some((item: { action: string }) => item.action === 'bulk_disable')).toBe(
        true
      );

      const invalid = await superCtx.post('/api/stations/bulk', {
        headers,
        data: { ids, action: 'khong-hop-le' }
      });
      expect(invalid.status()).toBe(400);
    } finally {
      if (ids.length > 0) {
        const me = await superCtx.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await superCtx.post('/api/stations/bulk', {
          headers: { 'X-CSRF-Token': csrf },
          data: { ids, action: 'delete' }
        });
      }
      await superCtx.dispose();
      await adminCtx.dispose();
    }
  });
});
