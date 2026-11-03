import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError } from './http';

/**
 * Kiểm tra địa chỉ đích trước khi server mở kết nối ra ngoài (chống SSRF).
 *
 * Chặn loopback, link-local (metadata 169.254.169.254), unspecified và
 * multicast. Cho phép RFC1918 để relay/nguồn nội bộ vẫn hoạt động.
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  const mapped = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;

  if (isIP(mapped) === 4) {
    const parts = mapped.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (isIP(mapped) === 6) {
    if (mapped === '::' || mapped === '::1') return true;
    if (mapped.startsWith('fe8') || mapped.startsWith('fe9') || mapped.startsWith('fea') || mapped.startsWith('feb')) {
      return true; // fe80::/10 link-local
    }
    if (mapped.startsWith('ff')) return true; // multicast
    return false;
  }

  return true;
}

/**
 * Phân giải hostname và trả về IP an toàn đầu tiên. Ném ApiError nếu host
 * không phân giải được hoặc có bất kỳ IP bị chặn (chống DNS rebinding bằng
 * cách dùng chính IP đã kiểm tra để kết nối).
 */
export async function resolveSafeHost(host: string): Promise<string> {
  const trimmed = host.trim();
  if (!trimmed) throw new ApiError(400, 'INVALID_HOST', 'Host không hợp lệ');

  const rows = await lookup(trimmed, { all: true, verbatim: true }).catch(() => {
    throw new ApiError(400, 'INVALID_HOST', 'Không phân giải được host');
  });
  if (rows.length === 0) throw new ApiError(400, 'INVALID_HOST', 'Không phân giải được host');

  for (const row of rows) {
    if (isBlockedAddress(row.address)) {
      throw new ApiError(400, 'HOST_NOT_ALLOWED', 'Địa chỉ đích không được phép');
    }
  }
  return rows[0].address;
}
