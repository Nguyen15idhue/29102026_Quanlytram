import { describe, expect, it } from 'vitest';
import { sameSourceTarget } from '../src/lib/sourceTarget';

const saved = { client_host: 'rtk.example.vn', client_port: 1509, client_tls: 0 };

describe('sameSourceTarget', () => {
  it('chấp nhận đúng host/port/TLS (không phân biệt hoa thường)', () => {
    expect(sameSourceTarget(saved, { host: 'RTK.Example.VN', port: 1509, tls: false })).toBe(true);
    expect(sameSourceTarget({ ...saved, client_tls: 1 }, { host: 'rtk.example.vn', port: 1509, tls: true })).toBe(
      true
    );
  });

  it('từ chối khi host, port hoặc TLS khác', () => {
    expect(sameSourceTarget(saved, { host: 'attacker.example', port: 1509, tls: false })).toBe(false);
    expect(sameSourceTarget(saved, { host: 'rtk.example.vn', port: 2101, tls: false })).toBe(false);
    expect(sameSourceTarget(saved, { host: 'rtk.example.vn', port: 1509, tls: true })).toBe(false);
    expect(sameSourceTarget(undefined, { host: 'rtk.example.vn', port: 1509, tls: false })).toBe(false);
  });
});
