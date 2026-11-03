import { describe, expect, it } from 'vitest';
import { historyDirection } from '../src/lib/historyDirection';

describe('historyDirection', () => {
  it('mặc định upstream cho giá trị thiếu/không hợp lệ', () => {
    expect(historyDirection(undefined)).toBe('upstream');
    expect(historyDirection('')).toBe('upstream');
    expect(historyDirection('ingest')).toBe('upstream');
    expect(historyDirection('UPSTREAM')).toBe('upstream');
  });

  it('nhận downstream khi được chọn', () => {
    expect(historyDirection('downstream')).toBe('downstream');
  });
});
