import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, secretAad } from '../src/lib/crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('crypto AAD', () => {
  it('v1 vẫn giải mã được (tương thích dữ liệu cũ)', () => {
    const payload = encryptSecret('mat-khau', KEY);
    expect(payload.startsWith('v1:')).toBe(true);
    expect(decryptSecret(payload, KEY)).toBe('mat-khau');
  });

  it('v2 gắn AAD và giải mã đúng khi đúng bản ghi', () => {
    const aad = secretAad('station_sources', 'client_password_enc', 42);
    const payload = encryptSecret('mat-khau', KEY, aad);
    expect(payload.startsWith('v2:0:')).toBe(true);
    expect(decryptSecret(payload, KEY, aad)).toBe('mat-khau');
  });

  it('hoán ciphertext giữa 2 bản ghi thì decrypt fail', () => {
    const payload = encryptSecret('mat-khau', KEY, secretAad('station_sources', 'client_password_enc', 42));
    expect(() =>
      decryptSecret(payload, KEY, secretAad('station_sources', 'client_password_enc', 43))
    ).toThrow();
  });

  it('v2 thiếu AAD bị từ chối', () => {
    const payload = encryptSecret('mat-khau', KEY, secretAad('t', 'c', 1));
    expect(() => decryptSecret(payload, KEY)).toThrow(/AAD/);
  });
});
