import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const root = path.resolve(process.cwd(), '..');
const mockExe = path.join(process.env.TEMP ?? root, 'cors-mock-ntrip-ui-test.exe');

async function login(context: APIRequestContext) {
  const response = await context.post('/api/auth/login', {
    data: { username: 'superadmin', password }
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function poll<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 15_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('poll timeout');
}

test.describe('Station metrics realtime', () => {
  test.skip(!password, 'E2E_PASSWORD is required');
  test.setTimeout(90_000);

  test('offline zeroes live metrics and reconnect resets session', async ({ page }) => {
    execFileSync('go', ['build', '-o', mockExe, '.'], {
      cwd: path.join(root, 'scripts', 'mock-ntrip'),
      stdio: 'ignore'
    });

    let push: ChildProcess | null = null;
    let stationId: number | null = null;
    try {
      await page.goto('/login');
      await page.getByLabel('Tên đăng nhập').fill('superadmin');
      await page.getByLabel('Mật khẩu').fill(password);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

      const me = await (await page.request.get('/api/auth/me')).json();
      const headers = { 'X-CSRF-Token': me.csrfToken };
      const listeners = await (
        await page.request.get('/api/caster/listeners?page=1&pageSize=20')
      ).json();
      const listener = listeners.items.find((item: { port: number }) => item.port === 1509);
      const suffix = Date.now();
      const username = `metrics_${suffix}`;
      const secret = 'MetricsTest123!';
      const created = await page.request.post('/api/stations', {
        headers,
        data: {
          name: `Metrics Station ${suffix}`,
          port: listener.port,
          source_role: 'ntrip_caster',
          caster_listener_id: listener.id,
          caster_username: username,
          caster_password: secret,
          enabled: true
        }
      });
      expect(created.status()).toBe(201);
      const station = (await created.json()).item;
      stationId = station.id;
      const mountpoint = station.mountpoint_name;

      const startSource = () =>
        spawn(
          mockExe,
          [
            '-mode',
            'push',
            '-addr',
            '127.0.0.1:1509',
            '-mount',
            mountpoint,
            '-user',
            username,
            '-pass',
            secret,
            '-fixture',
            'scripts/fixtures/rtcm3-msm.hex',
            '-repeat',
            '-delay',
            '50ms',
            '-timeout',
            '2m'
          ],
          { cwd: root, stdio: 'ignore' }
        );

      push = startSource();
      const online = await poll(async () => {
        const quality = await (
          await page.request.get(`/api/stations/${stationId}/quality?window=5`)
        ).json();
        const live = quality.live?.[0];
        if (live?.state !== 'streaming') return null;
        return live;
      });
      expect(online.satellites).toBeGreaterThan(0);
      expect(online.score).toBeGreaterThan(0);
      const firstFrames = online.frames;

      await page.goto(`/stations/${stationId}`);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('online', { exact: true }).first()).toBeVisible();

      push.kill('SIGTERM');
      push = null;
      const offline = await poll(async () => {
        const detail = await (await page.request.get(`/api/stations/${stationId}`)).json();
        if (detail.item?.transportStatus !== 'offline') return null;
        const quality = await (
          await page.request.get(`/api/stations/${stationId}/quality?window=5`)
        ).json();
        const live = quality.live?.[0];
        if (!live || live.satellites !== 0 || live.score !== 0) return null;
        return live;
      });
      expect(offline.satellites).toBe(0);
      expect(offline.score).toBe(0);

      await page.reload();
      await expect(
        page.getByRole('dialog').getByText('offline', { exact: true }).first()
      ).toBeVisible();

      await new Promise((resolve) => setTimeout(resolve, 11_000));
      push = startSource();
      const reconnected = await poll(async () => {
        const quality = await (
          await page.request.get(`/api/stations/${stationId}/quality?window=5`)
        ).json();
        const live = quality.live?.[0];
        if (live?.state !== 'streaming' || live.satellites === 0) return null;
        return live;
      });
      expect(reconnected.frames).toBe(firstFrames);
      expect(reconnected.satellites).toBeGreaterThan(0);

      await page.reload();
      await expect(
        page.getByRole('dialog').getByText('online', { exact: true }).first()
      ).toBeVisible();
    } finally {
      if (push) push.kill('SIGTERM');
      if (stationId) {
        const me = await (await page.request.get('/api/auth/me')).json();
        const headers = { 'X-CSRF-Token': me.csrfToken };
        await page.request.post(`/api/stations/${stationId}/disable`, { headers });
        await page.request.delete(`/api/stations/${stationId}`, { headers });
      }
    }
  });
});

test.describe('Relay metrics realtime', () => {
  test.skip(!password, 'E2E_PASSWORD is required');
  test.setTimeout(60_000);

  test('online only when both source and destination receive data; lock nulls status', async ({ page }) => {
    execFileSync('go', ['build', '-o', mockExe, '.'], {
      cwd: path.join(root, 'scripts', 'mock-ntrip'),
      stdio: 'ignore'
    });
    let mock: ChildProcess | null = null;
    let jobId: number | null = null;
    try {
      await page.goto('/login');
      await page.getByLabel('Tên đăng nhập').fill('superadmin');
      await page.getByLabel('Mật khẩu').fill(password);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      const me = await (await page.request.get('/api/auth/me')).json();
      const headers = { 'X-CSRF-Token': me.csrfToken };

      mock = spawn(
        mockExe,
        [
          '-mode',
          'caster',
          '-addr',
          '0.0.0.0:2102',
          '-fixture',
          'scripts/fixtures/rtcm3-msm.hex',
          '-chunked',
          '-fragment',
          '64',
          '-repeat',
          '-delay',
          '50ms'
        ],
        { cwd: root, stdio: 'ignore' }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const suffix = Date.now();
      const created = await page.request.post('/api/relay-jobs', {
        headers,
        data: {
          externalKey: `metrics-relay-${suffix}`,
          name: `Metrics Relay ${suffix}`,
          enabled: true,
          upstream: {
            host: 'host.docker.internal',
            port: 2102,
            mount: `UP_${suffix}`,
            ntripVersion: 'v2'
          },
          downstream: {
            host: 'host.docker.internal',
            port: 2102,
            mount: `DOWN_${suffix}`,
            ntripVersion: 'v2'
          },
          downstreamMode: 'source'
        }
      });
      expect(created.status()).toBe(201);
      jobId = (await created.json()).item.id;

      const status = await poll(async () => {
        const data = await (await page.request.get(`/api/relay-jobs/${jobId}/status`)).json();
        if (data.item?.streamStatus !== 'online') return null;
        return data;
      });
      expect(status.item.metrics.bytesUp).toBeGreaterThan(0);
      expect(status.item.metrics.bytesDown).toBeGreaterThan(0);
      expect(status.dataUptime).toBeTruthy();

      await page.goto(`/relay-jobs?job=${jobId}`);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const relayStatus = dialog.locator('.entity-status');
      await expect(relayStatus).toContainText('Nguồn');
      await expect(relayStatus).toContainText('Đích');
      await expect(relayStatus).toContainText('online');
      await expect(dialog.getByRole('tab', { name: 'Dữ liệu' })).toBeVisible();
      await expect(dialog.getByRole('tab', { name: 'Chất lượng' })).toBeVisible();
      await expect(dialog.getByRole('tab', { name: 'Lịch sử' })).toBeVisible();
      await dialog.getByRole('tab', { name: 'Dữ liệu' }).click();
      const timeline = dialog.locator('.entity-timeline');
      await expect(timeline).toBeVisible();
      await expect(timeline).toContainText('Tỷ lệ online');
      await expect(dialog.getByText('Luồng')).toBeVisible();
      await expect(dialog.getByLabel('Chọn luồng dữ liệu')).toHaveValue('upstream');

      await page.request.post(`/api/relay-jobs/${jobId}/disable`, { headers });
      const disabled = await (
        await page.request.get(`/api/relay-jobs/${jobId}/status`)
      ).json();
      expect(disabled.item.streamStatus).toBe('offline');
      await page.request.post(`/api/relay-jobs/${jobId}/lock`, { headers });
      const locked = await (
        await page.request.get(`/api/relay-jobs/${jobId}/status`)
      ).json();
      expect(locked.item.locked).toBe(true);
      expect(locked.item.streamStatus).toBeNull();
    } finally {
      if (mock) mock.kill('SIGTERM');
      if (jobId) {
        const me = await (await page.request.get('/api/auth/me')).json();
        const headers = { 'X-CSRF-Token': me.csrfToken };
        await page.request.post(`/api/relay-jobs/${jobId}/unlock`, { headers });
        await page.request.delete(`/api/relay-jobs/${jobId}`, { headers });
      }
    }
  });
});