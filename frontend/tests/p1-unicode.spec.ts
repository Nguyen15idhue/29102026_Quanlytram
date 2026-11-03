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

    // Fixture Unicode do scripts/seed-docs-fixtures.mjs tạo (DB dev có thể đã
    // đổi id nên không hard-code id trạm thật như trước).
    const fixtureName = 'DOCS-Trạm Hậu Lộc';
    const list = await (
      await page.request.get(
        `/api/stations?page=1&pageSize=10&q=${encodeURIComponent(fixtureName)}`
      )
    ).json();
    const station = list.items.find(
      (item: { name: string }) => item.name === fixtureName
    );
    expect(
      station,
      `Thiếu fixture "${fixtureName}", chạy scripts/seed-docs-fixtures.mjs --apply`
    ).toBeTruthy();
    expect(station.name).toContain('Hậu Lộc');
    expect(station.name).not.toMatch(/[�Ã]/);
    expect(station.notes ?? '').not.toMatch(/[�Ã]/);

    for (const route of ['/stations', '/alerts', '/history']) {
      await page.goto(route);
      const text = await page.locator('main').innerText();
      expect(text, route).not.toContain('�');
      expect(text, route).not.toContain('â€');
      expect(text, route).not.toContain('Ã');
    }
  });
});
