# 05 — KẾ HOẠCH CÔNG TY NHIỀU ADMIN

> Ngày lập: 2026-11-01
> Nguồn: yêu cầu chủ dự án + rà soát `graphify` + mã nguồn hiện tại
> Trạng thái: **KẾ HOẠCH — chưa sửa code**
> Mục tiêu: một công ty có nhiều admin cùng quản lý tài nguyên công ty; các
> công ty độc lập; super_admin quản lý toàn bộ và biết tài nguyên thuộc công ty nào.

## 1. Kết luận rà soát hiện trạng

Mã hiện tại **chưa đáp ứng đủ** mô hình nhiều admin/công ty.

Đã có:

- Cây `web_users.parent_user_id` và role level `super_admin=100`, `admin=50`,
  `user=10`.
- Scope `all | subtree | tenant | own | none`; `tenantRootId` lấy admin cao
  nhất không phải `super_admin` trong chuỗi cha.
- `listScope` / `assertRecordScope` lọc theo `owner_web_user_id`.
- Admin không tạo được user có role level ≥ mình; không sửa role.
- Tài nguyên có `owner_web_user_id`: stations, mountpoints, ntrip_accounts,
  relay_jobs, caster_listeners, station_probes, alerts.

Chưa có:

- Bảng `companies`/`tenants`; không có `company_id` trên user/tài nguyên.
- Nhiều admin cùng một công ty: admin level 50 không tạo được admin level 50;
  nếu super tạo nhiều admin anh em thì mỗi admin thành một tenant riêng.
- API/UI cho super admin biết tài nguyên thuộc công ty nào (chỉ có owner id,
  một số trang không hiện owner).
- Chính sách company-wide thống nhất cho mountpoint/NTRIP account (hiện `own`).

Tài liệu P1 cũng đã ghi: tenant dựa trên `parent_user_id`, chưa có bảng
company riêng; nếu cần nhiều công ty độc lập hơn thì bổ sung `company_id`.

## 2. Mô hình đích

```text
super_admin
├── Công ty A (company_id = 1)
│   ├── admin A1 (role admin, company_id = 1)
│   ├── admin A2 (role admin, company_id = 1)
│   └── user A1 (role user, company_id = 1, parent = admin A1)
└── Công ty B (company_id = 2)
    ├── admin B1 (role admin, company_id = 2)
    └── user B1 (role user, company_id = 2, parent = admin B1)
```

Nguyên tắc:

- `companies` là tenant root thực thể. `company_id` quyết định phạm vi công ty.
- `parent_user_id` chỉ còn là cây báo cáo/quản lý nội bộ, không quyết định
  tenant.
- Nhiều admin cùng `company_id` chia sẻ tài nguyên công ty.
- `super_admin.company_id = NULL`, scope `all`.
- Tài nguyên có `company_id`; `owner_web_user_id` vẫn giữ để biết người tạo/chủ.

## 3. Quyết định cần chốt

| Mã | Quyết định | Đề xuất |
|---|---|---|
| D05-1 | Ai tạo admin thứ 2 của công ty? | Super tạo company + admin đầu; admin hiện tại được tạo peer admin cùng company |
| D05-2 | Admin có được sửa/khóa/xóa peer admin? | Không. Chỉ super_admin được quản lý admin; peer admin chỉ xem |
| D05-3 | `mountpoints`/`ntrip_accounts` company-wide hay own? | Company-wide cho admin; user giữ `own` theo D3 hiện tại |
| D05-4 | Tài nguyên tạo bởi super_admin mặc định thuộc company nào? | Bắt buộc chọn company khi tạo; không mặc định |
| D05-5 | Owner null/legacy xử lý thế nào? | Gán company theo admin subtree nếu suy ra được; còn lại để super xử lý |
| D05-6 | Có cần company root user riêng? | Không. Dùng bảng `companies`; admin đầu tiên là reporting root |
| D05-7 | Listener caster thuộc công ty hay toàn hệ thống? | **Toàn hệ thống**. Chỉ super_admin tạo/sửa/xóa; mọi công ty được xem tất cả |
| D05-8 | Mountpoint dưới listener hiển thị thế nào? | Listener global; danh sách mountpoint liên kết lọc theo company của actor, super thấy tất cả |
| D05-9 | Owner khi super admin tạo tài nguyên? | Bắt buộc chọn company; owner mặc định là super (created_by) trừ khi chỉ định owner cùng company. Tài nguyên vẫn hiển thị cho company qua `company_id` |
| D05-10 | Company disable ảnh hưởng gì? | Chặn đăng nhập + vô hiệu session cũ của user thuộc company; không xóa tài nguyên; super vẫn truy cập |

