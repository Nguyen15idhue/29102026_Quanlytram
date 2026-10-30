import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';
import { endpointKey } from '../src/lib/endpointKey';
import { findCycle } from '../src/lib/loopGuard';
import { SOFT_DELETE_KEY_SUFFIX, TOMBSTONE_KEY_SQL, tombstoneExternalKey } from '../src/lib/tombstone';

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

describe('tombstone keys', () => {
  it('appends the row id to all three unique keys', () => {
    expect(TOMBSTONE_KEY_SQL).toContain("external_key = CONCAT(COALESCE(external_key, ''), '#deleted:', id)");
    expect(TOMBSTONE_KEY_SQL).toContain("upstream_key = CONCAT(COALESCE(upstream_key, ''), '#deleted:', id)");
    expect(TOMBSTONE_KEY_SQL).toContain(
      "downstream_key = CONCAT(COALESCE(downstream_key, ''), '#deleted:', id)"
    );
  });

  it('keeps the tombstoned key unique per row', () => {
    expect(tombstoneExternalKey('http://a:2101/m', 5)).toBe('http://a:2101/m#deleted:5');
    expect(SOFT_DELETE_KEY_SUFFIX).toBe('#deleted:');
  });
});
