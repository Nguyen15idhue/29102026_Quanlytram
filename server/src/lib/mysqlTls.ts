/**
 * Quyết định bật TLS cho MySQL.
 * - MYSQL_TLS=true/false: ép bật/tắt.
 * - auto: bật khi host là IP public/FQDN; tắt với loopback, RFC1918 và tên
 *   service nội bộ Docker (không có dấu chấm).
 */
export function useMysqlTls(host: string, mode: string | undefined): boolean {
  const value = String(mode ?? '').trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;

  const h = host.trim();
  if (!h || h === 'localhost' || h === '::1') return false;
  if (h.startsWith('127.')) return false;
  if (h.startsWith('10.') || h.startsWith('192.168.')) return false;
  if (h.startsWith('172.')) {
    const second = Number(h.split('.')[1]);
    if (Number.isInteger(second) && second >= 16 && second <= 31) return false;
  }
  return h.includes('.');
}