## 4. Thay đổi dữ liệu

### 4.1. Bảng `companies`

Migration `db/migrations/admin/028_companies.sql`:

```sql
CREATE TABLE companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  notes VARCHAR(500) NOT NULL DEFAULT '',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_companies_code (code),
  CONSTRAINT fk_companies_created_by
    FOREIGN KEY (created_by) REFERENCES web_users(id) ON DELETE SET NULL
);
```

### 4.2. `web_users.company_id`

- Thêm `company_id BIGINT UNSIGNED NULL`, FK `companies(id)`.
- `super_admin` để `NULL`; admin/user bắt buộc có company.
- Backfill:
  1. Với mỗi admin cấp cao nhất không phải super_admin, tạo company
     (`code = admin.username`, `name = admin.display_name`).
  2. Gán `company_id` cho admin đó và toàn bộ descendants.
  3. Super_admin giữ `NULL`.
- Unique/index: `KEY idx_web_users_company (company_id)`.

### 4.3. `company_id` trên tài nguyên

Thêm cột `company_id BIGINT UNSIGNED NULL` + index cho:

- `stations`
- `mountpoints`
- `ntrip_accounts`
- `relay_jobs`
- `relay_credentials`
- `station_probes`
- `alerts`
- `audit_logs` (nullable; để lọc theo công ty)

**Không thêm `company_id` cho `caster_listeners`.** Listener là hạ tầng toàn
hệ thống: cổng/role không được trùng giữa các công ty; chỉ super_admin được
tạo/sửa/xóa. Mọi công ty được xem danh sách listener.

Backfill: `company_id = company_id của owner_web_user_id`.
Nếu owner null: để null và ghi danh sách cần super xử lý.

### 4.4. Bất biến dữ liệu

- Mọi bản ghi mới: `company_id` lấy từ actor (admin/user) hoặc bắt buộc chọn
  nếu actor là super_admin.
- Không cho `owner_web_user_id` thuộc company khác `company_id`.
- Khi đổi owner: owner mới phải cùng company.
- Khi company bị disable: tài nguyên company không bị xóa; chỉ chặn truy cập
  theo chính sách cần chốt.

## 5. Thay đổi RBAC

### 5.1. Scope

Giữ enum hiện tại, định nghĩa lại:

| Scope | Ý nghĩa mới |
|---|---|
| `all` | Super admin, toàn hệ thống |
| `tenant` | Toàn bộ tài nguyên có `company_id = actor.company_id` |
| `subtree` | Bản thân + descendants theo `parent_user_id` (dùng cho cây user) |
| `own` | `owner_web_user_id = actor.id` |
| `none` | Không có quyền |

- Bỏ phụ thuộc `tenantRootId`/`tenantIds` cho tài nguyên; thay bằng
  `companyIdForUser` và `companyUserIds`.
- `subtreeIds` vẫn giữ cho quản lý user/reporting.

### 5.2. Ma trận quyền đề xuất

| Module | Super admin | Admin | User |
|---|---|---|---|
| Companies | all | none | none |
| Web users view | all | tenant | own/profile |
| Web users add/edit/delete | all | tenant + policy peer admin | none |
| Stations/Relay view | all | tenant | tenant |
| Stations/Relay add/edit/delete | all | tenant | none |
| Mountpoints/NTRIP accounts | all | tenant | own |
| Caster/Listener view | all | all (global) | none |
| Caster/Listener add/edit/delete | all | none | none |
| Alerts/Quality | all | tenant | own view |
| Audit/History | all | tenant | none |
| System Health/Settings | all | none | none |
| Roles | all | view all, read-only | none |

### 5.3. Quy tắc quản lý user/admin

- `canManageRole` mở rộng:
  - Super admin: mọi role trừ vi phạm bất biến super_admin cuối cùng.
  - Admin:
    - Tạo/sửa user level thấp hơn trong cùng company: được.
    - Tạo peer admin level bằng mình trong cùng company: được nếu D05-1 chốt.
    - Sửa/khóa/xóa peer admin: không (D05-2).
    - Không tạo/sửa `super_admin`.
- `resolveParent`:
  - Admin/user: parent mặc định là actor; parent phải cùng company.
  - Super admin: được chọn parent; nếu parent khác company thì từ chối.
  - Peer admin: parent là admin root của company (admin đầu tiên), không tạo
    chu trình.
