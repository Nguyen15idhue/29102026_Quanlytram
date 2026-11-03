export interface SourceTarget {
  host: string;
  port: number;
  tls: boolean;
}

/**
 * Credential đã lưu chỉ được tái sử dụng khi đích kết nối trùng khớp tuyệt đối.
 * Khác host/port/TLS thì bắt buộc nhập lại mật khẩu, tránh gửi credential
 * của trạm sang máy khác.
 */
export function sameSourceTarget(saved: any, target: SourceTarget): boolean {
  if (!saved) return false;
  return (
    String(saved.client_host || '').trim().toLowerCase() === target.host.trim().toLowerCase() &&
    Number(saved.client_port) === target.port &&
    Boolean(Number(saved.client_tls)) === Boolean(target.tls)
  );
}
