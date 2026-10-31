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

test.describe('P1 station connection/coordinate/geo fixes', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('source caster listener, client GGA và geo không báo success rỗng', async ({ page }) => {
    const context = await api.newContext({ baseURL });
    let stationId: number | null = null;
    try {
      const auth = await login(context);
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      const listeners = await (await context.get('/api/caster/listeners?page=1&pageSize=10')).json();
      const listener = listeners.items[0];
      const created = await context.post('/api/stations', {
        headers,
        data: { name: `P1 Source ${Date.now()}`, lat: 21.0285, lon: 105.8542 }
      });
      expect(created.status()).toBe(201);
      stationId = (await created.json()).item.id;

      const caster = await context.put(`/api/stations/${stationId}/sources`, {
        headers,
        data: {
          source_role: 'ntrip_caster',
          caster_version: 'v2',
          caster_username: 'caster-user',
          caster_password: 'Secret123!',
          caster_requires_auth: true,
          caster_listener_id: listener.id
        }
      });
      expect(caster.status()).toBe(200);
      const casterSource = (await caster.json()).item;
      expect(casterSource.caster_listener_id).toBe(listener.id);
      expect(casterSource.caster_port).toBe(listener.port);
      expect(casterSource.caster_has_password).toBe(true);

      const client = await context.put(`/api/stations/${stationId}/sources`, {
        headers,
        data: {
          source_role: 'ntrip_client',
          client_host: 'example.invalid',
          client_port: 2101,
          client_mount: 'M1',
          client_username: 'client-user',
          client_password: 'Secret123!',
          client_tls: true,
          client_send_gga: true,
          client_nmea_interval_sec: 10,
          client_gga_lat: 21.0285,
          client_gga_lon: 105.8542
        }
      });
      expect(client.status()).toBe(200);
      const clientSource = (await client.json()).item;
      expect(clientSource.client_send_gga).toBe(true);
      expect(clientSource.client_gga_lat).toBeCloseTo(21.0285, 6);
      expect(clientSource.client_gga_lon).toBeCloseTo(105.8542, 6);

      await page.goto('/login');
      await page.getByLabel('Tên đăng nhập').fill('superadmin');
      await page.getByLabel('Mật khẩu').fill(password);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      await page.goto(`/stations/${stationId}`);
      await page.getByRole('button', { name: 'Sửa', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Thông tin kết nối', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Nguồn dữ liệu', { exact: true })).toHaveCount(0);
      await expect(dialog.getByText('NTRIP mode', { exact: true })).toHaveCount(0);
      await expect(dialog.getByText('Network type', { exact: true })).toHaveCount(0);
      await dialog.getByLabel('Hệ tọa độ').selectOption('vn2000');
      await expect(dialog.getByText('VN2000 X / Easting (m)', { exact: true })).toBeVisible();
      await expect(dialog.getByText('VN2000 Y / Northing (m)', { exact: true })).toBeVisible();
      await dialog.getByLabel('Hệ tọa độ').selectOption('itrf');
      await expect(dialog.getByText('ITRF X (m)', { exact: true })).toBeVisible();
      await expect(dialog.getByText('ITRF Y (m)', { exact: true })).toBeVisible();
      await dialog.getByLabel('Hệ tọa độ').selectOption('wgs84');
      await expect(dialog.getByText('Cao độ WGS84 (m)', { exact: true })).toBeVisible();

      await page.route('/api/geo/reverse**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            item: { province: '', ward: '', addressDetail: '', source: 'fallback' }
          })
        });
      });
      await page.getByRole('button', { name: 'Lấy địa chỉ từ tọa độ' }).click();
      await expect(page.getByText('Không tìm thấy địa chỉ cho tọa độ này')).toBeVisible();
    } finally {
      if (stationId !== null) {
        const me = await context.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await context.delete(`/api/stations/${stationId}`, {
          headers: { 'X-CSRF-Token': csrf }
        });
      }
      await context.dispose();
    }
  });
});
