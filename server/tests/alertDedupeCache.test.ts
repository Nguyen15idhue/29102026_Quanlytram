import { beforeEach, describe, expect, it } from 'vitest';
import {
  rememberAlert,
  resetAlertDedupeCache,
  shouldSkipAlert
} from '../src/lib/alerts';

describe('Plan 20 - dedupe cảnh báo trong RAM', () => {
  beforeEach(() => {
    resetAlertDedupeCache();
  });

  it('bỏ qua cùng dedupe_key trong thời gian cooldown', () => {
    const now = 1_000_000;
    rememberAlert('relay:1:error', now, 5);
    expect(shouldSkipAlert('relay:1:error', now + 1000)).toBe(true);
    expect(shouldSkipAlert('relay:1:error', now + 5 * 60_000 + 1)).toBe(false);
  });

  it('khoá khác nhau không bị ảnh hưởng', () => {
    const now = 2_000_000;
    rememberAlert('relay:1:error', now, 5);
    expect(shouldSkipAlert('relay:2:error', now + 1000)).toBe(false);
  });

  it('resetAlertDedupeCache xoá toàn bộ trạng thái', () => {
    rememberAlert('system:go_unavailable', 3_000_000, 5);
    resetAlertDedupeCache();
    expect(shouldSkipAlert('system:go_unavailable', 3_000_001)).toBe(false);
  });
});
