import type { AccountFixStatus } from '../types';

export const ACCOUNT_FIX_LABELS: Record<AccountFixStatus, string> = {
  single: 'Single',
  fixed: 'Fixed',
  float: 'Float',
  rtd: 'RTD',
  error: 'Lỗi'
};
