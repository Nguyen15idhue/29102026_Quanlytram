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
    await page.getByPlaceholder('Tìm mã, tên, địa chỉ').fill('THA_HauLoc');
    const row = page.getByRole('row', { name: /THA_HauLoc/ }).first();
    await expect(row).toBeVisible();
    await row.click();
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
    await expect(detail.getByRole('heading', { name: 'Latency' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Cycle slip' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Code & Phase RMS' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Sky Plot' })).toBeVisible();
    await expect(detail.getByText('đang để Phase 8–9')).toHaveCount(0);
    await detail.getByRole('heading', { name: 'Latency' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/quality-advanced-metrics.png',
      fullPage: true
    });

    await detail.getByRole('button', { name: 'Sửa', exact: true }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByLabel('Vĩ độ WGS84 (1005)')).not.toBeEditable();
    await expect(form.getByLabel('Kinh độ WGS84 (1005)')).not.toBeEditable();
    await expect(form.getByLabel('NTRIP mode')).toBeDisabled();
    await expect(form.getByLabel('Relay upstream host')).not.toBeEditable();
    await page.screenshot({
      path: 'test-results/station-source-form.png',
      fullPage: true
    });
    await form.getByRole('button', { name: 'Hủy' }).click();

    await page.goto('/ntrip-accounts');
    const accountRow = page.locator('tbody tr').first();
    if (await accountRow.count()) {
      await accountRow.click();
      const accountDetail = page.getByRole('dialog');
      await expect(accountDetail.getByText('Công ty', { exact: true })).toBeVisible();
      await expect(accountDetail.getByText('Hiệu lực', { exact: true })).toBeVisible();
      await expect(accountDetail.getByText('Auth method', { exact: true })).toBeVisible();
      await accountDetail.getByRole('button', { name: 'Đóng' }).last().click();
    }

    await page.goto('/mountpoints');
    const mountpointRow = page.locator('tbody tr').first();
    if (await mountpointRow.count()) {
      await mountpointRow.click();
      const mountpointDetail = page.getByRole('dialog');
      await expect(mountpointDetail.getByText('Position mode', { exact: true })).toBeVisible();
      await expect(mountpointDetail.getByText('Caster interval', { exact: true })).toBeVisible();
      await expect(
        mountpointDetail.getByText('Code protocol/type', { exact: true })
      ).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});
