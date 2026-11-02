import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const prefix = `E2E-STATE-${Date.now().toString().slice(-6)}`;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function csrf(page: Page): Promise<string> {
  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  return (await me.json()).csrfToken;
}

async function companyId(page: Page): Promise<number> {
  const res = await page.request.get('/api/companies?page=1&pageSize=1');
  expect(res.status()).toBe(200);
  const body = await res.json();
  return Number(body.items?.[0]?.id ?? 1);
}

async function createJob(page: Page, name: string, token: string, company: number) {
  const res = await page.request.post('/api/relay-jobs', {
    headers: { 'X-CSRF-Token': token },
    data: {
      name,
      enabled: false,
      companyId: company,
      upstream: { host: 'example.invalid', port: 1509, mount: `${name}-UP` },
      downstream: { host: 'caster.example.invalid', port: 1509, mount: `${name}-DOWN` }
    }
  });
  expect(res.status(), await res.text()).toBe(201);
  return Number((await res.json()).item.id);
}

async function waitApplied(page: Page, id: number) {
  for (let i = 0; i < 25; i += 1) {
    const res = await page.request.get(`/api/relay-jobs/${id}`);
    if (res.ok()) {
      const item = (await res.json()).item;
      if (Number(item?.state?.appliedRevision ?? 0) >= Number(item?.desiredRevision ?? 0)) return;
    }
    await page.waitForTimeout(300);
  }
}

async function action(page: Page, id: number, name: string, token: string, extra = '') {
  return page.request.post(`/api/relay-jobs/${id}${extra ? `/${extra}` : ''}`, {
    headers: { 'X-CSRF-Token': token }
  });
}

test.describe('Ma trận trạng thái relay', () => {
  test.skip(!password, 'E2E_PASSWORD là bắt buộc');

  const created: number[] = [];
  let token = '';
  let company = 0;

  test.beforeEach(async ({ page }) => {
    await login(page);
    token = await csrf(page);
    company = await companyId(page);
  });

  test.afterAll(async ({ browser }) => {
    if (!created.length || !password) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    const csrfToken = await csrf(page);
    for (const id of created) {
      await page.request.post(`/api/relay-jobs/${id}/disable`, {
        headers: { 'X-CSRF-Token': csrfToken }
      });
      await page.request.post(`/api/relay-jobs/${id}/unlock`, {
        headers: { 'X-CSRF-Token': csrfToken }
      });
      await waitApplied(page, id);
      await page.request.delete(`/api/relay-jobs/${id}`, {
        headers: { 'X-CSRF-Token': csrfToken }
      });
    }
    await context.close();
  });

  test('R10 — khóa job đã tắt: badge offline, nút xóa bị vô hiệu', async ({ page }) => {
    const name = `${prefix}-UI`;
    const id = await createJob(page, name, token, company);
    created.push(id);

    await page.goto(`/relay-jobs?q=${encodeURIComponent(name)}`);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: `Xóa ${name}` })).toBeEnabled();

    await row.getByRole('button', { name: `Khóa ${name}` }).click();
    await expect(row.locator('.badge', { hasText: 'offline' })).toBeVisible({ timeout: 10000 });
    await expect(row.getByRole('button', { name: `Xóa ${name}` })).toBeDisabled();
    await expect(row.getByRole('button', { name: `Mở khóa ${name}` })).toBeVisible();
  });

  test('R11 — xóa khi đang bật bị chặn, sau tắt/khóa/mở khóa thì xóa được', async ({ page }) => {
    const name = `${prefix}-DEL`;
    const id = await createJob(page, name, token, company);
    created.push(id);

    const enable = await action(page, id, name, token, 'enable');
    expect(enable.status()).toBe(200);

    const blocked = await page.request.delete(`/api/relay-jobs/${id}`, {
      headers: { 'X-CSRF-Token': token }
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.code).toBe('RELAY_ENABLED');

    expect((await action(page, id, name, token, 'disable')).status()).toBe(200);
    await waitApplied(page, id);
    expect((await action(page, id, name, token, 'lock')).status()).toBe(200);
    expect((await action(page, id, name, token, 'unlock')).status()).toBe(200);
    await waitApplied(page, id);

    const removed = await page.request.delete(`/api/relay-jobs/${id}`, {
      headers: { 'X-CSRF-Token': token }
    });
    expect(removed.status()).toBe(204);
  });

  test('R12 — bulk xóa chỉ áp dụng job hợp lệ', async ({ page }) => {
    const enabledId = await createJob(page, `${prefix}-B1`, token, company);
    const lockedId = await createJob(page, `${prefix}-B2`, token, company);
    const freeId = await createJob(page, `${prefix}-B3`, token, company);
    created.push(enabledId, lockedId, freeId);

    expect((await action(page, enabledId, '', token, 'enable')).status()).toBe(200);

    expect((await action(page, lockedId, '', token, 'lock')).status()).toBe(200);
    await waitApplied(page, lockedId);

    const res = await page.request.post('/api/relay-jobs/bulk', {
      headers: { 'X-CSRF-Token': token },
      data: { action: 'delete', ids: [enabledId, lockedId, freeId] }
    });
    expect(res.status()).toBe(200);
    const result = (await res.json()).result;
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(2);
  });
});
