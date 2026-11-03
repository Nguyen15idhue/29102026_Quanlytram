import { describe, expect, it } from 'vitest';
import { idsForScope } from '../src/lib/scopeIds';

describe('idsForScope', () => {
  it('own chỉ trả chính actor, không dùng subtree', () => {
    expect(idsForScope('own', 42, [42, 43, 44], [7])).toEqual([42]);
  });

  it('tenant và subtree giữ đúng tập id', () => {
    expect(idsForScope('tenant', 42, [42, 43], [7, 8])).toEqual([7, 8]);
    expect(idsForScope('subtree', 42, [42, 43], [7])).toEqual([42, 43]);
  });
});
