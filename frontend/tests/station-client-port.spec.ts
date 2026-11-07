import { expect, test } from '@playwright/test';

// Hồi quy: tạo trạm NTRIP client không được gửi port trạm (port upstream
// ngoài không liên quan port hệ thống). Backend cũ trả 400, backend mới 201;
// test chỉ khóa hình dạng request để chạy được ở cả hai.
const adminUser = process.env.E2E_ADMIN_USERNAME ?? 'docs.admin';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe('tạo trạm NTRIP client không gửi port trạm', () => {
  test.skip(!adminPassword, 'E2E_ADMIN_PASSWORD is required');

  test('payload POST /api/stations không có key port', async ({ page }) => {
    let postedBody: Record<string, unknown> | null = null;
    await page.route('**/api/stations', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        try {
          postedBody = JSON.parse(req.postData() || '{}');
        } catch {
          postedBody = {};
        }
      }
      await route.continue();
    });
    await page.route('**/api/map/tiles/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64'
        )
      })
    );

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill(adminUser);
    await page.getByLabel('Mật khẩu').fill(adminPassword);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations');
    await page.getByRole('button', { name: 'Thêm trạm' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tên trạm').fill(`ClientNoPort ${Date.now()}`);
    await dialog.getByLabel('Vai trò nguồn').selectOption('ntrip_client');
    await dialog.getByLabel('Client host').fill('192.0.2.10');
    await dialog.getByLabel('Client port').fill('1509');
    // Không phụ thuộc sourcetable live: chèn option kiểm thử vào select
    // (client_mount chỉ cần non-empty ở validateSourceFields).
    await dialog.getByLabel('Client mountpoint').evaluate((el: HTMLSelectElement) => {
      el.insertAdjacentHTML('beforeend', '<option value="TESTE2E">TESTE2E</option>');
      el.value = 'TESTE2E';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await dialog.getByLabel('Client username').fill('testuser_e2e');
    await dialog.getByLabel('Client password').fill('dummy-test-pw');
    await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
    await page.waitForTimeout(3000);

    expect(postedBody).not.toBeNull();
    expect(postedBody).not.toHaveProperty('port');
    expect(postedBody?.source_role).toBe('ntrip_client');
    expect(postedBody?.client_port).toBe(1509);
    // Client port upstream giữ nguyên, không bị ép thành port trạm.
  });
});
