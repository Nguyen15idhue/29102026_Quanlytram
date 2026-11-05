import { describe, expect, it } from 'vitest';
import { aggregateFixStatus, normalizeFixType } from '../src/lib/mapAccountStatus';

describe('map account fix status', () => {
  it('normalizes known fix types', () => {
    for (const value of ['single', 'fixed', 'float', 'rtd', 'error']) {
      expect(normalizeFixType(value)).toBe(value);
      expect(normalizeFixType(value.toUpperCase())).toBe(value);
    }
  });

  it('phân biệt chưa gửi GGA với lỗi thật', () => {
    expect(normalizeFixType(undefined)).toBe('none');
    expect(normalizeFixType('')).toBe('none');
    expect(normalizeFixType('   ')).toBe('none');
    expect(normalizeFixType('dgps')).toBe('error');
  });

  it('aggregates by best accuracy: fixed > float > rtd > single > error > none', () => {
    expect(aggregateFixStatus(['none', 'error', 'single', 'fixed'])).toBe('fixed');
    expect(aggregateFixStatus(['none', 'error', 'single', 'float'])).toBe('float');
    expect(aggregateFixStatus(['none', 'error', 'single', 'rtd'])).toBe('rtd');
    expect(aggregateFixStatus(['none', 'error', 'single'])).toBe('single');
    expect(aggregateFixStatus(['none', 'error'])).toBe('error');
    expect(aggregateFixStatus(['none'])).toBe('none');
    expect(aggregateFixStatus([])).toBeNull();
  });
});
