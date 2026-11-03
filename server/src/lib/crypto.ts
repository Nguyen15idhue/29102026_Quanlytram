import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config';

const PREFIX_V1 = 'v1';
const PREFIX_V2 = 'v2';
const IV_BYTES = 12;

function keyFromBase64(raw: string): Buffer {
  if (!raw) throw new Error('APP_ENC_KEY is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('APP_ENC_KEY must decode to 32 bytes');
  return key;
}

function previousKey(): string {
  return process.env.APP_ENC_KEY_PREVIOUS ?? '';
}

export function secretAad(table: string, column: string, recordId: number | string): string {
  return `${table}:${column}:${recordId}`;
}

export function encryptSecret(plain: string, keyBase64?: string, aad?: string): string {
  if (!plain) throw new Error('Cannot encrypt an empty secret');
  const key = keyFromBase64(keyBase64 ?? config.security.appEncKey);
  const nonce = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const prefix = aad ? `${PREFIX_V2}:0` : PREFIX_V1;
  return [
    prefix,
    nonce.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64')
  ].join(':');
}

export function decryptSecret(payload: string, keyBase64?: string, aad?: string): string {
  const parts = payload.split(':');
  if (parts[0] === PREFIX_V1) {
    if (parts.length !== 4) throw new Error('Unsupported secret format');
    return open(parts[1], parts[2], parts[3], keyFromBase64(keyBase64 ?? config.security.appEncKey));
  }
  if (parts[0] === PREFIX_V2) {
    if (parts.length !== 5) throw new Error('Unsupported secret format');
    if (!aad) throw new Error('Thiếu AAD cho secret v2');
    const keyId = Number(parts[1]);
    const rawKey = keyBase64 ?? (keyId === 1 ? previousKey() : config.security.appEncKey);
    if (keyId === 1 && !rawKey) throw new Error('APP_ENC_KEY_PREVIOUS chưa cấu hình');
    return open(parts[2], parts[3], parts[4], keyFromBase64(rawKey), aad);
  }
  throw new Error('Unsupported secret format');
}

function open(nonceB64: string, cipherB64: string, tagB64: string, key: Buffer, aad?: string): string {
  const nonce = Buffer.from(nonceB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (nonce.length !== IV_BYTES || tag.length !== 16) {
    throw new Error('Invalid secret payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
