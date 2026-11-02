import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  callGo: vi.fn()
}));

vi.mock('../src/db/pool', () => ({ query: mocks.query }));
vi.mock('../src/lib/internalApi', () => ({ callGoInternal: mocks.callGo }));

import { invalidateBaseDataCache, loadBaseData } from '../src/realtime/data';

describe('loadBaseData cache', () => {
  beforeEach(() => {
    invalidateBaseDataCache();
    mocks.query.mockReset();
    mocks.callGo.mockReset();
    mocks.query.mockResolvedValue([]);
    mocks.callGo.mockResolvedValue({ items: [] });
  });

  it('serves repeated callers from cache within TTL', async () => {
    const first = await loadBaseData();
    const second = await loadBaseData();
    expect(second).toBe(first);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.callGo).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const [a, b] = await Promise.all([loadBaseData(), loadBaseData()]);
    expect(a).toBe(b);
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });

  it('reloads when the cache is invalidated', async () => {
    await loadBaseData();
    invalidateBaseDataCache();
    await loadBaseData();
    expect(mocks.query).toHaveBeenCalledTimes(8);
  });
});
