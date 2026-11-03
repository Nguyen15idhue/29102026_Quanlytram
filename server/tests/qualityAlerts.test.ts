import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callGo: vi.fn()
}));

vi.mock('../src/lib/internalApi', () => ({ callGoInternal: mocks.callGo }));

import { purgeOrphanQualityAlerts, resolveQualityAlerts } from '../src/lib/qualityAlerts';

describe('quality alerts qua internal API của Go', () => {
  beforeEach(() => {
    mocks.callGo.mockReset();
  });

  it('resolve trả số cảnh báo Go đã đóng', async () => {
    mocks.callGo.mockResolvedValue({ resolved: 3 });

    await expect(resolveQualityAlerts('station', 42)).resolves.toBe(3);
    expect(mocks.callGo).toHaveBeenCalledWith(
      '/internal/quality/resolve',
      { targetType: 'station', targetId: 42 },
      { timeoutMs: 3000 }
    );
  });

  it('resolve không chặn xoá khi Go lỗi', async () => {
    mocks.callGo.mockRejectedValue(new Error('internal down'));

    await expect(resolveQualityAlerts('relay_job', 7)).resolves.toBe(0);
  });

  it('purge gọi đúng endpoint và trả số dòng', async () => {
    mocks.callGo.mockResolvedValue({ resolved: 5 });

    await expect(purgeOrphanQualityAlerts()).resolves.toBe(5);
    expect(mocks.callGo).toHaveBeenCalledWith(
      '/internal/quality/purge-orphans',
      undefined,
      { timeoutMs: 5000 }
    );
  });
});
