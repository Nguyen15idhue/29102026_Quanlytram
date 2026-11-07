import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('P18-2 YC2 công ty sửa listener', () => {
  it('migration 044 cấp caster.edit=tenant cho admin, none cho user', () => {
    const sql = readFileSync('../db/migrations/admin/044_caster_edit_company.sql', 'utf8');
    expect(sql).toContain("p.code = 'caster.edit'");
    expect(sql).toContain("SET rp.scope = 'tenant'");
    expect(sql).toContain("r.code = 'admin'");
    expect(sql).toContain("r.code = 'user'");
    expect(sql).toContain("'caster.add', 'caster.edit', 'caster.delete'");
  });

  it('route PATCH chặn port/company với non-super', () => {
    const src = readFileSync('src/routes/caster.ts', 'utf8');
    expect(src).toContain('IMMUTABLE_FIELD');
    expect(src).toContain('COMPANY_IMMUTABLE');
    expect(src).toContain('Công ty không được đổi port');
    expect(src).toContain('Không được đổi công ty của listener');
  });

  it('route PUT mountpoints dùng company scope, không dùng writable cá nhân', () => {
    const src = readFileSync('src/routes/caster.ts', 'utf8');
    expect(src).toContain('D18-5');
    expect(src).toContain('assertMountpointsSameCompany(mountpointIds, companyId)');
  });
});
