import { describe, expect, it } from 'vitest';
import { mustChangePasswordAllowed } from '../src/lib/passwordPolicy';

describe('mustChangePasswordAllowed', () => {
  it('cho phép auth/me, logout, login và profile', () => {
    for (const path of [
      '/api/auth/me',
      '/api/auth/logout',
      '/api/auth/login',
      '/api/profile',
      '/api/profile/password',
      '/api/profile/sessions?x=1'
    ]) {
      expect(mustChangePasswordAllowed(path), path).toBe(true);
    }
  });

  it('chặn API nghiệp vụ', () => {
    for (const path of ['/api/stations', '/api/relay-jobs', '/api/mountpoints', '/api/system/health']) {
      expect(mustChangePasswordAllowed(path), path).toBe(false);
    }
  });
});
