import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config';

const PREFIX = 'v1';
const IV_BYTES = 12;

function keyFromBase64(raw: string): Buffer {
  if (!raw) throw new Error('APP_ENC_KEY is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('APP_ENC_KEY must decode to 32 bytes');
  return key;
}

export function encryptSecret(plain: string, keyBase64?: string): string {
  if (!plain) throw new Error('Cannot encrypt an empty secret');
  const key = keyFromBase64(keyBase64 ?? config.security.appEncKey);
  const nonce = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    nonce.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64')
  ].join(':');
}

export function decryptSecret(payload: string, keyBase64?: string): string {
  const key = keyFromBase64(keyBase64 ?? config.security.appEncKey);
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Unsupported secret format');
  }
  const nonce = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  if (nonce.length !== IV_BYTES || tag.length !== 16) {
    throw new Error('Invalid secret payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
