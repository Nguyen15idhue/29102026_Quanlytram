import { describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '../src/lib/crypto';
import {
  encryptRelayPassword,
  relayCredentialAad,
  upsertRelayCredential
} from '../src/lib/relayCredentials';

const { KEY } = vi.hoisted(() => {
  const key = Buffer.alloc(32, 7).toString('base64');
  process.env.APP_ENC_KEY = key;
  return { KEY: key };
});

interface QueryCall {
  sql: string;
  params: unknown[];
}

function fakeConn(handlers: { select?: unknown[]; insertId?: number }) {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: normalized, params });
    if (normalized.startsWith('SELECT')) {
      return [handlers.select ?? [], []];
    }
    if (normalized.startsWith('INSERT')) {
      return [{ insertId: handlers.insertId ?? 77, affectedRows: 1 }, []];
    }
    return [{ affectedRows: 1 }, []];
  });
  return { conn: { query }, calls };
}

describe('relay_credentials secret AAD', () => {
  it('AAD dùng đúng table:column:recordId', () => {
    expect(relayCredentialAad(42)).toBe('relay_credentials:password_enc:42');
  });

  it('mã hoá v2 giải mã được bằng đúng id, sai id thì fail', () => {
    const payload = encryptRelayPassword('mat-khau', 42);
    expect(payload.startsWith('v2:0:')).toBe(true);
    expect(decryptSecret(payload, KEY, relayCredentialAad(42))).toBe('mat-khau');
    expect(() => decryptSecret(payload, KEY, relayCredentialAad(43))).toThrow();
  });

  it('cập nhật credential cũ gắn AAD theo id bản ghi', async () => {
    const { conn, calls } = fakeConn({ select: [{ id: 42 }] });

    const id = await upsertRelayCredential(
      conn,
      { username: 'up-user', password: 'mat-khau' },
      42,
      'Job upstream',
      5,
      9
    );

    expect(id).toBe(42);
    const update = calls.find((call) => call.sql.startsWith('UPDATE relay_credentials'));
    expect(update).toBeDefined();
    const payload = String(update!.params[2]);
    expect(payload.startsWith('v2:0:')).toBe(true);
    expect(decryptSecret(payload, KEY, relayCredentialAad(42))).toBe('mat-khau');
    expect(() => decryptSecret(payload, KEY, relayCredentialAad(41))).toThrow();
  });

  it('credential mới: INSERT id rồi UPDATE secret gắn AAD của id đó', async () => {
    const { conn, calls } = fakeConn({ insertId: 88 });

    const id = await upsertRelayCredential(
      conn,
      { username: 'down-user', password: 'mat-khau-moi' },
      null,
      'Job downstream',
      5,
      9,
      3
    );

    expect(id).toBe(88);
    const insert = calls.find((call) => call.sql.startsWith('INSERT'));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual(['Job downstream', 'down-user', 5, 3, 9]);

    const updates = calls.filter((call) => call.sql.startsWith('UPDATE relay_credentials'));
    expect(updates).toHaveLength(1);
    expect(updates[0].params[1]).toBe(88);
    const payload = String(updates[0].params[0]);
    expect(decryptSecret(payload, KEY, relayCredentialAad(88))).toBe('mat-khau-moi');
  });

  it('không đổi password thì không ghi lại secret', async () => {
    const { conn, calls } = fakeConn({ select: [{ id: 42 }] });

    await upsertRelayCredential(conn, { username: 'up-user' }, 42, 'Job upstream', 5, 9);

    const updates = calls.filter((call) => call.sql.startsWith('UPDATE relay_credentials'));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toBe('UPDATE relay_credentials SET name = ?, username = ? WHERE id = ?');
    expect(updates[0].params).toEqual(['Job upstream', 'up-user', 42]);
  });

  it('không truyền credential hoặc truyền null giữ nguyên/không tạo', async () => {
    const { conn, calls } = fakeConn({});

    await expect(upsertRelayCredential(conn, undefined, 42, 'x', 1, 1)).resolves.toBe(42);
    await expect(upsertRelayCredential(conn, null, 42, 'x', 1, 1)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('credential mới thiếu password bị từ chối', async () => {
    const { conn } = fakeConn({});
    await expect(
      upsertRelayCredential(conn, { username: 'up-user' }, null, 'x', 1, 1)
    ).rejects.toThrow(/mật khẩu/i);
  });
});
