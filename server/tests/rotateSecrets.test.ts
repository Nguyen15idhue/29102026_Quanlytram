import { describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';
import { ROTATION_TARGETS, decryptAny, needsRotation, rotateSecret } from '../src/db/rotateSecrets';

const { KEY, PREVIOUS } = vi.hoisted(() => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const previous = Buffer.alloc(32, 9).toString('base64');
  process.env.APP_ENC_KEY = key;
  process.env.APP_ENC_KEY_PREVIOUS = previous;
  return { KEY: key, PREVIOUS: previous };
});

const AAD = 'relay_credentials:password_enc:12';

describe('rotate-secrets', () => {
  it('chỉ rotate secret chưa phải v2', () => {
    expect(needsRotation('v1:aaa:bbb:ccc')).toBe(true);
    expect(needsRotation('v2:0:aaa:bbb:ccc')).toBe(false);
  });

  it('v1 → v2 gắn AAD và giải mã lại đúng plaintext', () => {
    const rotated = rotateSecret(encryptSecret('mat-khau', KEY), AAD);
    expect(rotated.startsWith('v2:0:')).toBe(true);
    expect(decryptSecret(rotated, undefined, AAD)).toBe('mat-khau');
  });

  it('đọc được v1 mã hoá bằng APP_ENC_KEY_PREVIOUS rồi rotate sang key hiện tại', () => {
    const old = encryptSecret('mat-khau-cu', PREVIOUS);
    expect(decryptAny(old)).toBe('mat-khau-cu');
    const rotated = rotateSecret(old, AAD);
    expect(rotated.startsWith('v2:0:')).toBe(true);
    expect(decryptSecret(rotated, undefined, AAD)).toBe('mat-khau-cu');
  });

  it('target phủ đúng 2 cột secret đã có read-path', () => {
    expect(ROTATION_TARGETS.map((target) => target.label)).toEqual([
      'relay_credentials.password_enc',
      'station_sources.client_password_enc'
    ]);
    expect(ROTATION_TARGETS[0].aad(12)).toBe(AAD);
    expect(ROTATION_TARGETS[1].aad(9)).toBe('station_sources:client_password_enc:9');
  });
});
