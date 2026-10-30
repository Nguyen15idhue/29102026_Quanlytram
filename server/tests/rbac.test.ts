import { describe, expect, it } from 'vitest';
import { canManageRole, inScope, scopeClause } from '../src/rbac/scope';
import { redact } from '../src/lib/audit';
import { emailField } from '../src/lib/validation';

describe('scopeClause', () => {
  it('allows all records', () => {
    expect(scopeClause('all', 10, [], 'owner_web_user_id')).toEqual({ sql: '1=1', params: [] });
  });

  it('restricts own records', () => {
    expect(scopeClause('own', 10, [], 'owner_web_user_id')).toEqual({
      sql: 'owner_web_user_id = ?',
      params: [10]
    });
  });

  it('restricts subtree records', () => {
    expect(scopeClause('subtree', 10, [10, 11], 'owner_web_user_id')).toEqual({
      sql: 'owner_web_user_id IN (?,?)',
      params: [10, 11]
    });
  });

  it('denies none', () => {
    expect(scopeClause('none', 10, [10], 'owner_web_user_id')).toEqual({ sql: '1=0', params: [] });
  });
});

describe('inScope', () => {
  it('checks owner and subtree', () => {
    expect(inScope('all', 10, [], 99)).toBe(true);
    expect(inScope('own', 10, [], 10)).toBe(true);
    expect(inScope('own', 10, [], 11)).toBe(false);
    expect(inScope('subtree', 10, [10, 11], 11)).toBe(true);
    expect(inScope('subtree', 10, [10, 11], 12)).toBe(false);
    expect(inScope('none', 10, [10], 10)).toBe(false);
  });
});

describe('canManageRole', () => {
  it('prevents managing equal or higher levels', () => {
    expect(canManageRole(50, 10, false)).toBe(true);
    expect(canManageRole(50, 50, false)).toBe(false);
    expect(canManageRole(50, 100, false)).toBe(false);
    expect(canManageRole(50, 100, true)).toBe(true);
  });
});

describe('redact', () => {
  it('removes secret-like fields recursively', () => {
    expect(
      redact({
        username: 'admin',
        password: 'plain',
        nested: { token: 'abc', password_hash: 'hash', safe: 'ok' }
      })
    ).toEqual({
      username: 'admin',
      password: '***',
      nested: { token: '***', password_hash: '***', safe: 'ok' }
    });
  });
});

describe('emailField', () => {
  it('accepts omitted, empty and valid emails', () => {
    const optional = emailField.optional().default('');
    expect(optional.parse(undefined)).toBe('');
    expect(optional.parse('')).toBe('');
    expect(optional.parse('user@example.local')).toBe('user@example.local');
  });

  it('rejects malformed emails', () => {
    expect(emailField.safeParse('not-an-email').success).toBe(false);
  });
});
