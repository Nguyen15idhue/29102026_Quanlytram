import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('P18-3 YC3 backend listener_all/mountpoint_all', () => {
  it('migration 045 thêm 2 cột và backfill giữ hành vi cũ', () => {
    const sql = readFileSync('../db/migrations/admin/045_ntrip_account_all.sql', 'utf8');
    expect(sql).toContain('listener_all');
    expect(sql).toContain('mountpoint_all');
    expect(sql).toContain('account_listener_acl');
  });

  it('route hỗ trợ cờ all và chặn gán lẻ khi đang bật all', () => {
    const src = readFileSync('src/routes/ntripAccounts.ts', 'utf8');
    expect(src).toContain('listener_all');
    expect(src).toContain('mountpoint_all');
    expect(src).toContain('LISTENER_ALL_ENABLED');
    expect(src).toContain('MOUNTPOINT_ALL_ENABLED');
    expect(src).toContain('LISTENER_REQUIRED');
    expect(src).toContain('MOUNTPOINT_REQUIRED');
    expect(src).toContain('D18-6');
  });

  it('Go authorize tôn trọng ListenerAll/MountpointAll', () => {
    const types = readFileSync('../gnss/internal/caster/types.go', 'utf8');
    const listener = readFileSync('../gnss/internal/caster/listener.go', 'utf8');
    expect(types).toContain('ListenerAll');
    expect(types).toContain('MountpointAll');
    expect(listener).toContain('!account.MountpointAll');
    expect(listener).toContain('!account.ListenerAll');
  });
});
