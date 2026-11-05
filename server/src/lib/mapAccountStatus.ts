// "none" = tài khoản đang kết nối nhưng chưa gửi GGA. Đây là trạng thái trung
// tính, KHÔNG phải lỗi: danh sách online không phụ thuộc GGA.
export type AccountFixStatus = 'none' | 'single' | 'fixed' | 'float' | 'rtd' | 'error';

const VALID: AccountFixStatus[] = ['none', 'single', 'fixed', 'float', 'rtd', 'error'];

export function normalizeFixType(value: unknown): AccountFixStatus {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '') return 'none';
  return (VALID as string[]).includes(text) ? (text as AccountFixStatus) : 'error';
}

const PRIORITY: Record<AccountFixStatus, number> = {
  fixed: 6,
  float: 5,
  rtd: 4,
  single: 3,
  error: 2,
  none: 1
};

export function aggregateFixStatus(statuses: AccountFixStatus[]): AccountFixStatus | null {
  if (statuses.length === 0) return null;
  let best: AccountFixStatus = 'none';
  for (const status of statuses) {
    if (PRIORITY[status] > PRIORITY[best]) best = status;
  }
  return best;
}
