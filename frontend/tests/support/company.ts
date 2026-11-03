import { expect, type APIRequestContext } from '@playwright/test';

/**
 * super_admin không thuộc công ty nào, nên API tạo tài nguyên bắt buộc phải
 * truyền company_id (COMPANY_REQUIRED). Test lấy công ty seed DOCS_DEMO trước,
 * fallback về công ty đầu tiên để suite vẫn chạy trên DB khác.
 */
export async function pickCompanyId(context: APIRequestContext): Promise<number> {
  const response = await context.get('/api/companies?page=1&pageSize=50');
  expect(response.status(), 'GET /api/companies').toBe(200);
  const body = (await response.json()) as {
    items?: Array<{ id: number; code: string }>;
  };
  const items = body.items ?? [];
  const docs = items.find((item) => item.code === 'DOCS_DEMO');
  const id = docs?.id ?? items[0]?.id;
  expect(id, 'Cần ít nhất một công ty để tạo dữ liệu test').toBeTruthy();
  return Number(id);
}
