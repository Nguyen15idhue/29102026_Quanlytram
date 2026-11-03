import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * Nạp `.env.local` ở gốc repo rồi map sang biến E2E_* để `npx playwright test`
 * chạy được mà không phải export tay. Không ghi giá trị ra log/repo.
 */
function loadLocalEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = resolve(root, '.env.local');
  const values: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  const aliases: Array<[string, string]> = [
    ['E2E_PASSWORD', 'SEED_SUPERADMIN_PASSWORD'],
    ['E2E_USER_PASSWORD', 'SEED_USER_PASSWORD'],
    ['E2E_ADMIN_PASSWORD', 'SEED_ADMIN_PASSWORD'],
    ['E2E_DOCS_ADMIN_PASSWORD', 'SEED_ADMIN_PASSWORD'],
    ['E2E_DOCS_USER_PASSWORD', 'SEED_USER_PASSWORD']
  ];
  for (const [target, source] of aliases) {
    if (process.env[target]) continue;
    const value = values[source] ?? values[target];
    if (value) process.env[target] = value;
  }
  // `admin` là tài khoản có mật khẩu do người vận hành đổi; `docs.admin` dùng
  // đúng SEED_ADMIN_PASSWORD và cùng role admin nên dùng làm tài khoản admin
  // mặc định cho test (override bằng E2E_ADMIN_USERNAME nếu cần).
  if (!process.env.E2E_ADMIN_USERNAME && process.env.E2E_ADMIN_PASSWORD) {
    process.env.E2E_ADMIN_USERNAME = 'docs.admin';
  }
}

loadLocalEnv();

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
