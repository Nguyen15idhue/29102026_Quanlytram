import { ApiError } from './http';

export type RelayState =
  | 'deleted'
  | 'locked'
  | 'paused'
  | 'disabled'
  | 'pending'
  | 'online'
  | 'no_data'
  | 'offline';

export type RelayAction =
  | 'enable'
  | 'disable'
  | 'lock'
  | 'unlock'
  | 'restart'
  | 'test'
  | 'delete'
  | 'patch_enable';

export type RelayBadge = 'online' | 'offline' | 'no_data';
export type RelayDirectionStatus = 'online' | 'offline' | 'no_data';

export interface RelayStateInput {
  deleted?: boolean | null;
  locked?: boolean | null;
  enabled?: boolean | null;
  pausedByStation?: boolean | null;
  pausedByMountpoint?: boolean | null;
  desiredRevision?: number | null;
  appliedRevision?: number | null;
  runtimeState?: string | null;
  directionStatus?: {
    upstream: RelayDirectionStatus;
    downstream: RelayDirectionStatus;
  } | null;
}

export interface RelayStateView {
  state: RelayState;
  label: string;
  badge: RelayBadge;
}

const LABELS: Record<RelayState, string> = {
  deleted: 'đã xóa',
  locked: 'đã khóa',
  paused: 'tạm dừng',
  disabled: 'đã tắt',
  pending: 'đang áp dụng',
  online: 'online',
  no_data: 'không có dữ liệu',
  offline: 'offline'
};

const BADGES: Record<RelayState, RelayBadge> = {
  deleted: 'offline',
  locked: 'offline',
  paused: 'offline',
  disabled: 'offline',
  pending: 'offline',
  online: 'online',
  no_data: 'no_data',
  offline: 'offline'
};

export function isPaused(input: RelayStateInput): boolean {
  return Boolean(input.pausedByStation || input.pausedByMountpoint);
}

export function isPending(input: RelayStateInput): boolean {
  if (input.desiredRevision === null || input.desiredRevision === undefined) return false;
  if (input.appliedRevision === null || input.appliedRevision === undefined) return true;
  return Number(input.appliedRevision) < Number(input.desiredRevision);
}

export function isRuntimeLive(runtimeState: string | null | undefined): boolean {
  return runtimeState === 'connecting' || runtimeState === 'streaming';
}

function combinedDirection(
  direction: NonNullable<RelayStateInput['directionStatus']>
): RelayDirectionStatus {
  if (direction.upstream === 'offline' || direction.downstream === 'offline') return 'offline';
  if (direction.upstream === 'online' && direction.downstream === 'online') return 'online';
  return 'no_data';
}

function view(state: RelayState): RelayStateView {
  return { state, label: LABELS[state], badge: BADGES[state] };
}

export function deriveRelayState(input: RelayStateInput): RelayStateView {
  if (input.deleted) return view('deleted');
  if (input.locked) return view('locked');
  if (isPaused(input)) return view('paused');
  if (!input.enabled) return view('disabled');
  if (isPending(input)) return view('pending');

  if (input.runtimeState === 'streaming') {
    if (!input.directionStatus) return view('no_data');
    return view(combinedDirection(input.directionStatus));
  }

  return view('offline');
}

function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function assertTransition(input: RelayStateInput, action: RelayAction): void {
  if (input.deleted) {
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
  }

  const { state } = deriveRelayState(input);
  const pending = isPending(input);

  switch (action) {
    case 'enable':
      if (state === 'locked') {
        throw conflict('RELAY_LOCKED', 'Relay job đang khóa, phải mở khóa trước');
      }
      if (state === 'paused') {
        throw conflict('RESOURCE_PAUSED', 'Relay job đang bị tạm dừng bởi trạm hoặc mountpoint');
      }
      return;

    case 'disable':
      if (state === 'locked') {
        throw conflict('RELAY_LOCKED', 'Relay job đang khóa, phải mở khóa trước');
      }
      return;

    case 'lock':
      if (state === 'locked') return;
      if (pending || state === 'pending') {
        throw conflict('RELAY_PENDING', 'Cấu hình trước chưa áp dụng xong, thử lại sau');
      }
      if (input.enabled) {
        throw conflict('RELAY_ENABLED', 'Phải tắt relay job trước khi khóa');
      }
      if (isRuntimeLive(input.runtimeState)) {
        throw conflict('RELAY_ONLINE', 'Relay đang kết nối, chờ dừng hẳn trước khi khóa');
      }
      return;

    case 'unlock':
      return;

    case 'restart':
      if (state === 'locked') {
        throw conflict('RELAY_LOCKED', 'Relay job đang khóa, phải mở khóa trước');
      }
      if (!input.enabled) {
        throw conflict('RELAY_DISABLED', 'Relay job đang tắt, phải bật trước khi khởi động lại');
      }
      return;

    case 'test':
      if (state === 'locked') {
        throw conflict('RELAY_LOCKED', 'Relay job đang khóa, phải mở khóa trước');
      }
      return;

    case 'delete':
      if (state === 'locked') {
        throw conflict('RELAY_LOCKED', 'Relay job đang khóa, phải mở khóa trước khi xóa');
      }
      if (pending || state === 'pending') {
        throw conflict('RELAY_PENDING', 'Cấu hình trước chưa áp dụng xong, thử lại sau');
      }
      if (input.enabled) {
        throw conflict('RELAY_ENABLED', 'Relay job đang bật, phải tắt trước khi xóa');
      }
      if (isRuntimeLive(input.runtimeState)) {
        throw conflict('RELAY_ONLINE', 'Relay đang online, chờ dừng hẳn trước khi xóa');
      }
      return;

    case 'patch_enable':
      if (state === 'locked') {
        throw conflict('RELAY_LOCKED', 'Relay job đang khóa, phải mở khóa trước');
      }
      if (state === 'paused') {
        throw conflict('RESOURCE_PAUSED', 'Relay job đang bị tạm dừng bởi trạm hoặc mountpoint');
      }
      return;

    default:
      throw new ApiError(400, 'VALIDATION_ERROR', 'Hành động không hợp lệ');
  }
}

export function isIdempotent(input: RelayStateInput, action: RelayAction): boolean {
  const { state } = deriveRelayState(input);
  if (state === 'deleted') return false;
  if (action === 'disable') return !input.enabled;
  if (action === 'lock') return state === 'locked';
  if (action === 'unlock') return state !== 'locked';
  if (action === 'enable' || action === 'patch_enable') {
    return Boolean(input.enabled) && state !== 'locked' && state !== 'paused';
  }
  return false;
}

const ACTIONS: RelayAction[] = [
  'enable',
  'disable',
  'lock',
  'unlock',
  'restart',
  'test',
  'delete',
  'patch_enable'
];

export function allowedActions(input: RelayStateInput): RelayAction[] {
  if (input.deleted) return [];
  return ACTIONS.filter((action) => {
    if (isIdempotent(input, action)) return false;
    try {
      assertTransition(input, action);
      return true;
    } catch {
      return false;
    }
  });
}
