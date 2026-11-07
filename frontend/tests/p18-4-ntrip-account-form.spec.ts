import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('P18-4 form tài khoản NTRIP với Tất cả động', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('form tạo có 2 multiselect mặc định Tất cả, validate ít nhất 1', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await login(page);
    await page.goto('/ntrip-accounts');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('Listener (bắt buộc)')).toBeVisible();
    await expect(dialog.getByText('Mountpoint (bắt buộc)')).toBeVisible();
    const allBoxes = dialog.getByLabel(/Tất cả (listener|mountpoint)/i);
    await expect(allBoxes).toHaveCount(2);
    await expect(allBoxes.nth(0)).toBeChecked();
    await expect(allBoxes.nth(1)).toBeChecked();

    const name = `p184-${Date.now()}`;
    await dialog.getByLabel('Username').fill(name);
    await dialog.getByLabel(/Mật khẩu/).fill('Testpass123');
    // Bỏ “Tất cả listener” mà không chọn lẻ → submit phải báo lỗi client.
    await allBoxes.nth(0).uncheck();
    await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(dialog.getByText(/ít nhất 1 listener/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    expect(errors).toEqual([]);
  });

  test('tạo tài khoản mặc định Tất cả qua UI và thấy cờ ở chi tiết', async ({ page }) => {
    await login(page);
    await page.goto('/ntrip-accounts');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const dialog = page.getByRole('dialog');
    const name = `p184a${Date.now()}`.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await dialog.getByLabel('Username').fill(name);
    await dialog.getByLabel(/Mật khẩu/).fill('Testpass123');
    const companySelect = dialog.getByLabel('Công ty');
    if (await companySelect.count()) {
      const value = await companySelect.inputValue().catch(() => '');
      if (!value) {
        const options = companySelect.locator('option');
        const count = await options.count();
        for (let i = 0; i < count; i++) {
          const v = await options.nth(i).getAttribute('value');
          if (v) {
            await companySelect.selectOption(v);
            break;
          }
        }
      }
    }
    await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10000 });
    await page.getByText(name).first().click();
    await expect(page.getByText('Tất cả (động)').first()).toBeVisible({ timeout: 10000 });
    const me = await (await page.request.get('/api/auth/me')).json();
    const created = await (await page.request.get(`/api/ntrip-accounts?page=1&pageSize=5&q=${name}`)).json() as {
      items: Array<{ id: number; username: string }>;
    };
    const target = created.items.find((i) => i.username === name);
    if (target) {
      await page.request.delete(`/api/ntrip-accounts/${target.id}`, {
        headers: { 'X-CSRF-Token': me.csrfToken },
      });
    }
  });

  test('dialog không tràn ngang ở 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/ntrip-accounts');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
