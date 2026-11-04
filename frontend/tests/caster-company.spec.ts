import { expect, request as api, test, type APIRequestContext, type Page } from '@playwright/test';
import { pickCompanyId } from './support/company';

const password = process.env.E2E_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

async function loginApi(context: APIRequestContext) {
  const response = await context.post('/api/auth/login', {
    data: { username: 'superadmin', password }
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function loginPage(page: Page, username: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(secret);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P15 listener theo công ty', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('superadmin thấy tất cả port, filter công ty và form mặc định Wally', async ({ page }) => {
    await loginPage(page, 'superadmin', password);
    await page.goto('/caster');
    await expect(page.getByLabel('Lọc theo công ty')).toBeVisible();
    await expect(page.locator('tr', { hasText: 'NTRIP caster 2101' })).toBeVisible();
    await expect(page.locator('tr', { hasText: 'NTRIP caster 1599 (demo)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Công ty' })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm listener' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('select').first()).toBeVisible();
    await expect(dialog.locator('input[type="number"]')).toHaveValue('2101');
    await dialog.getByRole('button', { name: 'Hủy' }).click();
  });

  test('user chỉ thấy port của công ty, không có nút quản lý', async ({ page }) => {
    test.skip(!userPassword, 'E2E_USER_PASSWORD is required');
    await loginPage(page, 'user1', userPassword);
    await page.goto('/caster');
    await expect(page.locator('tr', { hasText: 'NTRIP caster 1599 (demo)' })).toBeVisible();
    await expect(page.locator('tr', { hasText: 'NTRIP caster 2101' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thêm listener' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Sửa / })).toHaveCount(0);
  });

  test('API từ chối port ngoài dải và cho tạo port 1510 cho công ty', async () => {
    const context = await api.newContext({ baseURL });
    let listenerId: number | null = null;
    try {
      const auth = await loginApi(context);
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      const companyId = await pickCompanyId(context);

      const outside = await context.post('/api/caster/listeners', {
        headers,
        data: { name: 'P15 outside', port: 1600, enabled: false, company_id: companyId }
      });
      expect(outside.status()).toBe(400);

      const created = await context.post('/api/caster/listeners', {
        headers,
        data: {
          name: `P15 company listener ${Date.now()}`,
          port: 1510,
          enabled: false,
          company_id: companyId
        }
      });
      expect(created.status()).toBe(201);
      listenerId = (await created.json()).item.id;
    } finally {
      if (listenerId !== null) {
        const me = await context.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await context.delete(`/api/caster/listeners/${listenerId}`, {
          headers: { 'X-CSRF-Token': csrf }
        });
      }
      await context.dispose();
    }
  });
});
