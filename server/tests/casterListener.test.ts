import { describe, expect, it } from 'vitest';
import { isListenerEnabled, listenerCreateSchema } from '../src/lib/caster';

describe('caster listener', () => {
  it('cho phép listener mặc định 2101', () => {
    expect(listenerCreateSchema.parse({ name: 'NTRIP 2101', port: 2101 }).port).toBe(2101);
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
