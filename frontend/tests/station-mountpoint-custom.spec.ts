import { expect, test, request as api } from '@playwright/test';
import { pickCompanyId } from './support/company';

const password = process.env.E2E_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

test.describe('mountpoint khi tạo trạm', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('cho phép nhập mountpoint thủ công và chặn trùng tên', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations');
    await page.getByRole('button', { name: 'Thêm trạm' }).click();
    const field = page.locator('.field', { hasText: 'Để trống' }).locator('input');
    await expect(field).toBeEditable();
    await field.fill('MP_THU_CONG');
    await expect(field).toHaveValue('MP_THU_CONG');
    await page.getByRole('button', { name: 'Hủy' }).click();

    const context = await api.newContext({ baseURL });
    let stationId: number | null = null;
    try {
      const auth = await (
        await context.post('/api/auth/login', {
          data: { username: 'superadmin', password }
        })
      ).json();
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      const companyId = await pickCompanyId(context);
      const listeners = await (
        await context.get('/api/caster/listeners?page=1&pageSize=50')
      ).json();
      const listener =
        listeners.items.find(
          (item: { companyId?: number | null }) => item.companyId === companyId
        ) ?? listeners.items[0];
      const stamp = Date.now();
      const mountpoint = `CUSTOM_MP_${stamp}`;

      const created = await context.post('/api/stations', {
        headers,
        data: {
          name: `P1 Mountpoint ${stamp}`,
          port: listener.port,
          lat: 21.0285,
          lon: 105.8542,
          source_role: 'ntrip_caster',
          caster_listener_id: listener.id,
          caster_username: `mp_source_${stamp}`,
          caster_password: 'P1Source123!',
          company_id: companyId,
          mountpoint_name: mountpoint
        }
      });
      expect(created.status()).toBe(201);
      const station = (await created.json()).item;
      stationId = station.id;
      expect(station.mountpoint_name).toBe(mountpoint);

      const duplicate = await context.post('/api/stations', {
        headers,
        data: {
          name: `P1 Mountpoint Dup ${stamp}`,
          port: listener.port,
          lat: 21.0285,
          lon: 105.8542,
          source_role: 'ntrip_caster',
          caster_listener_id: listener.id,
          caster_username: `mp_dup_${stamp}`,
          caster_password: 'P1Source123!',
          company_id: companyId,
          mountpoint_name: mountpoint
        }
      });
      expect(duplicate.status()).toBe(409);
    } finally {
      if (stationId !== null) {
        const auth = await (
          await context.post('/api/auth/login', {
            data: { username: 'superadmin', password }
          })
        ).json();
        const headers = { 'X-CSRF-Token': auth.csrfToken };
        await context.patch(`/api/stations/${stationId}`, {
          headers,
          data: { enabled: false }
        });
        await context.delete(`/api/stations/${stationId}`, { headers });
      }
      await context.dispose();
    }
  });
});
