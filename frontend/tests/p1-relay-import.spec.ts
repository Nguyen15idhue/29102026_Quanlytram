import { expect, request as api, test, type APIRequestContext } from '@playwright/test';

const password = process.env.E2E_PASSWORD ?? '';
const baseURL = 'http://127.0.0.1:3000';

async function login(context: APIRequestContext) {
  const response = await context.post('/api/auth/login', {
    data: { username: 'superadmin', password }
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('P1.8 relay import JSON', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('dry-run, commit, idempotent và self-loop', async () => {
    const context = await api.newContext({ baseURL });
    const suffix = Date.now();
    let jobId: number | null = null;
    try {
      const auth = await login(context);
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      const name = `E2E Import Relay ${suffix}`;
      const raw = {
        name,
        src_host: 'example.invalid',
        src_port: 1509,
        src_mount: `SRC_${suffix}`,
        dst_host: 'example.invalid',
        dst_port: 1509,
        dst_mount: `DST_${suffix}`,
        enabled: false
      };

      const dry = await context.post('/api/relay-jobs/import', {
        headers,
        data: { data: raw, dryRun: true }
      });
      expect(dry.status()).toBe(200);
      const dryBody = await dry.json();
      expect(dryBody.errors).toEqual([]);
      expect(dryBody.items).toBe(1);
      expect(dryBody.created).toBe(0);

      const before = await (
        await context.get(`/api/relay-jobs?page=1&pageSize=20&q=${encodeURIComponent(name)}`)
      ).json();
      expect(before.total).toBe(0);

      const commit = await context.post('/api/relay-jobs/import', {
        headers,
        data: { data: raw, dryRun: false }
      });
      expect(commit.status()).toBe(200);
      expect((await commit.json()).created).toBe(1);

      const after = await (
        await context.get(`/api/relay-jobs?page=1&pageSize=20&q=${encodeURIComponent(name)}`)
      ).json();
      expect(after.total).toBe(1);
      jobId = after.items[0].id;

      const update = await context.post('/api/relay-jobs/import', {
        headers,
        data: { data: { ...raw, id: jobId, name: `${name} updated` }, dryRun: false }
      });
      expect(update.status()).toBe(200);
      expect((await update.json()).updated).toBe(1);

      const loop = await context.post('/api/relay-jobs/import', {
        headers,
        data: {
          data: {
            name: `Loop ${suffix}`,
            src_host: 'example.invalid',
            src_port: 1509,
            src_mount: 'LOOP',
            dst_host: 'example.invalid',
            dst_port: 1509,
            dst_mount: 'LOOP',
            enabled: true
          },
          dryRun: true
        }
      });
      expect((await loop.json()).errors.length).toBeGreaterThan(0);
    } finally {
      if (jobId !== null) {
        const me = await context.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await context.delete(`/api/relay-jobs/${jobId}`, {
          headers: { 'X-CSRF-Token': csrf }
        });
      }
      await context.dispose();
    }
  });
});
