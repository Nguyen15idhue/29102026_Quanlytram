import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('P18-5 YC1 bỏ prefill/default port', () => {
  it('migration 046 bỏ DEFAULT 1509, giữ NOT NULL', () => {
    const sql = readFileSync('../db/migrations/admin/046_drop_port_defaults.sql', 'utf8');
    expect(sql).toContain('MODIFY COLUMN port INT NOT NULL');
    expect(sql).toContain('upstream_port INT NOT NULL');
    expect(sql).toContain('downstream_port INT NOT NULL');
    expect(sql).not.toContain('DEFAULT 1509');
  });

  it('schema relay endpoint port bắt buộc, không default', () => {
    const src = readFileSync('src/routes/relayJobs.ts', 'utf8');
    expect(src).not.toContain('port: z.number().int().min(1).max(65535).optional().default(1509)');
  });

  it('schema station client_port và probe port không còn default 1509', () => {
    const src = readFileSync('src/routes/stations.ts', 'utf8');
    expect(src).not.toContain('client_port: z.number().int().min(1).max(65535).optional().default(1509)');
    expect(src).not.toContain('port: z.number().int().min(1).max(65535).default(1509)');
  });
});
