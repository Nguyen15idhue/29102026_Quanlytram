import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P19 device profile cho relay', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('chọn profile và xem trước User-Agent thiết bị', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    await page.getByRole('link', { name: 'Relay' }).click();
    await expect(page.getByRole('heading', { name: 'Relay' })).toBeVisible();
    await page.getByRole('button', { name: /Thêm relay job/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog
      .getByTestId('relay-device-profile')
      .selectOption({ label: 'CHC LandStar (chc_landstar)' });
    await expect(dialog.getByTestId('relay-ua-preview')).toContainText('CHC LandStar/');

    await dialog.getByTestId('relay-ua-prefix').fill('NTRIP');
    await expect(dialog.getByTestId('relay-ua-preview')).toContainText('NTRIP CHC LandStar/');

    await page.screenshot({ path: 'test-results/device-profile-relay-light.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('lưu relay job với device profile và đọc lại đúng cấu hình', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto('/relay-jobs');
    await page.getByRole('button', { name: 'Thêm relay job' }).click();
    const dialog = page.getByRole('dialog');
    const sections = page.locator('.relay-form-section');
    const name = `E2E-DEVICE-PROFILE-${Date.now()}`;

    await sections.nth(0).getByLabel('Nguồn host').fill('example.invalid');
    await sections.nth(0).getByLabel('Nguồn port').fill('1509');
    await sections.nth(0).getByLabel('Nguồn mount').fill(`${name}-UP`);
    await sections.nth(1).getByLabel('Đích host').fill('example.invalid');
    await sections.nth(1).getByLabel('Đích port').fill('1510');
    await sections.nth(1).getByLabel('Đích mount').fill(`${name}-DOWN`);
    await sections.nth(2).getByLabel('Tên', { exact: true }).fill(name);
    await dialog
      .getByTestId('relay-device-profile')
      .selectOption({ label: 'CHC LandStar (chc_landstar)' });

    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/relay-jobs') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const payload = (await response.json()) as {
      item: { id: number; uaMode: string; deviceProfileId: number | null; motionEnabled: boolean };
    };
    expect(payload.item.uaMode).toBe('profile');
    expect(payload.item.deviceProfileId).toBeGreaterThan(0);
    expect(payload.item.motionEnabled).toBe(false);

    const me = await (await page.request.get('/api/auth/me')).json();
    const patched = await page.request.patch(`/api/relay-jobs/${payload.item.id}`, {
      headers: { 'X-CSRF-Token': me.csrfToken },
      data: {
        uaMode: 'literal',
        uaPrefix: 'NTRIP Literal/1.0',
        deviceProfileId: null,
        motionEnabled: true
      }
    });
    expect(patched.status()).toBe(200);
    const patchedItem = (await patched.json()).item;
    expect(patchedItem.uaMode).toBe('literal');
    expect(patchedItem.deviceProfileId).toBeNull();
    expect(patchedItem.motionEnabled).toBe(true);

    await page.request.delete(`/api/relay-jobs/${payload.item.id}`, {
      headers: { 'X-CSRF-Token': me.csrfToken }
    });
  });

  test('lưu device profile cho nguồn trạm và khôi phục', async ({ page }) => {
    await login(page);
    const me = await (await page.request.get('/api/auth/me')).json();
    const profiles = (await (await page.request.get('/api/device-profiles')).json()) as {
      items: Array<{ id: number; code: string }>;
    };
    const landstar = profiles.items.find((item) => item.code === 'chc_landstar');
    expect(landstar).toBeTruthy();

    const stations = (await (
      await page.request.get('/api/stations?page=1&pageSize=50')
    ).json()) as { items: Array<{ id: number; name: string }> };
    let chosen: { id: number; source: any } | null = null;
    for (const station of stations.items) {
      const sources = (await (
        await page.request.get(`/api/stations/${station.id}/sources`)
      ).json()) as { items: any[] };
      if (sources.items[0]?.source_role === 'ntrip_client') {
        chosen = { id: station.id, source: sources.items[0] };
        break;
      }
    }
    test.skip(!chosen, 'cần ít nhất một trạm nguồn NTRIP client');
    const original = chosen!.source;

    const body = {
      source_role: original.source_role,
      client_host: original.client_host,
      client_port: original.client_port,
      client_mount: original.client_mount,
      client_username: original.client_username,
      client_tls: original.client_tls,
      client_send_gga: original.client_send_gga,
      client_nmea_interval_sec: original.client_nmea_interval_sec,
      client_gga_lat: original.client_gga_lat,
      client_gga_lon: original.client_gga_lon,
      caster_version: original.caster_version,
      caster_username: original.caster_username,
      caster_requires_auth: original.caster_requires_auth,
      caster_listener_id: original.caster_listener_id,
      client_device_profile_id: landstar!.id,
      client_ua_prefix: 'NTRIP'
    };
    const saved = await page.request.put(`/api/stations/${chosen!.id}/sources`, {
      headers: { 'X-CSRF-Token': me.csrfToken },
      data: body
    });
    expect(saved.status()).toBe(200);
    const after = (await (
      await page.request.get(`/api/stations/${chosen!.id}/sources`)
    ).json()) as { items: any[] };
    expect(after.items[0].client_device_profile_id).toBe(landstar!.id);
    expect(after.items[0].client_ua_prefix).toBe('NTRIP');

    const restored = await page.request.put(`/api/stations/${chosen!.id}/sources`, {
      headers: { 'X-CSRF-Token': me.csrfToken },
      data: {
        ...body,
        client_device_profile_id: original.client_device_profile_id,
        client_ua_prefix: original.client_ua_prefix
      }
    });
    expect(restored.status()).toBe(200);
  });
});
