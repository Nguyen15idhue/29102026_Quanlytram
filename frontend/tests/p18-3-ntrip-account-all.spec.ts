import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function csrf(page: Page): Promise<string> {
  const me = await (await page.request.get('/api/auth/me')).json();
  return me.csrfToken as string;
}

test.describe('P18-3 backend listener_all/mountpoint_all', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('mặc định Tất cả, validate bắt buộc, effective động', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await login(page);
    const token = await csrf(page);

    // Tài khoản hiện có phải có 2 cờ mới.
    const list = await (await page.request.get('/api/ntrip-accounts?page=1&pageSize=1')).json() as {
      items: Array<{ id: number }>;
    };
    if (list.items.length > 0) {
      const detail = await (await page.request.get(`/api/ntrip-accounts/${list.items[0].id}`)).json() as {
        item: { listenerAll: boolean; mountpointAll: boolean };
      };
      expect(typeof detail.item.listenerAll).toBe('boolean');
      expect(typeof detail.item.mountpointAll).toBe('boolean');
    }

    const name = `P183-ALL-${Date.now()}`;
    const companies = await (await page.request.get('/api/companies?page=1&pageSize=50')).json() as {
      items: Array<{ id: number; code?: string }>;
    };
    const companyId = companies.items.find((c) => c.code === 'DOCS_DEMO')?.id ?? companies.items[0]?.id;
    expect(companyId).toBeTruthy();
    const created = await page.request.post('/api/ntrip-accounts', {
      headers: { 'X-CSRF-Token': token },
      data: { username: name.toLowerCase().replace(/[^a-z0-9_.-]/g, ''), password: 'Testpass123', company_id: companyId },
    });
    expect(created.status()).toBe(201);
    const item = (await created.json()).item as { id: number; listenerAll: boolean; mountpointAll: boolean };
    expect(item.listenerAll).toBe(true);
    expect(item.mountpointAll).toBe(true);

    const eff = await (await page.request.get(`/api/ntrip-accounts/${item.id}/mountpoints`)).json() as {
      items: unknown[];
    };
    expect(Array.isArray(eff.items)).toBe(true);

    // Thiếu ids khi tắt “Tất cả” phải 400.
    const bad = await page.request.patch(`/api/ntrip-accounts/${item.id}`, {
      headers: { 'X-CSRF-Token': token },
      data: { listener_all: false, mountpoint_all: false },
    });
    expect(bad.status()).toBe(400);

    await page.request.delete(`/api/ntrip-accounts/${item.id}`, {
      headers: { 'X-CSRF-Token': await csrf(page) },
    });
    expect(errors).toEqual([]);
  });
});
