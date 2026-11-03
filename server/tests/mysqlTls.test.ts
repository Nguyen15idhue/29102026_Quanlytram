import { describe, expect, it } from 'vitest';
import { useMysqlTls } from '../src/lib/mysqlTls';

describe('useMysqlTls', () => {
  it('tắt với loopback, docker service và RFC1918', () => {
    for (const host of ['127.0.0.1', 'localhost', 'mysql', '10.0.0.5', '192.168.1.5', '172.16.0.9', '172.31.9.9']) {
      expect(useMysqlTls(host, undefined), host).toBe(false);
    }
  });

  it('bật với FQDN/IP public', () => {
    for (const host of ['db.example.com', '203.113.1.5']) {
      expect(useMysqlTls(host, undefined), host).toBe(true);
    }
  });

  it('tuân theo ép buộc MYSQL_TLS', () => {
    expect(useMysqlTls('mysql', 'true')).toBe(true);
    expect(useMysqlTls('db.example.com', 'false')).toBe(false);
  });
});
