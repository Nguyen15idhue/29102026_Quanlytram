/**
 * Khi tài khoản bắt buộc đổi mật khẩu (import mặc định 123456), chỉ các API
 * phục vụ đăng nhập/đổi mật khẩu được phép gọi.
 */
export function mustChangePasswordAllowed(path: string): boolean {
  const clean = path.split('?')[0];
  return (
    clean === '/api/auth/me' ||
    clean === '/api/auth/logout' ||
    clean === '/api/auth/login' ||
    clean.startsWith('/api/profile')
  );
}
