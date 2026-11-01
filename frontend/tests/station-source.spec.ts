import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';

test.describe('Phase 7 station source and 1005 coordinates', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('station source, NTRIP account and mountpoint detail', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill('superadmin');
    await page.getByLabel('Mật khẩu').fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/stations');
    await page.getByPlaceholder('Tìm mã, tên, địa chỉ').fill('THA Hậu Lộc');
    const row = page.getByRole('row', { name: /THA Hậu Lộc/ }).first();
    await expect(row).toBeVisible();
    await row.locator('.link-btn').click();
    const detail = page.getByRole('dialog');
    await detail.getByRole('tab', { name: 'Tổng quan' }).click();

    await expect(detail.getByText('NTRIP caster (relay)')).toBeVisible();
    await expect(detail.getByText(/V2 · v2_auth/)).toBeVisible();
    await expect(detail.getByText('Relay job')).toBeVisible();
    await expect(detail.getByText(/Relay upstream host/)).toBeVisible();
    await expect(detail.getByText(/WGS84 lat\/lon \(1005\)/)).toBeVisible();
    await expect(detail.getByText(/VN2000 \(TM 105°\)/)).toBeVisible();
    await expect(detail.getByText(/ITRF spatial \(ECEF\)/)).toBeVisible();
    await expect(detail.getByText(/19\.\d{6}, 105\.\d{6}/)).toBeVisible();

    await detail.getByRole('tab', { name: 'Chất lượng' }).click();
    await expect(detail.getByRole('heading', { name: 'Sky plot' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'CNR theo vệ tinh và băng' })).toBeVisible();
    await expect(detail.getByText('Transport', { exact: true })).toBeVisible();
    await expect(detail.getByText('Metadata', { exact: true })).toBeVisible();
    await expect(detail.getByText('đang để Phase 8–9')).toHaveCount(0);
    await detail.getByRole('heading', { name: 'Sky plot' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/quality-advanced-metrics.png',
      fullPage: true
    });

    await detail.getByRole('button', { name: 'Sửa', exact: true }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByLabel('Vĩ độ WGS84')).not.toBeEditable();
    await expect(form.getByLabel('Kinh độ WGS84')).not.toBeEditable();
    await expect(form.getByText('Thông tin kết nối', { exact: true })).toBeVisible();
    await expect(form.getByLabel('Caster version')).toBeVisible();
    await expect(form.getByLabel('NTRIP mode')).toHaveCount(0);
    await page.screenshot({
      path: 'test-results/station-source-form.png',
      fullPage: true
    });
    await form.getByRole('button', { name: 'Hủy' }).click();

    await page.goto('/ntrip-accounts');
    const accountRow = page.locator('tbody tr').first();
    if (await accountRow.count()) {
      await accountRow.locator('.link-btn').click();
      const accountDetail = page.getByRole('dialog');
      await expect(accountDetail.getByText('Công ty', { exact: true })).toBeVisible();
      await expect(accountDetail.getByText('Hiệu lực', { exact: true })).toBeVisible();
      await expect(accountDetail.getByText('ACL listener', { exact: true })).toBeVisible();
      await accountDetail.getByRole('button', { name: 'Đóng' }).last().click();
    }

    await page.goto('/mountpoints');
    const mountpointRow = page.locator('tbody tr').first();
    if (await mountpointRow.count()) {
      await mountpointRow.locator('.link-btn').click();
      const mountpointDetail = page.getByRole('dialog');
      await expect(mountpointDetail.getByText('Online', { exact: true })).toBeVisible();
      await expect(mountpointDetail.getByText('Relay lấy mountpoint')).toBeVisible();
      await expect(mountpointDetail.getByText('Alert mở', { exact: true })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});
