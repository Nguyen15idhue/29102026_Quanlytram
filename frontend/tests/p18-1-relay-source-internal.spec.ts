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

test.describe('P18-1 — relay chọn trạm dùng nguồn nội bộ', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('nguồn chọn trạm không hiện mountpoint và lưu upstreamMountpointId = null', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await login(page);
    await page.goto('/relay-jobs');
    await page.getByRole('button', { name: 'Thêm relay job' }).click();

    const source = page.locator('.relay-form-section').nth(0);
    await source.locator('select').first().selectOption('station');
    await expect(source.getByLabel('Trạm nguồn')).toBeVisible();
    await expect(source.getByLabel('Mountpoint nguồn')).toHaveCount(0);

    const options = (await (
      await page.request.get('/api/relay-jobs/station-options')
    ).json()) as {
      items: Array<{
        id: number;
        name: string;
        source: { direct?: boolean } | null;
        companyId: number | null;
      }>;
    };
    const station = options.items.find((item) => item.source && item.companyId !== null);
    expect(station).toBeTruthy();
    expect(station!.source!.direct).toBe(true);

    await source.getByLabel('Trạm nguồn').selectOption(String(station!.id));
    await expect(source.getByText(/không mở kết nối NTRIP ra ngoài/)).toBeVisible();

    const name = `P18-1-RELAY-${Date.now()}`;
    await page.getByLabel('Tên').fill(name);
    const destination = page.locator('.relay-form-section').nth(1);
    await destination.getByLabel('Đích host').fill('example.invalid');
    await destination.getByLabel('Đích port').fill('1509');
    await destination.getByLabel('Đích mount').fill(`${name}-DOWN`);
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });

    const listed = (await (
      await page.request.get(`/api/relay-jobs?page=1&pageSize=20&q=${name}`)
    ).json()) as {
      items: Array<{
        id: number;
        upstream: { stationId: number | null; mountpointId: number | null };
      }>;
    };
    const job = listed.items.find((item) => item.upstream.stationId === station!.id);
    expect(job).toBeTruthy();
    expect(job!.upstream.mountpointId).toBeNull();

    await page.request.delete(`/api/relay-jobs/${job!.id}`, {
      headers: { 'X-CSRF-Token': await csrf(page) }
    });
    expect(errors).toEqual([]);
  });

  test('mountpoint tạo mới được auto-map vào listener cùng công ty', async ({ page }) => {
    await login(page);
    const token = await csrf(page);

    const options = (await (
      await page.request.get('/api/relay-jobs/station-options')
    ).json()) as {
      items: Array<{ id: number; companyId: number | null }>;
    };
    const station = options.items.find((item) => item.companyId !== null);
    expect(station).toBeTruthy();

    const listeners = (await (
      await page.request.get('/api/caster/listeners?page=1&pageSize=100')
    ).json()) as { items: Array<{ id: number; companyId: number | null }> };
    const listener = listeners.items.find((item) => item.companyId === station!.companyId);
    expect(listener).toBeTruthy();

    const name = `P18-1-MP-${Date.now()}`;
    const created = await page.request.post('/api/mountpoints', {
      headers: { 'X-CSRF-Token': token },
      data: { name, station_id: station!.id, company_id: station!.companyId, enabled: true }
    });
    expect(created.status()).toBe(201);
    const mountpoint = (await created.json()) as { item: { id: number } };

    const mapped = (await (
      await page.request.get(`/api/caster/listeners/${listener!.id}/mountpoints`)
    ).json()) as { items: Array<{ id: number }> };
    expect(mapped.items.some((item) => item.id === mountpoint.item.id)).toBe(true);

    await page.request.delete(`/api/mountpoints/${mountpoint.item.id}`, {
      headers: { 'X-CSRF-Token': token }
    });
  });
});
