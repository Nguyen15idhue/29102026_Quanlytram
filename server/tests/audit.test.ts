import { describe, expect, it, vi } from 'vitest';
import { isSensitiveAudit, redact, writeAudit } from '../src/lib/audit';

describe('audit', () => {
  it('redact secret trước khi ghi', () => {
    expect(redact({ password: 'x', nested: { token: 'y', ok: 1 } })).toEqual({
      password: '***',
      nested: { token: '***', ok: 1 }
    });
  });

  it('phân loại hành động nhạy cảm', () => {
    expect(isSensitiveAudit('web_user.delete')).toBe(true);
    expect(isSensitiveAudit('import')).toBe(true);
    expect(isSensitiveAudit('change_password')).toBe(true);
    expect(isSensitiveAudit('login_failed')).toBe(false);
  });

  it('thử lại 1 lần rồi thành công', async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([{}]);
    await writeAudit({ query } as any, 1, 'login_failed', 'auth', 1, null, null, '127.0.0.1');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fail-closed với hành động nhạy cảm khi DB lỗi', async () => {
    const query = vi.fn().mockRejectedValue(new Error('down'));
    await expect(
      writeAudit({ query } as any, 1, 'web_user.delete', 'web_user', 1, null, null, '127.0.0.1')
    ).rejects.toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
