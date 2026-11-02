import { describe, expect, it } from 'vitest';
import { TtlLruCache } from '../src/lib/ttlLruCache';

describe('TtlLruCache', () => {
  it('never grows past its entry limit', () => {
    const cache = new TtlLruCache<string, number>(3, 60_000);
    for (let index = 0; index < 10; index++) {
      cache.set(`k${index}`, index);
    }
    expect(cache.size).toBe(3);
    expect(cache.get('k0')).toBeUndefined();
    expect(cache.get('k9')).toBe(9);
  });

  it('refreshes recency on read before evicting', () => {
    const cache = new TtlLruCache<string, number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('drops expired entries', () => {
    const cache = new TtlLruCache<string, number>(4, 1000);
    cache.set('a', 1, 0);
    expect(cache.get('a', 500)).toBe(1);
    expect(cache.get('a', 1500)).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
