import { describe, expect, it } from 'vitest';
import { resolveSourceClientPort } from '../src/routes/stations';

describe('PUT /api/stations/:id/sources — client_port NOT NULL', () => {
  it('trạm caster không gửi client_port vẫn có giá trị (không ghi NULL)', () => {
    const port = resolveSourceClientPort({ sourceRole: 'ntrip_caster' });
    expect(port).toBe(1509);
  });

  it('trạm caster giữ port cũ khi form không gửi lại', () => {
    const port = resolveSourceClientPort({
      sourceRole: 'ntrip_caster',
      previousPort: 2101
    });
    expect(port).toBe(2101);
  });

  it('giá trị form gửi lên được ưu tiên', () => {
    const port = resolveSourceClientPort({
      sourceRole: 'ntrip_client',
      requestedPort: 2101,
      previousPort: 1509
    });
    expect(port).toBe(2101);
  });

  it('ntrip_client chưa có port nào thì trả null để route báo 400', () => {
    const port = resolveSourceClientPort({ sourceRole: 'ntrip_client' });
    expect(port).toBeNull();
  });

  it('ntrip_client đang có port cũ thì giữ nguyên', () => {
    const port = resolveSourceClientPort({
      sourceRole: 'ntrip_client',
      previousPort: 1509
    });
    expect(port).toBe(1509);
  });
});
