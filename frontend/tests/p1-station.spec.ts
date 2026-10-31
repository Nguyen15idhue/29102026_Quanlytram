import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P1.5 trạm', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('tạo không mã trạm, ẩn vị trí/hệ thống, sửa hiện đầy đủ', async ({ page }) => {
    const name = `P1 Station ${Date.now()}`;
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations');
    await page.getByRole('button', { name: 'Thêm trạm' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Mã trạm')).toHaveCount(0);
    await expect(dialog.getByText('Vị trí', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Hệ thống (chỉ đọc)', { exact: true })).toHaveCount(0);
    await dialog.getByLabel('Tên trạm').fill(name);
    await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    await page.getByRole('button', { name: `Sửa ${name}` }).click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByText('Vị trí', { exact: true })).toBeVisible();
    await expect(edit.getByText('Hệ thống (chỉ đọc)', { exact: true })).toBeVisible();
    await expect(edit.getByLabel('Mã nội bộ')).toHaveValue(/ST/);
    await edit.getByLabel('Tỉnh/thành').fill('Hà Nội');
    await edit.getByLabel('Phường/xã').fill('Ba Đình');
    await edit.getByRole('button', { name: 'Cập nhật' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    const me = await (await page.request.get('/api/auth/me')).json();
    const stations = await (
      await page.request.get(`/api/stations?page=1&pageSize=20&q=${encodeURIComponent(name)}`)
    ).json();
    const station = stations.items[0];
    const sources = await (
      await page.request.get(`/api/stations/${station.id}/sources`)
    ).json();
    expect(sources.items).toHaveLength(1);
    expect(sources.items[0].source_role).toBe('ntrip_caster');

    const geo = await (
      await page.request.get('/api/geo/reverse?lat=21.0285&lon=105.8542')
    ).json();
    expect(['geoapify', 'fallback']).toContain(geo.item.source);
    expect(JSON.stringify(geo)).not.toContain('apiKey');

    for (const range of ['1d', '7d', '30d']) {
      const uptime = await (
        await page.request.get(`/api/stations/${station.id}/uptime?range=${range}`)
      ).json();
      expect(uptime.range).toBe(range);
      expect(Array.isArray(uptime.buckets)).toBe(true);
      expect(typeof uptime.uptimePct).toBe('number');
    }

    await page.getByRole('button', { name: `Xóa ${name}` }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Xóa', exact: true })
      .click();
    await expect(page.getByText(name)).toHaveCount(0);
    expect(me.csrfToken).toBeTruthy();
  });
});
