import { describe, expect, it } from 'vitest';
import {
  allowedActions,
  assertTransition,
  deriveRelayState,
  isIdempotent,
  type RelayAction,
  type RelayStateInput
} from '../src/lib/relayState';

const base: RelayStateInput = {
  deleted: false,
  locked: false,
  enabled: false,
  pausedByStation: false,
  pausedByMountpoint: false,
  desiredRevision: 1,
  appliedRevision: 1,
  runtimeState: 'disabled',
  directionStatus: null
};

function input(overrides: RelayStateInput): RelayStateInput {
  return { ...base, ...overrides };
}

const states: Record<string, RelayStateInput> = {
  deleted: input({ deleted: true }),
  locked: input({ locked: true, enabled: false }),
  paused: input({ pausedByStation: true, enabled: false }),
  disabled: input({ enabled: false }),
  pending: input({ enabled: true, desiredRevision: 2, appliedRevision: 1 }),
  online: input({
    enabled: true,
    runtimeState: 'streaming',
    directionStatus: { upstream: 'online', downstream: 'online' }
  }),
  no_data: input({
    enabled: true,
    runtimeState: 'streaming',
    directionStatus: { upstream: 'online', downstream: 'no_data' }
  }),
  offline: input({
    enabled: true,
    runtimeState: 'streaming',
    directionStatus: { upstream: 'offline', downstream: 'online' }
  }),
  live_but_disabled: input({ enabled: false, runtimeState: 'streaming' })
};

function codeFor(state: RelayStateInput, action: RelayAction): string {
  try {
    assertTransition(state, action);
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN';
  }
}

describe('deriveRelayState — thứ tự ưu tiên', () => {
  it('ưu tiên deleted > locked > paused > disabled > pending', () => {
    expect(deriveRelayState(states.deleted).state).toBe('deleted');
    expect(deriveRelayState(states.locked).state).toBe('locked');
    expect(deriveRelayState(states.paused).state).toBe('paused');
    expect(deriveRelayState(states.disabled).state).toBe('disabled');
    expect(deriveRelayState(states.pending).state).toBe('pending');
  });

  it('chỉ dùng runtime khi job đang bật và không pending', () => {
    expect(deriveRelayState(states.online).state).toBe('online');
    expect(deriveRelayState(states.no_data).state).toBe('no_data');
    expect(deriveRelayState(states.offline).state).toBe('offline');
  });

  it('badge offline cho mọi trạng thái cấu hình', () => {
    for (const key of ['deleted', 'locked', 'paused', 'disabled', 'pending', 'offline']) {
      expect(deriveRelayState(states[key]).badge, key).toBe('offline');
    }
    expect(deriveRelayState(states.online).badge).toBe('online');
    expect(deriveRelayState(states.no_data).badge).toBe('no_data');
  });

  it('streaming nhưng thiếu dữ liệu hai chiều → no_data', () => {
    expect(
      deriveRelayState(input({ enabled: true, runtimeState: 'streaming' })).state
    ).toBe('no_data');
  });
});

describe('assertTransition — ma trận hành động', () => {
  it('ma trận đầy đủ theo bảng 4.3', () => {
    const table: Record<RelayAction, Record<string, string>> = {
      enable: {
        deleted: 'NOT_FOUND',
        locked: 'RELAY_LOCKED',
        paused: 'RESOURCE_PAUSED',
        disabled: 'OK',
        pending: 'OK',
        online: 'OK'
      },
      disable: {
        deleted: 'NOT_FOUND',
        locked: 'RELAY_LOCKED',
        paused: 'OK',
        disabled: 'OK',
        pending: 'OK',
        online: 'OK'
      },
      lock: {
        deleted: 'NOT_FOUND',
        locked: 'OK',
        paused: 'OK',
        disabled: 'OK',
        pending: 'RELAY_PENDING',
        online: 'RELAY_ENABLED'
      },
      unlock: {
        deleted: 'NOT_FOUND',
        locked: 'OK',
        disabled: 'OK',
        online: 'OK'
      },
      restart: {
        deleted: 'NOT_FOUND',
        locked: 'RELAY_LOCKED',
        paused: 'RELAY_DISABLED',
        disabled: 'RELAY_DISABLED',
        pending: 'OK',
        online: 'OK'
      },
      test: {
        deleted: 'NOT_FOUND',
        locked: 'RELAY_LOCKED',
        paused: 'OK',
        disabled: 'OK',
        online: 'OK'
      },
      delete: {
        deleted: 'NOT_FOUND',
        locked: 'RELAY_LOCKED',
        paused: 'OK',
        disabled: 'OK',
        pending: 'RELAY_PENDING',
        online: 'RELAY_ENABLED'
      },
      patch_enable: {
        deleted: 'NOT_FOUND',
        locked: 'RELAY_LOCKED',
        paused: 'RESOURCE_PAUSED',
        disabled: 'OK',
        online: 'OK'
      }
    };

    for (const [action, rows] of Object.entries(table)) {
      for (const [stateName, expected] of Object.entries(rows)) {
        expect(codeFor(states[stateName], action as RelayAction), `${action}/${stateName}`).toBe(
          expected
        );
      }
    }
  });

  it('chặn khóa/xóa khi job đã tắt nhưng runtime còn sống', () => {
    expect(codeFor(states.live_but_disabled, 'lock')).toBe('RELAY_ONLINE');
    expect(codeFor(states.live_but_disabled, 'delete')).toBe('RELAY_ONLINE');
  });

  it('không thao tác được job đã xóa', () => {
    for (const action of ['enable', 'disable', 'lock', 'unlock', 'restart', 'test', 'delete']) {
      expect(codeFor(states.deleted, action as RelayAction), action).toBe('NOT_FOUND');
    }
  });
});

describe('isIdempotent', () => {
  it('nhận diện thao tác lặp lại vô hại', () => {
    expect(isIdempotent(states.disabled, 'disable')).toBe(true);
    expect(isIdempotent(states.locked, 'lock')).toBe(true);
    expect(isIdempotent(states.disabled, 'unlock')).toBe(true);
    expect(isIdempotent(states.online, 'enable')).toBe(true);
    expect(isIdempotent(states.disabled, 'enable')).toBe(false);
    expect(isIdempotent(states.deleted, 'unlock')).toBe(false);
  });
});

describe('allowedActions', () => {
  it('job khóa chỉ cho mở khóa', () => {
    expect(allowedActions(states.locked)).toEqual(['unlock']);
  });

  it('job đã tắt cho bật, khóa, test, xóa', () => {
    const actions = allowedActions(states.disabled);
    expect(actions).toContain('enable');
    expect(actions).toContain('lock');
    expect(actions).toContain('test');
    expect(actions).toContain('delete');
    expect(actions).not.toContain('restart');
  });

  it('job online không cho khóa/xóa/restart khi chưa tắt', () => {
    const actions = allowedActions(states.online);
    expect(actions).not.toContain('lock');
    expect(actions).not.toContain('delete');
    expect(actions).toContain('disable');
    expect(actions).toContain('restart');
  });

  it('job đã xóa không còn hành động', () => {
    expect(allowedActions(states.deleted)).toEqual([]);
  });
});
