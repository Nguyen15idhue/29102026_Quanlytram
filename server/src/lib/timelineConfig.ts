import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { DEFAULT_MIN_FRAMES_PER_WINDOW } from './statusTimeline';

export interface TimelineConfig {
  minFramesPerWindow: number;
}

// Đọc ngưỡng frame/60s từ bảng settings (admin). Nếu chưa cấu hình hoặc lỗi
// đọc, dùng mặc định để timeline vẫn hoạt động.
export async function loadTimelineConfig(): Promise<TimelineConfig> {
  try {
    const rows = await query<RowDataPacket[]>(
      'SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1',
      ['timeline.minFramesPerWindow']
    );
    if (rows.length > 0) {
      const raw = rows[0].setting_value;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const value = Number(parsed);
      if (Number.isFinite(value) && value >= 0) {
        return { minFramesPerWindow: Math.floor(value) };
      }
    }
  } catch {
    // Bảng settings có thể chưa sẵn sàng; dùng mặc định.
  }
  return { minFramesPerWindow: DEFAULT_MIN_FRAMES_PER_WINDOW };
}
