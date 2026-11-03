import { describe, expect, it } from 'vitest';
import { mountpointCountSql } from '../src/lib/mountpointList';

describe('mountpointCountSql', () => {
  it('JOIN stations để điều kiện s.name trong WHERE hợp lệ', () => {
    const sql = mountpointCountSql('m.id > 0 AND s.name LIKE ?');
    expect(sql).toContain('LEFT JOIN stations s ON s.id = m.station_id');
    expect(sql).toContain('FROM mountpoints m');
  });

  it('giữ nguyên điều kiện WHERE được truyền vào', () => {
    const sql = mountpointCountSql('m.company_id = ?');
    expect(sql).toContain('WHERE m.company_id = ?');
  });
});
