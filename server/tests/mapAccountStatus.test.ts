import { describe, expect, it } from 'vitest';
import { aggregateFixStatus, normalizeFixType } from '../src/lib/mapAccountStatus';

describe('map account fix status', () => {
  it('normalizes known fix types', () => {
    for (const value of ['single', 'fixed', 'float', 'rtd', 'error']) {
      expect(normalizeFixType(value)).toBe(value);
      expect(normalizeFixType(value.toUpperCase())).toBe(value);
    }
  });

  it('falls back to error for unknown values', () => {
    expect(normalizeFixType(undefined)).toBe('error');
    expect(normalizeFixType('')).toBe('error');
    expect(normalizeFixType('dgps')).toBe('error');
  });

  it('aggregates by best accuracy: fixed > float > rtd > single > error', () => {
    expect(aggregateFixStatus(['error', 'single', 'fixed'])).toBe('fixed');
    expect(aggregateFixStatus(['error', 'single', 'float'])).toBe('float');
    expect(aggregateFixStatus(['error', 'single', 'rtd'])).toBe('rtd');
    expect(aggregateFixStatus(['error', 'single'])).toBe('single');
    expect(aggregateFixStatus(['error'])).toBe('error');
    expect(aggregateFixStatus([])).toBeNull();
  });
});
