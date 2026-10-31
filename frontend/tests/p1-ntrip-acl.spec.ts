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

test.describe('P1.7 NTRIP account listener ACL', () => {
  test.skip(!password, 'E2E_PASSWORD is required');

  test('effective mountpoints bị giới hạn bởi listener', async () => {
    const context = await api.newContext({ baseURL });
    const suffix = Date.now();
    const created: Array<{ path: string; id: number }> = [];
    try {
      const auth = await login(context);
      const headers = { 'X-CSRF-Token': auth.csrfToken };
      const mountpointIds: number[] = [];
      for (const label of ['M1', 'M2']) {
        const response = await context.post('/api/mountpoints', {
          headers,
          data: { name: `E2E_ACL_${label}_${suffix}`, enabled: true }
        });
        expect(response.status()).toBe(201);
        const id = (await response.json()).item.id;
        mountpointIds.push(id);
        created.push({ path: 'mountpoints', id });
      }

      const listenerResponse = await context.post('/api/caster/listeners', {
        headers,
        data: {
          name: `E2E ACL Listener ${suffix}`,
          port: 17000 + (suffix % 1000),
          enabled: false,
          mountpointIds: [mountpointIds[0]]
        }
      });
      expect(listenerResponse.status()).toBe(201);
      const listenerId = (await listenerResponse.json()).item.id;
      created.push({ path: 'caster/listeners', id: listenerId });

      const accountResponse = await context.post('/api/ntrip-accounts', {
        headers,
        data: {
          username: `e2e_acl_${suffix}`,
          password: 'Secret123!',
          listenerIds: [listenerId],
          mountpointIds
        }
      });
      expect(accountResponse.status()).toBe(201);
      const accountId = (await accountResponse.json()).item.id;
      created.push({ path: 'ntrip-accounts', id: accountId });

      const listeners = await (
        await context.get(`/api/ntrip-accounts/${accountId}/listeners`)
      ).json();
      expect(listeners.listenerIds).toEqual([listenerId]);
      expect(listeners.effectiveMountpoints).toHaveLength(1);
      expect(listeners.effectiveMountpoints[0].id).toBe(mountpointIds[0]);

      const mountpoints = await (
        await context.get(`/api/ntrip-accounts/${accountId}/mountpoints`)
      ).json();
      expect(mountpoints.items).toHaveLength(1);
      expect(mountpoints.effectiveMountpoints).toHaveLength(1);

      const detail = await (
        await context.get(`/api/ntrip-accounts/${accountId}`)
      ).json();
      expect(detail.item).not.toHaveProperty('authMethod');
      expect(detail.item.listenerIds).toEqual([listenerId]);
      expect(detail.item.effectiveMountpoints).toHaveLength(1);
    } finally {
      for (const item of created.reverse()) {
        const me = await context.get('/api/auth/me');
        const csrf = me.ok() ? (await me.json()).csrfToken : '';
        await context.delete(`/api/${item.path}/${item.id}`, {
          headers: { 'X-CSRF-Token': csrf }
        });
      }
      await context.dispose();
    }
  });
});
