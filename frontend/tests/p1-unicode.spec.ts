import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('P1.9 Unicode và hiển thị', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('dữ liệu trạm 79/80 sạch và UI không mojibake', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const station = await (await page.request.get('/api/stations/79')).json();
    expect(station.item.name).toContain('Mộc Châu');
    expect(station.item.notes).toBe('Trạm thật SLA Mộc Châu');
    expect(station.item.notes).not.toMatch(/[�Ã]/);

    for (const route of ['/stations', '/alerts', '/history']) {
      await page.goto(route);
      const text = await page.locator('main').innerText();
      expect(text, route).not.toContain('�');
      expect(text, route).not.toContain('â€');
      expect(text, route).not.toContain('Ã');
    }
  });
});
