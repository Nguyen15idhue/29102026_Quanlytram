import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('config production guard', () => {
  it('không khởi động khi production mà cookie không Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    vi.resetModules();
    await expect(import('../src/config')).rejects.toThrow(/SESSION_COOKIE_SECURE/);
  });

  it('dùng tiền tố __Host- khi bật Secure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('SESSION_COOKIE_NAME', 'cors_sid');
    vi.resetModules();
    const mod = await import('../src/config');
    expect(mod.sessionCookieName()).toBe('__Host-cors_sid');
  });

  it('giữ tên gốc khi không bật Secure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    vi.stubEnv('SESSION_COOKIE_NAME', 'cors_sid');
    vi.resetModules();
    const mod = await import('../src/config');
    expect(mod.sessionCookieName()).toBe('cors_sid');
  });
});
