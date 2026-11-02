import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock('../src/db/pool', () => ({ query: mocks.query }));

import { getMapConfig, invalidateMapConfigCache } from '../src/lib/mapConfig';

describe('getMapConfig cache', () => {
  beforeEach(() => {
    invalidateMapConfigCache();
    mocks.query.mockReset();
    mocks.query.mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    invalidateMapConfigCache();
  });

  it('serves twenty calls from one query', async () => {
    for (let index = 0; index < 20; index++) {
      await getMapConfig();
    }
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight query between concurrent callers', async () => {
    await Promise.all([getMapConfig(), getMapConfig(), getMapConfig()]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('reloads after the ttl and after invalidation', async () => {
    await getMapConfig();
    vi.setSystemTime(new Date('2026-11-02T00:00:46.000Z'));
    await getMapConfig();
    expect(mocks.query).toHaveBeenCalledTimes(2);

    invalidateMapConfigCache();
    await getMapConfig();
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });
});
