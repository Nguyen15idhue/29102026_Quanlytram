/**
 * Câu SQL đếm kết quả cho danh sách mountpoint.
 *
 * Điều kiện WHERE của route có thể tham chiếu `s.name` (tìm theo tên trạm),
 * nên câu COUNT bắt buộc phải JOIN `stations` giống câu SELECT; nếu thiếu,
 * MySQL trả `Unknown column 's.name' in 'where clause'`.
 */
export function mountpointCountSql(where: string): string {
  return `SELECT COUNT(*) AS total
            FROM mountpoints m
            LEFT JOIN stations s ON s.id = m.station_id
           WHERE ${where}`;
}
