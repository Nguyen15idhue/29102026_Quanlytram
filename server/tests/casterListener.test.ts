import { describe, expect, it } from 'vitest';
import {
  isAllowedCasterPort,
  isListenerEnabled,
  isReservedCasterPort,
  listenerCreateSchema
} from '../src/lib/caster';

describe('caster listener', () => {
  it('cho phép listener mặc định 2101', () => {
    expect(listenerCreateSchema.parse({ name: 'NTRIP 2101', port: 2101 }).port).toBe(2101);
  });

  it('chỉ cho phép 3 port Wally và dải 1510-1599', () => {
    for (const port of [1508, 1509, 2101, 1510, 1599]) {
      expect(isAllowedCasterPort(port)).toBe(true);
    }
    for (const port of [1507, 1600, 1700]) {
      expect(isAllowedCasterPort(port)).toBe(false);
    }
    expect(isReservedCasterPort(1508)).toBe(true);
    expect(isReservedCasterPort(1510)).toBe(false);
  });

  it('vẫn cấm listener 8081', () => {
    expect(() => listenerCreateSchema.parse({ name: 'NTRIP 8081', port: 8081 })).toThrow();
  });

  it('nhận diện listener đang bật để chặn xóa', () => {
    expect(isListenerEnabled({ enabled: 1 })).toBe(true);
    expect(isListenerEnabled({ enabled: true })).toBe(true);
    expect(isListenerEnabled({ enabled: 0 })).toBe(false);
    expect(isListenerEnabled({ enabled: false })).toBe(false);
  });
});
