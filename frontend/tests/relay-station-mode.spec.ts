import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('Relay — chọn trạm nguồn/đích', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('3 section, đổi mode, banner và tạo relay bằng trạm đích', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await login(page);
    await page.goto('/relay-jobs');
    await expect(page.getByRole('heading', { name: 'Relay', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm relay job' }).click();

    const sections = page.locator('.relay-form-section');
    await expect(sections).toHaveCount(3);
    await expect(sections.nth(0).getByRole('heading', { name: 'Nguồn dữ liệu' })).toBeVisible();
    await expect(sections.nth(1).getByRole('heading', { name: 'Đích đến dữ liệu' })).toBeVisible();
    await expect(sections.nth(2).getByRole('heading', { name: 'Thông tin khác' })).toBeVisible();

    // Mặc định nhập thủ công: có trường host, không có select trạm.
    await expect(sections.nth(0).getByLabel('Nguồn host')).toBeVisible();
    await expect(sections.nth(0).getByLabel('Trạm nguồn')).toHaveCount(0);

    // Chọn trạm ở nguồn: ẩn host, hiện select trạm + banner, khóa mode trạm bên đích.
    await sections.nth(0).locator('select').first().selectOption('station');
    await expect(sections.nth(0).getByLabel('Trạm nguồn')).toBeVisible();
    await expect(sections.nth(0).getByLabel('Nguồn host')).toHaveCount(0);
    await expect(page.locator('.form-banner')).toContainText('Nguồn dữ liệu');
    await expect(
      sections.nth(1).locator('select').first().locator('option[value="station"]')
    ).toHaveAttribute('disabled', '');

    // Về nhập thủ công rồi chọn trạm ở đích.
    await sections.nth(0).locator('select').first().selectOption('manual');
    await sections.nth(1).locator('select').first().selectOption('station');
    await expect(page.locator('.form-banner')).toContainText('Đích đến dữ liệu');
    await expect(
      sections.nth(0).locator('select').first().locator('option[value="station"]')
    ).toHaveAttribute('disabled', '');

    const options = (await (
      await page.request.get('/api/relay-jobs/station-options')
    ).json()) as {
      items: Array<{
        id: number;
        name: string;
        destination: { mount: string; port: number } | null;
        mountpoints: Array<{ id: number }>;
      }>;
    };
    const target = options.items.find(
      (item) =>
        item.destination &&
        item.mountpoints.length &&
        (item.destination.port === 1508 || item.destination.port === 1509)
    );
    expect(target).toBeTruthy();
    await sections.nth(1).getByLabel('Trạm đích').selectOption(String(target!.id));
    await expect(page.getByText(/Sẽ đẩy tới 127\.0\.0\.1:/)).toBeVisible();

    const name = `E2E-STATION-UI-${Date.now()}`;
    await sections.nth(0).getByLabel('Nguồn host').fill('example.invalid');
    await sections.nth(0).getByLabel('Nguồn port').fill('1509');
    await sections.nth(0).getByLabel('Nguồn mount').fill(`${name}-UP`);
    await sections.nth(2).getByLabel('Tên').fill(name);
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });

    const me = await (await page.request.get('/api/auth/me')).json();
    const listed = (await (
      await page.request.get(`/api/relay-jobs?page=1&pageSize=20&q=${name}`)
    ).json()) as { items: Array<{ id: number }> };
    for (const item of listed.items) {
      await page.request.delete(`/api/relay-jobs/${item.id}`, {
        headers: { 'X-CSRF-Token': me.csrfToken }
      });
    }

    expect(errors).toEqual([]);
  });
});
