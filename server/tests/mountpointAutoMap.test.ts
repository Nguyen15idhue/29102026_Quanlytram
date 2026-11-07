import { describe, expect, it, vi } from 'vitest';
import {
  mapMountpointToCompanyListeners,
  remapAllMountpointsToCompanyListeners
} from '../src/lib/caster';

function fakeConn(affectedRows = 1) {
  return {
    query: vi.fn(async () => [{ affectedRows }, []])
  };
}

describe('auto-map mountpoint vào listener công ty', () => {
  it('company cụ thể: chỉ chọn listener cùng company', async () => {
    const conn = fakeConn(2);
    const added = await mapMountpointToCompanyListeners(conn, 12, 35);

    expect(added).toBe(2);
    const [sql, params] = conn.query.mock.calls[0];
    expect(sql).toContain('WHERE company_id = ?');
    expect(params).toEqual([12, 35]);
  });

  it('company NULL: gán vào toàn bộ listener (D18-10)', async () => {
    const conn = fakeConn(4);
    const added = await mapMountpointToCompanyListeners(conn, 12, null);

    expect(added).toBe(4);
    const [sql, params] = conn.query.mock.calls[0];
    expect(sql).not.toContain('WHERE company_id = ?');
    expect(params).toEqual([12]);
  });

  it('remap toàn bộ: xóa mapping khác company rồi gán lại', async () => {
    const conn = fakeConn(3);
    const added = await remapAllMountpointsToCompanyListeners(conn);

    expect(added).toBe(3);
    expect(conn.query.mock.calls).toHaveLength(2);
    expect(conn.query.mock.calls[0][0]).toContain('DELETE lm');
    expect(conn.query.mock.calls[1][0]).toContain('INSERT IGNORE');
    expect(conn.query.mock.calls[1][0]).toContain('m.company_id IS NULL OR l.company_id = m.company_id');
  });
});
