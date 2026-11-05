import { expect, test } from '@playwright/test';

const adminPassword =
  process.env.E2E_DOCS_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? '';

test.describe('chống nâng quyền khi tạo web user', () => {
  test.skip(!adminPassword, 'E2E_DOCS_ADMIN_PASSWORD is required');

  test('admin chỉ thấy role thấp hơn và API chặn role >= mình', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('docs.admin');
    await page.getByLabel('Mật khẩu').fill(adminPassword);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const me = await (await page.request.get('/api/auth/me')).json();
    const headers = { 'X-CSRF-Token': me.csrfToken };
    const roleList = await (await page.request.get('/api/roles')).json();
    const roles = roleList.items as Array<{ id: number; code: string; level: number }>;
    const byId = new Map(roles.map((role) => [String(role.id), role]));

    await page.goto('/web-users');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const dialog = page.getByRole('dialog');
    const select = dialog.locator('.field', { hasText: 'Vai trò' }).locator('select');
    const values = await select
      .locator('option')
      .evaluateAll((options) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .filter((value) => value !== '')
      );
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      const role = byId.get(value);
      expect(role, `role id ${value} phải tồn tại`).toBeTruthy();
      expect(role!.level).toBeLessThan(me.user.role.level);
      expect(role!.code).not.toBe('super_admin');
      expect(role!.code).not.toBe('admin');
    }

    const superRole = roles.find((role) => role.code === 'super_admin')!;
    const adminRole = roles.find((role) => role.code === 'admin')!;
    const userRole = roles.find((role) => role.code === 'user')!;
    const stamp = Date.now();

    for (const roleId of [superRole.id, adminRole.id]) {
      const response = await page.request.post('/api/web-users', {
        headers,
        data: {
          username: `blocked_${stamp}_${roleId}`,
          password: 'Test1234!',
          display_name: 'Blocked test',
          role_id: roleId
        }
      });
      expect(response.status(), `role ${roleId} phải bị chặn`).toBe(403);
    }

    const created = await page.request.post('/api/web-users', {
      headers,
      data: {
        username: `allowed_${stamp}`,
        password: 'Test1234!',
        display_name: 'Allowed test',
        role_id: userRole.id
      }
    });
    expect(created.status()).toBe(201);
    const userId = (await created.json()).item.id;
    await page.request.delete(`/api/web-users/${userId}`, { headers });
  });
});
