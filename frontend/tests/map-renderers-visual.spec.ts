import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const evidenceDir = resolve(process.cwd(), '../docs/1/evidence');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('superadmin');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function setRenderer(page: Page, renderer: 'leaflet' | 'maplibre') {
  await page.goto('/system/map-config');
  const field = page.locator('.field', { hasText: 'Renderer' }).first();
  await field.locator('select').selectOption(renderer);
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.getByText('Đã lưu cấu hình bản đồ')).toBeVisible();
}

test.describe('ảnh minh chứng 2 renderer', () => {
  test.skip(!password, 'E2E_PASSWORD is required');
  test.setTimeout(90_000);

  test.afterEach(async ({ page }) => {
    try {
      await setRenderer(page, 'leaflet');
    } catch {
      // Test chính đã thất bại trước khi đăng nhập.
    }
  });

  test('Leaflet + MapLibre cùng hiển thị bản đồ và polygon tỉnh', async ({ page }) => {
    mkdirSync(evidenceDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    await setRenderer(page, 'leaflet');
    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    const legend = page.getByRole('button', { name: 'Chú giải' });
    if ((await legend.getAttribute('aria-pressed')) === 'true') await legend.click();
    await page.evaluate(() => {
      (window as unknown as { __leafletMap?: { setView: (c: number[], z: number) => void } })
        .__leafletMap?.setView([16, 106], 6.2);
    });
    await expect(page.locator('.map-province-label').first()).toBeVisible();
    expect(await page.locator('.map-province-label').count()).toBeGreaterThanOrEqual(30);
    expect(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThanOrEqual(30);
    await page.screenshot({ path: resolve(evidenceDir, 'plan16-map-leaflet.png') });

    await setRenderer(page, 'maplibre');
    await page.goto('/map');
    await expect(page.locator('.maplibre-canvas')).toBeVisible();
    await page.waitForFunction(
      () => {
        const map = (
          window as unknown as {
            __map?: {
              loaded: () => boolean;
              isStyleLoaded: () => boolean;
              getLayer: (id: string) => unknown;
            };
          }
        ).__map;
        return Boolean(map && map.loaded() && map.isStyleLoaded() && map.getLayer('provinces-line'));
      },
      undefined,
      { timeout: 30_000 }
    );
    await page.evaluate(() => {
      (
        window as unknown as { __map?: { jumpTo: (options: unknown) => void } }
      ).__map?.jumpTo({ center: [106, 16], zoom: 6.2 });
    });
    const legendButton = page.getByRole('button', { name: 'Chú giải' });
    if ((await legendButton.getAttribute('aria-pressed')) === 'true') await legendButton.click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = (window as unknown as { __map?: { once: (e: string, cb: () => void) => void } })
            .__map;
          if (!map) {
            resolve();
            return;
          }
          const timer = setTimeout(resolve, 4000);
          map.once('idle', () => {
            clearTimeout(timer);
            resolve();
          });
        })
    );
    await page.waitForFunction(
      () => {
        const map = (
          window as unknown as {
            __map?: { queryRenderedFeatures: (options: unknown) => unknown[] };
          }
        ).__map;
        return Boolean(map && map.queryRenderedFeatures({ layers: ['stations-layer'] }).length > 0);
      },
      undefined,
      { timeout: 20_000 }
    );
    await expect(page.locator('.map-province-label').first()).toBeVisible();
    expect(await page.locator('.map-province-label').count()).toBeGreaterThanOrEqual(30);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(evidenceDir, 'plan16-map-maplibre.png') });
  });
});
