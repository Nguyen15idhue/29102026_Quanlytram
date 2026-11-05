import { describe, expect, it } from 'vitest';
import {
  isAllowedCasterPort,
  isListenerEnabled,
  isReservedCasterPort,
  listenerCreateSchema,
  publicConnection,
  selectOnlineConnections,
  type GoConnection
} from '../src/lib/caster';

function connection(patch: Partial<GoConnection>): GoConnection {
  return {
    id: 1,
    direction: 'rover',
    listenerId: 1,
    mountpointId: 1,
    accountId: 1,
    remoteAddr: '127.0.0.1:5000',
    userAgent: 'test',
    startTs: '2026-11-05T00:00:00Z',
    bytesIn: 0,
    bytesOut: 0,
    fixType: '',
    ...patch
  };
}

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

describe('danh sách online', () => {
  it('chỉ giữ rover có tài khoản, bỏ source và rover vô danh', () => {
    const items = selectOnlineConnections([
      connection({ id: 1, direction: 'source', accountId: 5 }),
      connection({ id: 2, direction: 'rover', accountId: 7 }),
      connection({ id: 3, direction: 'rover', accountId: null })
    ]);
    expect(items.map((item) => item.id)).toEqual([2]);
  });

  it('giữ rover không gửi GGA (fixType rỗng)', () => {
    const items = selectOnlineConnections([connection({ id: 9, fixType: '' })]);
    expect(items).toHaveLength(1);
    expect(items[0].fixType).toBe('');
  });

  it('ưu tiên username trong snapshot Go khi account đã bị xoá khỏi DB', () => {
    const item = publicConnection(
      connection({ direction: 'rover', accountId: 7, accountUsername: 'tram_a' }),
      'Listener 2101',
      'MP_A',
      undefined
    );
    expect(item.accountUsername).toBe('tram_a');
  });
});
