import { runtimeQuery } from '../db/runtimePool';

const RUNTIME_TARGETS = ['station', 'relay_job'] as const;
export type QualityTargetType = (typeof RUNTIME_TARGETS)[number];

/**
 * Đóng các cảnh báo chất lượng còn mở của một target vừa bị xoá.
 * Trả về số dòng đã resolve.
 */
export async function resolveQualityAlerts(
  targetType: QualityTargetType,
  targetId: number
): Promise<number> {
  const rows = await runtimeQuery<any>(
    `UPDATE quality_alerts
        SET resolved_at = UTC_TIMESTAMP(3)
      WHERE target_type = ? AND target_id = ? AND resolved_at IS NULL`,
    [targetType, targetId]
  );
  return Number(rows?.affectedRows ?? 0);
}

/**
 * Dọn cảnh báo mồ côi: target không còn tồn tại hoặc đã soft-delete.
 * Chạy lúc khởi động để dữ liệu cũ (trước khi có resolve) không làm nhiễu UI.
 */
export async function purgeOrphanQualityAlerts(): Promise<number> {
  const rows = await runtimeQuery<any>(
    `UPDATE quality_alerts qa
        LEFT JOIN cors_admin.stations s
               ON qa.target_type = 'station' AND s.id = qa.target_id
        LEFT JOIN cors_admin.relay_jobs r
               ON qa.target_type = 'relay_job' AND r.id = qa.target_id AND r.deleted_at IS NULL
        SET qa.resolved_at = UTC_TIMESTAMP(3)
      WHERE qa.resolved_at IS NULL
        AND ((qa.target_type = 'station' AND s.id IS NULL)
          OR (qa.target_type = 'relay_job' AND r.id IS NULL))`
  );
  return Number(rows?.affectedRows ?? 0);
}
