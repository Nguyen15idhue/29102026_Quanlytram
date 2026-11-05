export const GUIDE_PATH = '/guide/';
export const GUIDE_ENTRY = '/guide/index.html';
export const GUIDE_TITLE = 'Hướng dẫn sử dụng';
export const GUIDE_BUILD_HINT = 'npm run build:guide';

// Chương tổng quát dùng cho deep-link từ trang Trạm/Mountpoint/Tài khoản.
export const GUIDE_DOC = 'huong-dan-tong-quat';

const SAFE_SEGMENT = /^[a-z0-9-]+$/i;

/**
 * URL của một chương trong tài liệu (dùng cho iframe).
 * Slug không hợp lệ thì trả về trang chủ tài liệu.
 */
export function guideUrl(doc?: string | null, anchor?: string | null): string {
  const cleanDoc = String(doc ?? '').trim();
  if (!cleanDoc || !SAFE_SEGMENT.test(cleanDoc)) return GUIDE_PATH;
  const base = `${GUIDE_PATH}${cleanDoc}/`;
  const cleanAnchor = String(anchor ?? '').trim();
  return cleanAnchor && SAFE_SEGMENT.test(cleanAnchor) ? `${base}#${cleanAnchor}` : base;
}

/**
 * Link trong ứng dụng tới trang Hướng dẫn, mở đúng chương + mã neo.
 * Ví dụ: guideHref('tao-tram') → /guide?doc=huong-dan-tong-quat&anchor=tao-tram
 */
export function guideHref(anchor?: string, doc: string = GUIDE_DOC): string {
  const params = new URLSearchParams();
  if (doc) params.set('doc', doc);
  if (anchor) params.set('anchor', anchor);
  const query = params.toString();
  return query ? `/guide?${query}` : '/guide';
}
