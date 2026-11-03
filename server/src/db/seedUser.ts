/**
 * SQL seed tài khoản hệ thống.
 *
 * Khi tài khoản đã tồn tại, chỉ giữ nguyên (`id = id`): không ghi đè
 * status/role/company/display_name/email. Nhờ vậy khoá tài khoản để ứng phó
 * sự cố hoặc đổi quyền sẽ không bị seed lúc khởi động revert.
 */
export const SEED_USER_UPSERT_SQL = `INSERT INTO web_users
   (username, password_hash, display_name, email, role_id, parent_user_id, company_id, created_by)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
 ON DUPLICATE KEY UPDATE id = id`;
