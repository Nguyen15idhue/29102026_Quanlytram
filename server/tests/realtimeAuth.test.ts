import { describe, expect, it } from 'vitest';
import { authRefreshDue, revokeSessionSockets, revokeUserSockets } from '../src/realtime/socket';

describe('realtime auth cache', () => {
  it('skips the session query inside the refresh window', () => {
    const now = 1_000_000;
    expect(authRefreshDue(now - 1_000, now)).toBe(false);
    expect(authRefreshDue(now - 30_000, now)).toBe(false);
  });

  it('refreshes once the 45 second window elapses', () => {
    const now = 1_000_000;
    expect(authRefreshDue(now - 45_000, now)).toBe(true);
    expect(authRefreshDue(now - 90_000, now)).toBe(true);
  });

  it('revocation helpers are safe without an active io', () => {
    expect(() => revokeSessionSockets(10)).not.toThrow();
    expect(() => revokeUserSockets(10)).not.toThrow();
    expect(() => revokeUserSockets(10, 5)).not.toThrow();
  });
});
