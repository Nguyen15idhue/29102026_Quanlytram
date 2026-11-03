import { callGoInternal } from './internalApi';

const RUNTIME_TARGETS = ['station', 'relay_job'] as const;
export type QualityTargetType = (typeof RUNTIME_TARGETS)[number];

/**
 * Đóng các cảnh báo chất lượng còn mở của một target vừa bị xoá.
 * Ghi `cors_runtime` phải do Go thực hiện (Node chỉ có SELECT trên runtime),
 * nên gọi internal API thay vì UPDATE trực tiếp.
 * Trả về số dòng đã resolve; lỗi Go không chặn thao tác xoá.
 */
export async function resolveQualityAlerts(
  targetType: QualityTargetType,
  targetId: number
): Promise<number> {
  try {
    const result = await callGoInternal<{ resolved?: number }>(
      '/internal/quality/resolve',
      { targetType, targetId },
      { timeoutMs: 3000 }
    );
    return Number(result?.resolved ?? 0);
  } catch (error) {
    console.warn(
      '[quality] resolve alerts failed',
      error instanceof Error ? error.message : error
    );
    return 0;
  }
}

/**
 * Dọn cảnh báo mồ côi: target không còn tồn tại hoặc đã soft-delete.
 * Chạy lúc khởi động để dữ liệu cũ (trước khi có resolve) không làm nhiễu UI.
 */
export async function purgeOrphanQualityAlerts(): Promise<number> {
  const result = await callGoInternal<{ resolved?: number }>(
    '/internal/quality/purge-orphans',
    undefined,
    { timeoutMs: 5000 }
  );
  return Number(result?.resolved ?? 0);
}
