export type QualityDirection = 'upstream' | 'downstream';

/**
 * Lịch sử relay mặc định chỉ lấy chiều upstream; trước đây thiếu bộ lọc nên
 * hai dòng upstream/downstream cùng ts tạo event "state changed" giả.
 */
export function historyDirection(raw: unknown): QualityDirection {
  return String(raw) === 'downstream' ? 'downstream' : 'upstream';
}
