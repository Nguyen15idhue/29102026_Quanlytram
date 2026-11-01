import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  adminQuery: vi.fn(),
  getJob: vi.fn(),
  writeAudit: vi.fn(),
  callGo: vi.fn()
}));

vi.mock('../src/db/pool', () => ({
  query: mocks.query,
  adminPool: { query: mocks.adminQuery }
}));

vi.mock('../src/lib/audit', () => ({ writeAudit: mocks.writeAudit }));

vi.mock('../src/lib/maintenanceConfig', () => ({
  getJob: mocks.getJob,
  getSettings: vi.fn(),
  listJobs: vi.fn()
}));

vi.mock('../src/lib/internalApi', () => ({ callGoInternal: mocks.callGo }));

import { nextDailyRun, runJob } from '../src/lib/maintenance';

function adminJob(key: string) {
  return {
    key,
    label: key,
    scope: 'admin' as const,
    table: 'web_sessions',
    retentionDays: 7,
    batchSize: 1000,
    intervalSec: 3600,
    enabled: true,
    updatedAt: null
  };
}

describe('maintenance runJob', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.adminQuery.mockReset();
    mocks.getJob.mockReset();
    mocks.writeAudit.mockReset();
    mocks.callGo.mockReset();
    mocks.adminQuery.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO maintenance_runs')) return Promise.resolve([{ insertId: 9 }]);
      if (sql.includes('DELETE FROM')) return Promise.resolve([{ affectedRows: 3 }]);
      return Promise.resolve([{}]);
    });
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it('dry-run chỉ đếm, không xóa', async () => {
    mocks.getJob.mockResolvedValue(adminJob('web-sessions'));
    mocks.query.mockResolvedValue([{ c: 5 }]);
    const result = await runJob('web-sessions', true, 1, '127.0.0.1');
    expect(result.rowsDeleted).toBe(5);
    const deletes = mocks.adminQuery.mock.calls.filter((call) =>
      String(call[0]).includes('DELETE FROM')
    );
    expect(deletes).toHaveLength(0);
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      1,
      'maintenance.run',
      'maintenance_job',
      'web-sessions',
      undefined,
      expect.objectContaining({ dryRun: true, status: 'ok', rowsDeleted: 5 }),
      '127.0.0.1'
    );
  });

  it('chạy thật xóa theo batch và dừng khi affected < batch', async () => {
    mocks.getJob.mockResolvedValue(adminJob('audit-logs'));
    const result = await runJob('audit-logs', false, 1, '127.0.0.1');
    expect(result.rowsDeleted).toBe(3);
    const deleteCall = mocks.adminQuery.mock.calls.find((call) =>
      String(call[0]).includes('DELETE FROM')
    );
    expect(String(deleteCall?.[0])).toContain('created_at');
    expect(String(deleteCall?.[0])).toContain('LIMIT');
  });

  it('acked-alerts chỉ xóa alert đã xác nhận', async () => {
    mocks.getJob.mockResolvedValue(adminJob('acked-alerts'));
    mocks.adminQuery.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO maintenance_runs')) return Promise.resolve([{ insertId: 9 }]);
      if (sql.includes('DELETE FROM')) return Promise.resolve([{ affectedRows: 0 }]);
      return Promise.resolve([{}]);
    });
    await runJob('acked-alerts', false, 1, '127.0.0.1');
    const deleteCall = mocks.adminQuery.mock.calls.find((call) =>
      String(call[0]).includes('DELETE FROM')
    );
    expect(String(deleteCall?.[0])).toContain("status = 'acked'");
  });

  it('job runtime gọi Go prune', async () => {
    mocks.getJob.mockResolvedValue({ ...adminJob('relay-sessions'), scope: 'runtime', table: 'relay_sessions' });
    mocks.callGo.mockResolvedValue({ rows: 2 });
    const result = await runJob('relay-sessions', true, 1, '127.0.0.1');
    expect(result.rowsDeleted).toBe(2);
    expect(mocks.callGo).toHaveBeenCalledWith(
      '/internal/maintenance/prune',
      { jobKey: 'relay-sessions', dryRun: true },
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('Go lỗi trả 502 và ghi run error', async () => {
    mocks.getJob.mockResolvedValue({ ...adminJob('relay-sessions'), scope: 'runtime', table: 'relay_sessions' });
    mocks.callGo.mockRejectedValue(new Error('missing endpoint'));
    await expect(runJob('relay-sessions', true, 1, '127.0.0.1')).rejects.toMatchObject({
      status: 502
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      1,
      'maintenance.run',
      'maintenance_job',
      'relay-sessions',
      undefined,
      expect.objectContaining({ status: 'error' }),
      '127.0.0.1'
    );
  });

  it('chạy trùng job trả 409', async () => {
    mocks.getJob.mockResolvedValue(adminJob('web-sessions'));
    mocks.query.mockResolvedValue([{ c: 0 }]);
    const first = runJob('web-sessions', true, 1, '127.0.0.1');
    await expect(runJob('web-sessions', true, 1, '127.0.0.1')).rejects.toMatchObject({
      status: 409
    });
    await first;
  });
});

describe('maintenance nextDailyRun', () => {
  const settings = {
    schedulerEnabled: true,
    hourLocal: 3,
    minuteLocal: 0,
    timezone: 'Asia/Ho_Chi_Minh',
    updatedAt: null
  };

  it('trả mốc 03:00 +07 kế tiếp', () => {
    expect(nextDailyRun(settings, new Date('2026-10-31T18:00:00Z'))).toBe(
      '2026-10-31T20:00:00.000Z'
    );
    expect(nextDailyRun(settings, new Date('2026-11-01T00:00:00Z'))).toBe(
      '2026-11-01T20:00:00.000Z'
    );
  });

  it('trả null khi scheduler tắt', () => {
    expect(
      nextDailyRun({ ...settings, schedulerEnabled: false }, new Date('2026-11-01T00:00:00Z'))
    ).toBeNull();
  });
});
