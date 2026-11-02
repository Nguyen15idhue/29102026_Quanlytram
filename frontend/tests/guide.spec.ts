import { expect, test, type Page } from '@playwright/test';

const superPassword = process.env.E2E_PASSWORD ?? '';
const userPassword = process.env.E2E_DOCS_USER_PASSWORD ?? process.env.SEED_USER_PASSWORD ?? '';
const adminPassword = process.env.E2E_DOCS_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? '';

const GUIDE_IFRAME = 'iframe[title="Hướng dẫn sử dụng"]';

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function openGuide(page: Page) {
  await page.getByRole('link', { name: 'Hướng dẫn sử dụng' }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.locator(GUIDE_IFRAME)).toBeVisible();
  return page.frameLocator(GUIDE_IFRAME);
}

test.describe('Trang hướng dẫn', () => {
  test.skip(!superPassword, 'E2E_PASSWORD là bắt buộc');

  test('G1 — menu Hướng dẫn nằm giữa Relay và Hệ thống', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);

    const groups = await page.locator('.nav-group-label').allTextContents();
    expect(groups).toEqual([
      'Tổng quan',
      'Trạm',
      'Bản đồ',
      'CORS',
      'Tài khoản',
      'Relay',
      'Hướng dẫn',
      'Hệ thống'
    ]);
    await expect(page.locator('.nav-group-highlight .nav-item')).toHaveCount(1);
    await expect(page.locator('.nav-group-highlight .nav-item')).toContainText('Hướng dẫn sử dụng');
  });

  test('G2 — mở /guide, đúng tiêu đề và iframe', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);
    await openGuide(page);

    await expect(page.locator('.topbar-left strong')).toHaveText('Hướng dẫn sử dụng');
    await expect(page.locator(GUIDE_IFRAME)).toHaveAttribute('title', 'Hướng dẫn sử dụng');
    await expect(page.getByRole('link', { name: 'Hướng dẫn sử dụng' })).toHaveClass(/active/);
  });

  test('G3 — tài liệu tải đủ chương và tiêu đề chương đầu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);
    const frame = await openGuide(page);

    await expect(frame.getByRole('heading', { name: 'Giới thiệu hệ thống', level: 1 })).toBeVisible();
    const links = await frame.locator('.theme-doc-sidebar-menu .menu__link').count();
    expect(links).toBeGreaterThanOrEqual(13);
    await expect(
      frame.locator('.theme-doc-sidebar-menu .menu__link', { hasText: 'Relay' }).first()
    ).toBeVisible();
  });

  test('G4 — tìm kiếm trong tài liệu trả kết quả', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);
    const frame = await openGuide(page);

    const search = frame.locator('input[type="search"], .navbar__search-input').first();
    await expect(search).toBeVisible();
    await search.fill('mountpoint');
    await expect(frame.locator('[class*="dropdownMenu"] [role="option"]').first()).toBeVisible({
      timeout: 15000
    });
  });

  test('G5 — cả ba vai trò đều thấy mục Hướng dẫn', async ({ browser }) => {
    const accounts = [
      { username: 'superadmin', password: superPassword },
      { username: 'docs.admin', password: adminPassword },
      { username: 'docs.user', password: userPassword }
    ];

    for (const account of accounts) {
      expect(account.password, `thiếu mật khẩu cho ${account.username}`).not.toBe('');
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await login(page, account.username, account.password);
      await expect(
        page.getByRole('link', { name: 'Hướng dẫn sử dụng' }),
        `vai trò ${account.username} không thấy mục Hướng dẫn`
      ).toBeVisible();
      await context.close();
    }
  });

  test('G6 — ảnh minh họa tải được, không 404', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);
    const frame = await openGuide(page);

    await frame.getByRole('link', { name: 'Trạm', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Trạm', level: 1 })).toBeVisible();

    const sources = await frame
      .locator('img')
      .evaluateAll((images) =>
        images.map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src)
      );
    expect(sources.length).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const source of sources) {
      const response = await page.request.get(source);
      if (!response.ok()) broken.push(`${source} (${response.status()})`);
    }
    expect(broken, `ảnh lỗi: ${broken.join(', ')}`).toEqual([]);
  });

  test('G7 — mobile 390 mở được hướng dẫn, không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'superadmin', superPassword);

    await page.getByRole('button', { name: 'Mở menu' }).click();
    const frame = await openGuide(page);
    await expect(frame.getByRole('heading', { name: 'Giới thiệu hệ thống', level: 1 })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('G8 — không có lỗi console/pageerror khi dùng hướng dẫn', async ({ page }) => {
    const errors: string[] = [];
    const guideFailures: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (message.text().includes('Failed to load resource')) return;
      errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.url().includes('/guide/') && response.status() >= 400) {
        guideFailures.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'superadmin', superPassword);
    const frame = await openGuide(page);
    await frame.getByRole('heading', { name: 'Giới thiệu hệ thống', level: 1 }).waitFor();
    await page.waitForTimeout(800);

    expect(guideFailures, `tài nguyên lỗi: ${guideFailures.join(', ')}`).toEqual([]);
    expect(errors).toEqual([]);
  });
});
