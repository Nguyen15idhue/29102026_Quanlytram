import { describe, expect, it } from 'vitest';
import { SEED_USER_UPSERT_SQL } from '../src/db/seedUser';

describe('SEED_USER_UPSERT_SQL', () => {
  it('không ghi đè cột nghiệp vụ khi tài khoản đã tồn tại', () => {
    const updateClause = SEED_USER_UPSERT_SQL.split('ON DUPLICATE KEY UPDATE')[1];
    expect(updateClause.trim()).toBe('id = id');
  });

  it('không chứa gán status/role/company/email/display_name', () => {
    expect(SEED_USER_UPSERT_SQL).not.toMatch(/status\s*=/);
    expect(SEED_USER_UPSERT_SQL).not.toMatch(/role_id\s*=/);
    expect(SEED_USER_UPSERT_SQL).not.toMatch(/company_id\s*=/);
    expect(SEED_USER_UPSERT_SQL).not.toMatch(/display_name\s*=/);
    expect(SEED_USER_UPSERT_SQL).not.toMatch(/email\s*=/);
  });
});
