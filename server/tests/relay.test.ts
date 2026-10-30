import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';
import { endpointKey } from '../src/lib/endpointKey';
import { findCycle } from '../src/lib/loopGuard';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('relay secret encryption', () => {
  it('round-trips a secret', () => {
    const payload = encryptSecret('s3cr3t-value', KEY);
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload.split(':')).toHaveLength(4);
    expect(decryptSecret(payload, KEY)).toBe('s3cr3t-value');
  });

  it('uses a fresh nonce per encryption', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('rejects a tampered tag', () => {
    const parts = encryptSecret('secret', KEY).split(':');
    parts[3] = Buffer.alloc(16, 1).toString('base64');
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow();
  });

  it('rejects a wrong key', () => {
    const payload = encryptSecret('secret', KEY);
    expect(() => decryptSecret(payload, Buffer.alloc(32, 8).toString('base64'))).toThrow();
  });
});

describe('endpointKey', () => {
  it('normalizes host, mount and scheme', () => {
    expect(
      endpointKey({ host: ' CASTER.Example.COM ', port: 2101, mount: '/MOUNT/', ssl: false })
    ).toBe('http://caster.example.com:2101/MOUNT');
    expect(
      endpointKey({ host: 'caster.example.com', port: 443, mount: 'MOUNT', ssl: true })
    ).toBe('https://caster.example.com:443/MOUNT');
  });

  it('uses scheme default port when missing', () => {
    expect(endpointKey({ host: 'h', port: 0, mount: 'm', ssl: true })).toBe('https://h:443/m');
    expect(endpointKey({ host: 'h', port: 0, mount: 'm', ssl: false })).toBe('http://h:80/m');
  });
});

describe('findCycle', () => {
  it('detects a self-loop', () => {
    expect(findCycle([{ upstreamKey: 'a', downstreamKey: 'a' }])).toEqual(['a', 'a']);
  });

  it('detects a two-node cycle', () => {
    const cycle = findCycle([
      { upstreamKey: 'a', downstreamKey: 'b' },
      { upstreamKey: 'b', downstreamKey: 'a' }
    ]);
    expect(cycle).not.toBeNull();
  });

  it('detects a longer cycle but ignores branches', () => {
    expect(
      findCycle([
        { upstreamKey: 'a', downstreamKey: 'b' },
        { upstreamKey: 'b', downstreamKey: 'c' },
        { upstreamKey: 'c', downstreamKey: 'a' },
        { upstreamKey: 'x', downstreamKey: 'y' }
      ])
    ).not.toBeNull();
  });

  it('returns null for a DAG', () => {
    expect(
      findCycle([
        { upstreamKey: 'a', downstreamKey: 'b' },
        { upstreamKey: 'b', downstreamKey: 'c' },
        { upstreamKey: 'a', downstreamKey: 'd' }
      ])
    ).toBeNull();
  });
});
