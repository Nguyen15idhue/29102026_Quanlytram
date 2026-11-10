import { beforeEach, describe, expect, it } from 'vitest';
import { MODE_PROVIDERS } from '../src/lib/mapConfig';
import {
  noteProviderFailure,
  providerUsable,
  resetTileProviderState
} from '../src/lib/tileProxy';

describe('Plan 20 - provider tile', () => {
  beforeEach(() => {
    resetTileProviderState();
  });

  it('streets dùng OSM.fr làm chính và OSM.de làm dự phòng', () => {
    const streets = MODE_PROVIDERS.streets;
    expect(streets.provider).toBe('osm-fr');
    expect(streets.template).toContain('openstreetmap.fr');
    expect(streets.fallbackTemplate).toContain('openstreetmap.de');
  });

  it('sau 3 lần lỗi liên tiếp thì tạm bỏ provider 10 phút', () => {
    const now = 1_000_000;
    expect(providerUsable('osm-fr', now)).toBe(true);
    noteProviderFailure('osm-fr', now);
    noteProviderFailure('osm-fr', now);
    expect(providerUsable('osm-fr', now + 1000)).toBe(true);
    noteProviderFailure('osm-fr', now);
    expect(providerUsable('osm-fr', now + 1000)).toBe(false);
    expect(providerUsable('osm-fr', now + 10 * 60_000 + 1)).toBe(true);
  });

  it('resetTileProviderState khôi phục trạng thái ban đầu', () => {
    const now = 2_000_000;
    noteProviderFailure('osm-fr', now);
    noteProviderFailure('osm-fr', now);
    noteProviderFailure('osm-fr', now);
    resetTileProviderState();
    expect(providerUsable('osm-fr', now)).toBe(true);
  });
});
