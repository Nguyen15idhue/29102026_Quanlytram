import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '..');
const root = path.resolve(frontendDir, '..');
const shotDir = path.join(root, 'docs-site', 'static', 'img', 'docs');
const inventoryDir = path.join(root, 'docs-site', 'generated');
const baseURL = process.env.DOCS_BASE_URL || 'http://127.0.0.1:3000';

function readEnv() {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const env = readEnv();
const accounts = {
  admin: {
    username: 'docs.admin',
    password: process.env.DOCS_ADMIN_PASSWORD || env.SEED_ADMIN_PASSWORD
  },
  user: {
    username: 'docs.user',
    password: process.env.DOCS_USER_PASSWORD || env.SEED_USER_PASSWORD
  }
};

if (!accounts.admin.password || !accounts.user.password) {
  console.error('LỖI: thiếu mật khẩu tài khoản minh họa (SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD).');
  process.exit(1);
}

const MASK_CSS = `
  time, .realtime, [data-docs-mask] { visibility: hidden !important; }
  .toast, .toast-region, [data-toast] { display: none !important; }
  .health-facts dd, .health-card dd, .health-card .mono, .health-card strong { visibility: hidden !important; }
  .entity-status-time .mono { visibility: hidden !important; }
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

const FIXED_NOW = new Date('2026-11-01T05:00:00Z');

function freezeClock() {
  const fixed = FIXED_NOW.getTime();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  Object.setPrototypeOf(FakeDate, RealDate);
  window.Date = FakeDate;
}

const shots = [
  { id: 'dashboard', area: 'dashboard', path: '/', role: 'admin', theme: 'light' },
  { id: 'dashboard', area: 'dashboard', path: '/', role: 'admin', theme: 'dark' },
  { id: 'list', area: 'stations', path: '/stations', role: 'admin', theme: 'light', search: 'DOCS' },
  {
    id: 'detail-overview',
    area: 'stations',
    path: '/stations/:stationId',
    role: 'admin',
    theme: 'light'
  },
  {
    id: 'detail-quality',
    area: 'stations',
    path: '/stations/:stationId?tab=quality',
    role: 'admin',
    theme: 'light'
  },
  { id: 'form', area: 'stations', path: '/stations', role: 'admin', theme: 'light', dialog: 'Thêm trạm', search: 'DOCS' },
  { id: 'map', area: 'map', path: '/map?layer=stations', role: 'admin', theme: 'light' },
  { id: 'drawer', area: 'map', path: '/map?layer=stations&station=:stationId', role: 'admin', theme: 'light' },
  { id: 'list', area: 'mountpoints', path: '/mountpoints', role: 'admin', theme: 'light', search: 'DOCS' },
  { id: 'list', area: 'caster', path: '/caster', role: 'admin', theme: 'light' },
  { id: 'list', area: 'ntrip', path: '/ntrip-accounts', role: 'admin', theme: 'light', search: 'docs_' },
  { id: 'form', area: 'ntrip', path: '/ntrip-accounts', role: 'admin', theme: 'light', dialog: 'Thêm tài khoản' },
  {
    id: 'list',
    area: 'relay',
    path: '/relay-jobs',
    role: 'admin',
    theme: 'light',
    search: 'DOCS',
    mask: 'th:nth-child(7), th:nth-child(8), td:nth-child(7), td:nth-child(8) { visibility: hidden !important; }'
  },
  { id: 'form', area: 'relay', path: '/relay-jobs', role: 'admin', theme: 'light', dialog: 'Thêm relay job' },
  { id: 'list', area: 'alerts', path: '/alerts', role: 'admin', theme: 'light' },
  { id: 'list', area: 'history', path: '/history', role: 'admin', theme: 'light' },
  { id: 'health', area: 'system', path: '/system', role: 'admin', theme: 'light' },
  { id: 'map-config', area: 'system', path: '/system/map-config', role: 'admin', theme: 'light' },
  { id: 'list', area: 'roles', path: '/roles', role: 'admin', theme: 'light' },
  {
    id: 'list',
    area: 'users',
    path: '/web-users',
    role: 'admin',
    theme: 'light',
    mask: 'th:nth-child(7), td:nth-child(7) { visibility: hidden !important; }'
  },
  {
    id: 'profile',
    area: 'profile',
    path: '/profile',
    role: 'admin',
    theme: 'light',
    mask: '.facts dd, .data-table tbody { visibility: hidden !important; }'
  },
  { id: 'user-menu', area: 'roles', path: '/', role: 'user', theme: 'light' }
];

function login(page, account) {
  return page.goto(`${baseURL}/login`).then(async () => {
    await page.getByLabel('Tên đăng nhập').fill(account.username);
    await page.getByLabel('Mật khẩu').fill(account.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.waitForSelector('.nav-group', { timeout: 20000 });
  });
}

async function waitReady(page) {
  await page.waitForSelector('.content', { timeout: 20000 });
  await page
    .waitForFunction(() => !document.querySelector('.page-loading'), null, { timeout: 15000 })
    .catch(() => {});
  await page
    .waitForFunction(() => !document.querySelector('.skeleton-row'), null, { timeout: 15000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(700);
}

async function setTheme(page, theme) {
  const current = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (current === theme) return;
  await page.getByRole('button', { name: /Chuyển giao diện/ }).click();
  await page.waitForTimeout(250);
}

async function collectInventory(page, route, role) {
  return page.evaluate(
    ({ route, role }) => ({
      route,
      role,
      headings: [...document.querySelectorAll('.content h1, .content h2, .content h3')]
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
        .slice(0, 40),
      fields: [...document.querySelectorAll('.content [role="dialog"] label, .content .field-label')]
        .map((node) => node.textContent?.trim())
        .filter(Boolean),
      buttons: [...document.querySelectorAll('.content button, .content [role="dialog"] button')]
        .map((node) => node.textContent?.trim())
        .filter(Boolean),
      tableColumns: [...document.querySelectorAll('.content thead th')]
        .map((node) => node.textContent?.trim())
        .filter(Boolean),
      tabs: [...document.querySelectorAll('.content [role="tab"]')]
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
    }),
    { route, role }
  );
}

async function main() {
  fs.mkdirSync(shotDir, { recursive: true });
  fs.mkdirSync(inventoryDir, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = new Map();
  const inventory = [];
  const failures = [];
  const hashes = new Map();

  async function contextFor(role) {
    if (!contexts.has(role)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript(freezeClock);
      const page = await context.newPage();
      await login(page, accounts[role]);
      contexts.set(role, page);
    }
    return contexts.get(role);
  }

  const loginContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginContext.addInitScript(freezeClock);
  const loginPage = await loginContext.newPage();
  await loginPage.goto(`${baseURL}/login`);
  await loginPage.waitForSelector('.login-card');
  await loginPage.addStyleTag({ content: MASK_CSS });
  const loginFile = path.join(shotDir, 'auth', 'login-light.png');
  fs.mkdirSync(path.dirname(loginFile), { recursive: true });
  await loginPage.screenshot({ path: loginFile });
  hashes.set(path.relative(shotDir, loginFile), crypto.createHash('sha256').update(fs.readFileSync(loginFile)).digest('hex'));
  await loginContext.close();

  const adminPage = await contextFor('admin');
  const stationsResponse = await adminPage.request.get(`${baseURL}/api/stations?page=1&pageSize=5&search=DOCS`);
  const stationsJson = await stationsResponse.json();
  const station = stationsJson.items?.[0];
  if (!station) throw new Error('Không có trạm DOCS để chụp; chạy seed trước.');

  for (const shot of shots) {
    const page = await contextFor(shot.role);
    try {
      const route = shot.path
        .replace(':stationId', String(station.id))
        .replace('/stations/:stationId', `/stations/${station.id}`);
      await page.goto(`${baseURL}${route}`);
      await waitReady(page);
      if (await page.locator('[role="dialog"]').count()) {
        await page
          .waitForFunction(
            () => !(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Đang tải'),
            null,
            { timeout: 20000 }
          )
          .catch(() => {});
        await page.waitForTimeout(600);
      }
      await page.addStyleTag({ content: `${MASK_CSS}\n${shot.mask ?? ''}` });
      await setTheme(page, shot.theme);

      if (shot.search) {
        const search = page.locator('.content input[type="search"], .content input[placeholder*="Tìm"]').first();
        if (await search.count()) {
          await search.fill(shot.search);
          await page.waitForTimeout(900);
        }
      }

      if (shot.dialog) {
        const button = page.getByRole('button', { name: shot.dialog, exact: true });
        if (await button.count()) {
          await button.first().click();
          await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
          await page
            .waitForFunction(
              () => !document.querySelector('[role="dialog"] .table-state, [role="dialog"] .spinner'),
              null,
              { timeout: 8000 }
            )
            .catch(() => {});
          await page.waitForTimeout(1400);
        } else {
          throw new Error(`không thấy nút "${shot.dialog}"`);
        }
      }

      inventory.push(await collectInventory(page, route, shot.role));

      const file = path.join(shotDir, shot.area, `${shot.id}-${shot.theme}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (shot.dialog) {
        await page.locator('[role="dialog"]').screenshot({ path: file });
      } else {
        await page.screenshot({ path: file });
      }
      hashes.set(
        path.relative(shotDir, file),
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      );
      console.log(`OK ${path.relative(root, file)}`);

      if (shot.dialog) await page.keyboard.press('Escape');
    } catch (error) {
      failures.push(`${shot.area}/${shot.id}: ${error.message}`);
      console.error(`LỖI ${shot.area}/${shot.id}: ${error.message}`);
    }
  }

  await browser.close();

  const inventoryFile = path.join(inventoryDir, 'ui-inventory.json');
  fs.writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2), 'utf8');
  const hashFile = path.join(inventoryDir, 'shot-hashes.json');
  fs.writeFileSync(hashFile, JSON.stringify([...hashes].sort(), null, 2), 'utf8');

  console.log(`\nĐã chụp ${hashes.size} ảnh, ${inventory.length} trang inventory.`);
  console.log(`Inventory: ${path.relative(root, inventoryFile)}`);
  if (failures.length) {
    console.error(`\n${failures.length} ảnh lỗi:`);
    for (const item of failures) console.error(`  - ${item}`);
    process.exit(1);
  }
}

await main();

