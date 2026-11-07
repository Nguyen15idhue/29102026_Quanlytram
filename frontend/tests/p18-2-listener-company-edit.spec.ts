import { expect, request as api, test, type Page } from '@playwright/test';

const superPassword = process.env.E2E_PASSWORD ?? '';
const adminUser = process.env.E2E_ADMIN_USERNAME ?? 'docs.admin';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';
const userPassword = process.env.E2E_USER_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

async function loginPage(page: Page, username: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(secret);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P18-2 admin công ty sửa listener', () => {
  test.skip(!superPassword || !adminPassword, 'Thiếu mật khẩu E2E');

  test('admin sửa được tên/role, port read-only, API chặn đổi port/company', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loginPage(page, adminUser, adminPassword);
    await page.goto('/caster');
    await expect(page.getByRole('heading', { name: 'Listener', exact: true }).first()).toBeVisible({ timeout: 15000 }).catch(() => {});
    // Admin không có nút Thêm, nhưng có nút Sửa.
    await expect(page.getByRole('button', { name: 'Thêm listener' })).toHaveCount(0);
    const editButtons = page.getByRole('button', { name: /Sửa / });
    await expect(editButtons.first()).toBeVisible({ timeout: 15000 });
    await editButtons.first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const portInput = dialog.locator('input[type="number"]');
    await expect(portInput).toBeDisabled();
    await expect(dialog.getByText('công ty không được đổi', { exact: false })).toBeVisible();
    // Đổi tên và lưu.
    const nameInput = dialog.getByLabel('Tên');
    const orig = await nameInput.inputValue();
    const next = `${orig}-P182`.slice(0, 60);
    await nameInput.fill(next);
    await dialog.getByRole('button', { name: 'Cập nhật', exact: true }).click();
    await expect(page.getByText(next).first()).toBeVisible({ timeout: 10000 });

    // Trả lại tên cũ để không làm bẩn dữ liệu.
    await editButtons.first().click();
    await dialog.getByLabel('Tên').fill(orig);
    await dialog.getByRole('button', { name: 'Cập nhật', exact: true }).click();
    await expect(page.getByText(orig).first()).toBeVisible({ timeout: 10000 });

    // API: admin đổi port/company phải 400.
    const ctx = await api.newContext({ baseURL });
    const login = await ctx.post('/api/auth/login', { data: { username: adminUser, password: adminPassword } });
    expect(login.status()).toBe(200);
    const auth = await login.json();
    const headers = { 'X-CSRF-Token': auth.csrfToken };
    const list = await ctx.get('/api/caster/listeners?page=1&pageSize=5');
    expect(list.status()).toBe(200);
    const listener = (await list.json()).items?.[0];
    expect(listener?.id).toBeTruthy();
    const badPort = await ctx.patch(`/api/caster/listeners/${listener.id}`, {
      headers,
      data: { port: 1599, name: listener.name },
    });
    expect([400, 403]).toContain(badPort.status());
    const badCompany = await ctx.patch(`/api/caster/listeners/${listener.id}`, {
      headers,
      data: { company_id: 999999, name: listener.name },
    });
    expect([400, 403, 404]).toContain(badCompany.status());
    await ctx.dispose();
    expect(errors).toEqual([]);
  });

  test('user chỉ xem, không có nút Sửa', async ({ page }) => {
    test.skip(!userPassword, 'Thiếu E2E_USER_PASSWORD');
    await loginPage(page, 'user1', userPassword);
    await page.goto('/caster');
    await expect(page.getByRole('button', { name: 'Thêm listener' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Sửa / })).toHaveCount(0);
  });
});
