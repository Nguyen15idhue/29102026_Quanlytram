import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeQuery = vi.fn();

vi.mock('../src/db/runtimePool', () => ({
  runtimeQuery: (...args: unknown[]) => runtimeQuery(...args)
}));

const { clearLatestSampleCache, loadLatestSamples } = await import(
  '../src/lib/latestSample'
);

describe('Plan 20 - cache mẫu mới nhất', () => {
  beforeEach(() => {
    clearLatestSampleCache();
    runtimeQuery.mockReset();
    runtimeQuery.mockResolvedValue([
      { target_id: 1, mountpoint_id: 1, score: 90, state: 'streaming' }
    ]);
  });

  it('gộp nhiều lần đọc cùng danh sách trong 2 giây thành 1 query', async () => {
    await loadLatestSamples({ targetType: 'station', ids: [1] });
    await loadLatestSamples({ targetType: 'station', ids: [1] });
    expect(runtimeQuery).toHaveBeenCalledTimes(1);
  });

  it('không dùng chung cache giữa hướng khác nhau', async () => {
    await loadLatestSamples({ targetType: 'station', ids: [1], direction: 'ingest' });
    await loadLatestSamples({
      targetType: 'station',
      ids: [1],
      direction: 'ingest',
      by: 'mountpoint'
    });
    expect(runtimeQuery).toHaveBeenCalledTimes(2);
  });

  it('clearLatestSampleCache buộc đọc lại', async () => {
    await loadLatestSamples({ targetType: 'station', ids: [1] });
    clearLatestSampleCache();
    await loadLatestSamples({ targetType: 'station', ids: [1] });
    expect(runtimeQuery).toHaveBeenCalledTimes(2);
  });
});