- `assertCanTarget`: kiểm tra company, level, peer-admin policy.

## 6. Thay đổi API

### 6.1. Companies

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/companies?q=&page=&pageSize=` | `companies.view` (super) |
| POST | `/api/companies` | `companies.add` (super) |
| PATCH | `/api/companies/:id` | `companies.edit` (super) |
| POST | `/api/companies/:id/disable` | `companies.edit` (super) |
| GET | `/api/companies/:id/users` | `companies.view` (super) |

### 6.2. Web users

- `POST /api/web-users` nhận `company_id`:
  - Super: bắt buộc hoặc suy ra từ parent.
  - Admin: bỏ qua input, ép `actor.company_id`.
- `GET /api/web-users` trả thêm `companyId`, `companyName`.
- `GET /api/web-users/:id` trả company.
- Import Excel: thêm cột `company_code` (super) hoặc ép company của admin.
- Không export password/secret.

### 6.3. Tài nguyên

Tất cả list/detail trả thêm:

- `companyId`
- `companyName`
- `ownerWebUserId`
- `ownerName`

Áp dụng: stations, mountpoints, ntrip_accounts, relay_jobs, station_probes,
alerts, audit.

Riêng `caster_listeners`:
- Không trả `companyId`/`companyName` vì là tài nguyên toàn hệ thống.
- Trả `global: true`, `ownerWebUserId`, `ownerName`.
- Mọi công ty được xem toàn bộ listener.
- Danh sách mountpoint liên kết với listener lọc theo company của actor;
  super_admin thấy tất cả.

List filter thêm `companyId` cho super admin.

## 7. Thay đổi UI

### 7.1. Super admin

- Menu mới **Công ty** (chỉ super_admin).
- Trang công ty: danh sách, tạo/sửa/disable, xem admin/user thuộc công ty.
- Các bảng tài nguyên thêm cột **Công ty** và filter công ty:
  - Trạm, Relay, Mountpoint, NTRIP account.
- Listener: mọi công ty thấy toàn bộ; chỉ super_admin thấy nút thêm/sửa/xóa.
- Drawer chi tiết hiển thị company + owner dạng tên, không chỉ id.

### 7.2. Admin công ty

- Không thấy menu Công ty.
- Thấy toàn bộ user/tài nguyên cùng company.
- Tạo user; tạo peer admin nếu D05-1 cho phép.
- Không thấy/sửa admin công ty khác.
- Xem được toàn bộ listener caster (global); không có nút thêm/sửa/xóa.
- Không thấy System Health/Settings/Roles edit.

### 7.3. User

- Giữ hành vi hiện tại: xem trạm/relay/dashboard toàn company; module cá nhân
  theo `own`.
- Không thấy menu quản trị.

## 8. Migration và backfill

### 8.1. Thứ tự migration

1. `admin/028_companies.sql`: bảng companies.
2. `admin/029_web_users_company.sql`: `web_users.company_id` + backfill company.
3. `admin/030_resource_company.sql`: thêm `company_id` cho tài nguyên + backfill.
4. `admin/031_rbac_company_scope.sql`: cập nhật role_permissions sang `tenant`
   cho admin ở các module company-wide.
5. `runtime/007_*` chỉ khi cần lưu company cho dữ liệu runtime; mặc định không.

### 8.2. Backfill company

- Tạo company cho từng admin root hiện có.
- Gán toàn bộ descendants.
- Gán tài nguyên theo owner.
- Báo cáo các bản ghi owner null/không suy ra được.
- Không tự gán company cho super_admin.

### 8.3. Rollback

- Giữ migration tăng dần; không sửa migration đã chạy.
- Rollback bằng migration mới hoặc restore backup; không drop cột trực tiếp
  trên production.

## 9. Test plan

| ID | Nội dung | Kỳ vọng |
|---|---|---|
| 05-T1 | Migration + backfill | Company tạo đúng; user/tài nguyên có company_id |
| 05-T2 | Công ty A có admin A1, A2 | Cả hai thấy cùng tài nguyên A |
| 05-T3 | Admin A1 tạo peer admin A2 | PASS nếu D05-1 cho phép; audit |
| 05-T4 | Admin A1 sửa/khóa admin A2 | 403 |
| 05-T5 | Admin A tạo super_admin | 403 |
| 05-T6 | Admin A xem/tài nguyên B | 404/403 |
| 05-T7 | User A1 xem trạm/relay A | Thấy toàn company A |
| 05-T8 | User A1 xem mountpoint/NTRIP của user A2 | Theo D05-3 |
| 05-T9 | Super admin xem tất cả | Thấy company/owner đúng |
| 05-T10 | Super admin tạo tài nguyên không chọn company | 400 |
| 05-T11 | Đổi owner khác company | 400 |
| 05-T12 | Company disable | Tài nguyên không xóa; truy cập theo chính sách |
| 05-T13 | Audit | Ghi company, owner, action; không secret |
| 05-T14 | Import/export user | Company đúng; không password |
| 05-T15 | Regression RBAC cũ | Không lọt quyền; test cũ PASS |
| 05-T16 | Admin công ty tạo/sửa/xóa listener | 403 |
| 05-T17 | Super admin tạo listener trùng cổng/role | 409, không tạo |
| 05-T18 | Công ty A và B xem listener | Cả hai thấy toàn bộ listener |
| 05-T19 | Admin A xem mountpoint gắn listener | Chỉ thấy mountpoint company A; super thấy tất cả |

## 10. File/khu vực dự kiến

**Database**

- `db/migrations/admin/028_companies.sql`
- `db/migrations/admin/029_web_users_company.sql`
- `db/migrations/admin/030_resource_company.sql`
- `db/migrations/admin/031_rbac_company_scope.sql`

**Server**

- `server/src/rbac/scope.ts`
- `server/src/rbac/access.ts`
- `server/src/rbac/matrix.ts`
- `server/src/routes/companies.ts` (mới)
- `server/src/routes/webUsers.ts`
- `server/src/routes/stations.ts`
- `server/src/routes/mountpoints.ts`
- `server/src/routes/ntripAccounts.ts`
- `server/src/routes/relayJobs.ts`
- `server/src/routes/caster.ts`
- `server/src/routes/quality.ts`
- `server/src/routes/audit.ts`
- `server/src/routes/history.ts`
- `server/src/db/seed.ts`
- `server/src/app.ts`

**Frontend**

- `frontend/src/pages/Companies.tsx` (mới)
- `frontend/src/pages/WebUsers.tsx`
- `frontend/src/pages/Stations.tsx`
- `frontend/src/pages/RelayJobs.tsx`
- `frontend/src/pages/Mountpoints.tsx`
- `frontend/src/pages/NtripAccounts.tsx`
- `frontend/src/pages/Caster.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/App.tsx`
- `frontend/src/types.ts`

**Docs**

- `docs/api.md`
- `docs/1/05_KE_HOACH_CONG_TY_NHIEU_ADMIN.md`
- `TASKS.md`
- `SESSION.md`

## 11. Phân kỳ triển khai

### P05-1 — Schema & backfill

- [x] Tạo bảng companies.
- [x] Thêm company_id cho web_users.
- [x] Backfill company theo admin root.
- [x] Thêm company_id cho tài nguyên + backfill.
- [x] Test migration idempotent.

Ghi chú P05-1 (2026-11-01):

- Migration `admin/028_companies.sql`, `029_web_users_company.sql`,
  `030_resource_company.sql` đã chạy PASS trên dữ liệu test.
- Thêm bảng `company_backfill_reports` để lưu danh sách owner null /
  owner không suy ra được company; super admin xử lý sau.
- Backfill tạo company cho admin root (`code = username`), gán company cho
  admin root + toàn bộ descendants.
- Tài nguyên lấy `company_id` theo `owner_web_user_id`; tài nguyên thuộc
  super_admin (`company_id = NULL`) được ghi báo cáo `owner_without_company`.
- Không thêm `company_id` cho `caster_listeners` (D05-7).
- Đã chạy lại 029/030 thủ công: không phát sinh bản ghi trùng (idempotent).

### P05-2 — RBAC company

- [x] `companyIdForUser`, `companyUserIds`.
- [x] `tenant` dùng company_id.
- [x] `assertRecordScope` kiểm tra company.
- [x] Ma trận quyền admin company-wide.
- [x] Peer admin policy.

Ghi chú P05-2 (2026-11-01):

- `tenantIds` = toàn bộ user cùng `company_id`; fallback subtree nếu user chưa
  có company (legacy) để tránh lockout.
- `listScope`/`assertRecordScope` nhận `companyColumn`/`companyId`; các route
  stations/mountpoints/ntrip_accounts/relay_jobs/alerts dùng `company_id` cho
  `tenant`, giữ `own` theo owner.
- `canAssignRole` (≤ level) cho tạo/gán role; `canManageRole` (< level) cho
  sửa/khóa/xóa. Admin tạo được peer admin nhưng `assertCanTarget` chặn sửa
  peer admin (D05-2).
- `resolveParent` bắt buộc parent cùng company; admin tạo peer admin đặt parent
  = admin root của company; chống chu trình.
- Auth/login kiểm tra company `active`; company `disabled` chặn login và
  `requireAuth` từ chối session cũ (D05-10).
- Migration `031_rbac_company_scope.sql` + `032_company_permission_fix.sql`
  (admin `companies.*` = none; caster.view = all; caster add/edit/delete = none).
- Test: server tsc PASS; vitest 61/61 PASS.

### P05-3 — API

- [x] Companies CRUD.
- [x] Web users company.
- [x] Tài nguyên trả company/owner.
- [x] Filter company cho super.
- [x] Audit company.

Ghi chú P05-3 (2026-11-01):

- `server/src/routes/companies.ts` + mount `/api/companies`; chỉ super
  (`requireSuper` + `companies.*`).
- `resolveWriteOwnership` dùng chung: super bắt buộc `company_id` (hoặc suy ra
  từ owner) → thiếu trả 400 `COMPANY_REQUIRED`; admin ép company của mình;
  owner khác company → 400 `OWNER_COMPANY_MISMATCH`.
- Resource trả `company_id`/`company_name`, `owner_web_user_id`/`owner_name`;
  web users trả `companyId`/`companyName`/`companyStatus`.
- List filter `companyId` cho super: stations, mountpoints, ntrip-accounts,
  relay-jobs, alerts, web-users, audit-logs.
- Listener: `global: true`, `ownerWebUserId`, `ownerName`; admin xem tất cả,
  không CRUD; mountpoint liên kết lọc theo company (D05-8).
- Audit ghi `company_id` (ưu tiên company của tài nguyên, fallback actor) và
  redact secret.
- Import user thêm `company_code`; admin ép company; không export password.
- Đã kiểm thử API thực tế: 29/29 check PASS (T2–T7, T9–T13, T16–T19).

### P05-4 — UI

- [ ] Menu/trang Công ty.
- [ ] Cột/filter Công ty.
- [ ] Drawer hiển thị company/owner tên.
- [ ] Form user chọn company (super).
- [ ] Responsive/dark mode/a11y.

### P05-5 — Test & rollout

- [ ] Test matrix 05-T1..T19.
- [ ] Regression RBAC/API cũ.
- [ ] Chạy trên dữ liệu test; backup trước migration.
- [ ] Cập nhật SESSION/TASKS/api.
- [ ] Graphify update sau khi đổi cấu trúc.

## 12. Rủi ro

- **Nâng quyền peer admin:** phải chặn sửa/khóa/xóa peer admin và super_admin.
- **Backfill sai company:** owner null hoặc parent lộn; cần báo cáo trước khi ghi.
- **Drift company_id:** phải kiểm tra khi create/update/transfer owner.
- **Scope `tenant` cũ:** mọi chỗ dùng `tenantIds` phải đổi sang company; nếu bỏ
  sót sẽ lọt dữ liệu.
- **UI filter:** page/filter phải lưu URL; không pageSize=100.
- **Company disable:** cần chốt là chặn đăng nhập hay chỉ chặn tạo mới.
- **Listener dùng chung:** cổng/role là tài nguyên toàn hệ thống; chỉ
  super_admin CRUD, nếu cho admin CRUD sẽ trùng cổng hoặc phá listener của
  công ty khác.
- **Lộ mountpoint qua listener:** listener global nhưng danh sách mountpoint
  liên kết phải lọc theo company; không trả toàn bộ mountpoint cho admin.
- **Migration production:** backup trước; không sửa migration đã chạy.

## 13. Tiêu chí nghiệm thu

1. Công ty A có ≥2 admin cùng thấy/quản lý tài nguyên A.
2. Admin A không thấy tài nguyên/user công ty B.
3. Super admin thấy tất cả, mỗi tài nguyên có company + owner rõ ràng.
4. User nằm dưới admin/company đúng; không thấy công ty khác.
5. Không nâng quyền; super_admin cuối cùng không bị xóa.
6. Listener là toàn hệ thống: chỉ super_admin CRUD; mọi công ty xem được.
7. Migration/backfill có báo cáo; test 05-T1..T19 PASS.
8. Test cũ RBAC/API/UI vẫn PASS; không lộ secret.
