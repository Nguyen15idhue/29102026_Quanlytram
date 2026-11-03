import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from '../src/lib/outbound';

describe('isBlockedAddress', () => {
  it('chặn loopback, link-local metadata và multicast', () => {
    for (const address of [
      '127.0.0.1',
      '127.10.0.5',
      '169.254.169.254',
      '0.0.0.0',
      '224.0.0.1',
      '239.255.255.250',
      '::1',
      '::',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254'
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('cho phép RFC1918, public và IPv6 thường', () => {
    for (const address of [
      '10.0.0.5',
      '172.16.4.2',
      '192.168.1.10',
      '203.113.1.5',
      '2001:db8::1',
      '::ffff:192.168.1.10'
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });
});
