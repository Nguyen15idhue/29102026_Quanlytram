export type AccountFixStatus = 'single' | 'fixed' | 'float' | 'rtd' | 'error';

const VALID: AccountFixStatus[] = ['single', 'fixed', 'float', 'rtd', 'error'];

export function normalizeFixType(value: unknown): AccountFixStatus {
  const text = String(value ?? '').trim().toLowerCase();
  return (VALID as string[]).includes(text) ? (text as AccountFixStatus) : 'error';
}

const PRIORITY: Record<AccountFixStatus, number> = {
  fixed: 5,
  float: 4,
  rtd: 3,
  single: 2,
  error: 1
};

export function aggregateFixStatus(statuses: AccountFixStatus[]): AccountFixStatus | null {
  if (statuses.length === 0) return null;
  let best: AccountFixStatus = 'error';
  for (const status of statuses) {
    if (PRIORITY[status] > PRIORITY[best]) best = status;
  }
  return best;
}
