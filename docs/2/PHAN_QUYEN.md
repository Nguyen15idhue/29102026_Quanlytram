# PHÂN QUYỀN & PHẠM VI DỮ LIỆU — HỆ THỐNG QUẢN LÝ CORS

> Phiên bản: 1.0 — 2026-11-01
> Trạng thái: hiện hành sau kế hoạch 05 (công ty nhiều admin)
> Phạm vi: web session, RBAC, company, ownership, listener toàn hệ thống,
> realtime, audit, UI và checklist test.
>
> Nguồn sự thật:
> - `AGENTS.md`
> - `docs/1/05_KE_HOACH_CONG_TY_NHIEU_ADMIN.md`
> - `docs/api.md`
> - Mã nguồn: `server/src/rbac/*`, `server/src/middleware/*`,
>   `server/src/routes/*`, `server/src/realtime/*`,
>   `frontend/src/components/Layout.tsx`, `frontend/src/pages/*`
> - Migration: `db/migrations/admin/017`–`033`
>
> Tài liệu này mô tả **hành vi thực tế của mã hiện tại**, kể cả các điểm còn
> lệch chuẩn. Các điểm lệch được ghi rõ ở mục 14 để test/reconcile.

## Mục lục

- [0. TL;DR](#0-tldr--5-quy-tắc-quan-trọng-nhất)
- [1. Mô hình dữ liệu phân quyền](#1-mô-hình-dữ-liệu-phân-quyền)
- [2. Đăng nhập, phiên, CSRF](#2-đăng-nhập-phiên-csrf-và-company-disabled)
- [3. Scope và cách áp dụng](#3-scope-định-nghĩa-và-cách-áp-dụng-thực-tế)
- [4. Danh mục permission và ma trận](#4-danh-mục-permission-và-ma-trận-mặc-định)
- [5. Quyền theo vai trò](#5-quyền-theo-vai-trò--bảng-tổng-hợp)
- [6. Công ty và nhiều admin](#6-công-ty-và-nhiều-admin)
- [7. Cây user, parent, chống nâng quyền](#7-cây-user-parent-và-chống-nâng-quyền)
- [8. Quyền chi tiết theo module](#8-quyền-chi-tiết-theo-module)
- [9. Owner, company và bất biến](#9-quy-tắc-owner-company-và-các-trường-bất-biến)
- [10. Mã lỗi](#10-mã-lỗi-và-ý-nghĩa-khi-test)
- [11. UI menu và nút](#11-ui--menu-và-nút-theo-vai-trò)
- [12. Realtime/Socket.IO](#12-realtime--socketio)
- [13. Audit và bảo mật](#13-audit-và-bảo-mật)
- [14. Known gaps](#14-điểm-lệch--known-gaps-hiện-tại)
- [15. Checklist test chi tiết](#15-checklist-test-chi-tiết)
- [16. Lệnh kiểm tra](#16-lệnh-kiểm-tra-và-bằng-chứng-hiện-tại)
- [17. Phụ lục endpoint](#17-phụ-lục--endpoint--permission-nhanh)
- [18. Kết luận cho người test](#18-kết-luận-ngắn-cho-người-test)

---

## 0. TL;DR — 5 quy tắc quan trọng nhất

1. **Super admin** (`super_admin`, level 100): thấy và làm mọi thứ; không bị
   giới hạn company. Không được xóa/khóa/hạ cấp super admin cuối cùng.
2. **Admin công ty** (`admin`, level 50): chỉ thấy và thao tác tài nguyên của
   **cùng `company_id`**. Được tạo peer admin cùng công ty nhưng **không được
   sửa/khóa/xóa peer admin**. Không quản lý company, listener, role, system health.
3. **User** (`user`, level 10):
   - Xem **toàn company** cho Trạm, Relay, Dashboard, Lịch sử relay.
   - Chỉ **own** cho Mountpoint, NTRIP account, Cảnh báo, Chất lượng.
   - Không thấy Listener, Người dùng, Phân quyền, Công ty, Audit, System Health.
4. **Listener caster là tài nguyên toàn hệ thống**: mọi công ty xem tất cả,
   **chỉ super admin** được tạo/sửa/xóa. Danh sách mountpoint gắn listener bị
   lọc theo company của người xem (super thấy tất cả).
5. **`tenant` = `company_id`**, không còn là subtree `parent_user_id`.
   `parent_user_id` chỉ còn là cây báo cáo/quản lý nội bộ.

---

## 1. Mô hình dữ liệu phân quyền

```text
roles (level)                 permissions
  super_admin  100              module.action
  admin         50              scope: all | subtree | tenant | own | none
  user          10
        │                              │
        └──────── role_permissions ────┘
                    (role_id, permission_id, scope)

web_users
  id
  role_id
  parent_user_id  ── cây báo cáo/quản lý
  company_id      ── tenant thực tế
  status          ── active | locked | disabled

companies
  id, code, name, status (active | disabled)

Tài nguyên có company + owner
  stations, mountpoints, ntrip_accounts, relay_jobs,
  relay_credentials, station_probes, alerts, audit_logs
    company_id          ── công ty sở hữu
    owner_web_user_id   ── người tạo/chủ

caster_listeners
  KHÔNG có company_id  ── tài nguyên toàn hệ thống
```

### 1.1. Bất biến chính

- `super_admin.company_id = NULL`.
- `admin`/`user` phải có `company_id` (trừ dữ liệu legacy chưa backfill được).
- Tài nguyên mới phải có `company_id`; owner phải cùng company (trừ owner là
  super admin).
- Không đổi `company_id` của tài nguyên sau khi tạo (`COMPANY_IMMUTABLE`).
- Không chuyển owner sang user khác company (`OWNER_COMPANY_MISMATCH`).
- `caster_listeners` không có company, không bị lọc theo company khi xem danh sách.

---

## 2. Đăng nhập, phiên, CSRF và company disabled

### 2.1. Đăng nhập

| Bước | Hành vi |
|---|---|
| `POST /api/auth/login` | Public, rate limit riêng |
| Kiểm tra username/password | Sai → `401 INVALID_CREDENTIALS` |
| `web_users.status` | `locked`/`disabled` → `403 ACCOUNT_LOCKED` |
| `companies.status` | `disabled` → `403 COMPANY_DISABLED` |
| Session | Cookie `cors_sid` HttpOnly, SameSite=Lax, TTL theo `SESSION_TTL_HOURS` |
| Response | `user`, `csrfToken`, `permissions` (gồm cả scope `none`) |

### 2.2. Mọi API cần đăng nhập

`requireAuth` kiểm tra:

1. Có cookie session.
2. `web_sessions.expires_at > UTC_TIMESTAMP(3)`.
3. `web_users.status = 'active'`.
4. Company của user đang `active` (hoặc user không có company).
5. Nếu company bị disable: session HTTP bị từ chối (`401`), kể cả session cũ.
   Khi super disable company, toàn bộ `web_sessions` của user công ty đó bị xóa.

### 2.3. CSRF

Mọi request ghi `POST/PUT/PATCH/DELETE` phải gửi header:

```http
X-CSRF-Token: <csrfToken>
```

Thiếu/sai → `403 CSRF_INVALID`.

### 2.4. Session bị thu hồi khi nào

- User tự đổi mật khẩu: xóa các session khác, giữ session hiện tại.
- Admin/super đổi mật khẩu user khác: xóa toàn bộ session của user đó.
- Khóa user (`lock`): xóa toàn bộ session.
- Disable company: xóa toàn bộ session của user thuộc company.
- Logout: xóa session hiện tại.

### 2.5. Endpoint không cần quyền module (chỉ cần đăng nhập)

| Endpoint | Ghi chú |
|---|---|
| `GET /api/auth/me` | Hồ sơ + quyền hiện tại |
| `POST /api/auth/logout` | Cần CSRF |
| `GET/PATCH /api/profile` | Tự sửa allowlist |
| `POST /api/profile/password` | Mật khẩu hiện tại + mới |
| `GET /api/profile/sessions` | Session của chính mình |
| `GET /api/dictionaries` | Dictionary đang bật |
| `GET /api/snapshot` | Snapshot realtime đã lọc theo quyền |
| `GET /api/ops/dashboard` | Dashboard đã lọc theo quyền |
| `GET /health` | Public health DB/schema |

`GET /api/ops/dashboard` không có `requirePermission` riêng nhưng dữ liệu bên
trong được lọc theo `stations.view`, `relay.view`, `mountpoints.view`,
`quality.view`, `alerts.view`, `connections.view`.

---

## 3. Scope: định nghĩa và cách áp dụng thực tế

### 3.1. Ý nghĩa

| Scope | Ý nghĩa | Cách triển khai |
|---|---|---|
| `all` | Toàn hệ thống | Không thêm điều kiện |
| `tenant` | Toàn company của actor | Tài nguyên: `company_id = actor.company_id`; user: `id IN (user cùng company)` |
| `subtree` | Bản thân + descendants theo `parent_user_id` | `owner_web_user_id IN subtreeIds` hoặc `u.id IN subtreeIds` |
| `own` | Chỉ bản ghi do actor sở hữu | `owner_web_user_id = actor.id` |
| `none` | Không có quyền | `1=0` / 403 |

### 3.2. Cột lọc thực tế theo module

| Module / API | `tenant` lọc theo | Ghi chú |
|---|---|---|
| Stations list/detail | `stations.company_id` | Super tạo resource owner super vẫn hiện cho admin qua company |
| Mountpoints list/detail | `mountpoints.company_id` | |
| NTRIP accounts list/detail | `ntrip_accounts.company_id` | |
| Relay jobs list/detail | `relay_jobs.company_id` | |
| Alerts list/detail | `alerts.company_id` | |
| Audit logs | `audit_logs.company_id` | Admin chỉ thấy audit company mình |
| Web users list/detail | `u.id IN (user cùng company_id)` | Không dùng `company_id` trực tiếp trên bảng user |
| History relay | `relay_jobs.company_id` | Sessions/events/hourly |
| Map overview | `stations.company_id` | |
| Quality | owner của station/relay thuộc company user IDs | Owner-based, không dùng `company_id` |
| Station probes | station owner/company | Tạo/sửa qua `stations.edit` |
| Caster connections | mountpoint owner thuộc company user IDs | |
| Ops dashboard / snapshot / Socket.IO | owner thuộc company user IDs / subtree | Owner-based |
| Caster listeners | Không lọc | Mọi company thấy tất cả |

### 3.3. Quy ước HTTP khi ngoài phạm vi

- List: trả danh sách rỗng/không chứa bản ghi, `total` đã lọc.
- Detail/update/delete: trả `404 NOT_FOUND` (không lộ sự tồn tại).
- Thiếu quyền module: `403 FORBIDDEN`.
- Bulk: trả `result.notFound`, `result.forbidden`, `result.skipped`.

### 3.4. Company null / dữ liệu legacy

- Super admin có `company_id = NULL`, scope `all`.
- Tài nguyên cũ owner super/null company nằm trong `company_backfill_reports`.
- Với các API lọc theo `company_id`, admin **không thấy** tài nguyên
  `company_id IS NULL`.
- Với các API owner-based (quality, dashboard, realtime, connection), tài
  nguyên owner super cũng **không thấy** vì owner không thuộc company user IDs.
- Super vẫn thấy tất cả và cần xử lý các bản ghi trong báo cáo backfill.

---

## 4. Danh mục permission và ma trận mặc định

### 4.1. Danh mục permission (43)

| Module | Action | Mã |
|---|---|---|
| alerts | view, ack | `alerts.view`, `alerts.ack` |
| audit | view | `audit.view` |
| caster | view, add, edit, delete | `caster.*` |
| companies | view, add, edit, delete | `companies.*` |
| connections | view, delete | `connections.*` |
| mountpoints | view, add, edit, delete | `mountpoints.*` |
| ntrip_accounts | view, add, edit, delete | `ntrip_accounts.*` |
| quality | view, ack | `quality.*` |
| relay | view, add, edit, delete | `relay.*` |
| roles | view, add, edit, delete | `roles.*` |
| settings | view, edit | `settings.*` (reserved, chưa có route/UI) |
| stations | view, add, edit, delete | `stations.*` |
| system_health | view | `system_health.view` |
| web_users | view, add, edit, delete | `web_users.*` |

### 4.2. Ma trận mặc định hiện hành

Ký hiệu: `all` = toàn hệ thống, `tenant` = toàn company, `own` = của mình,
`none` = không có.

| Permission | super_admin | admin | user |
|---|---|---|---|
| `alerts.view` | all | tenant | own |
| `alerts.ack` | all | tenant | none |
| `audit.view` | all | tenant | none |
| `caster.view` | all | all | none |
| `caster.add` | all | none | none |
| `caster.edit` | all | none | none |
| `caster.delete` | all | none | none |
| `companies.view` | all | none | none |
| `companies.add` | all | none | none |
| `companies.edit` | all | none | none |
| `companies.delete` | all | none | none |
| `connections.view` | all | tenant | none |
| `connections.delete` | all | tenant | none |
| `mountpoints.view` | all | tenant | own |
| `mountpoints.add` | all | tenant | own |
| `mountpoints.edit` | all | tenant | own |
| `mountpoints.delete` | all | tenant | own |
| `ntrip_accounts.view` | all | tenant | own |
| `ntrip_accounts.add` | all | tenant | own |
| `ntrip_accounts.edit` | all | tenant | own |
| `ntrip_accounts.delete` | all | tenant | own |
| `quality.view` | all | tenant | own |
| `quality.ack` | all | tenant | none |
| `relay.view` | all | tenant | tenant |
| `relay.add` | all | tenant | none |
| `relay.edit` | all | tenant | none |
| `relay.delete` | all | tenant | none |
| `roles.view` | all | all | none |
| `roles.add` | all | none | none |
| `roles.edit` | all | none | none |
| `roles.delete` | all | none | none |
| `settings.view` | all | none | none |
| `settings.edit` | all | none | none |
| `stations.view` | all | tenant | tenant |
| `stations.add` | all | tenant | none |
| `stations.edit` | all | tenant | none |
| `stations.delete` | all | tenant | none |
| `system_health.view` | all | none | none |
| `web_users.view` | all | tenant | none |
| `web_users.add` | all | tenant | none |
| `web_users.edit` | all | tenant | none |
| `web_users.delete` | all | tenant | none |

### 4.3. Cách kiểm tra quyền

1. `requireAuth` xác thực session + company active.
2. `requirePermission(module, action)` đọc `role_permissions`; không có row hoặc
   `scope = none` → `403 FORBIDDEN`.
3. Middleware gán `req.permissionScope`.
4. Route kiểm tra phạm vi bản ghi (`listScope`, `assertRecordScope`).
5. Route kiểm tra luật nghiệp vụ (company bắt buộc, owner cùng company,
   peer admin, last super, immutable field...).

Permission được đọc từ DB **mỗi request HTTP**, nên đổi quyền có hiệu lực ngay
ở request kế tiếp. UI chỉ tải permission lúc login/`/auth/me`, nên cần reload
hoặc login lại để thấy menu/nút mới.

---

## 5. Quyền theo vai trò — bảng tổng hợp

### 5.1. Super admin

| Nhóm | Quyền |
|---|---|
| Công ty | Xem/tạo/sửa/enable/disable/xóa company |
| Người dùng | Xem/tạo/sửa/khóa/xóa mọi user; tạo admin cho company bất kỳ |
| Phân quyền | Xem/sửa role, tạo/xóa role không hệ thống, sửa ma trận quyền |
| Trạm/Relay/Mountpoint/NTRIP | Toàn bộ, mọi company |
| Listener | Toàn bộ CRUD |
| Kết nối caster | Xem/ngắt mọi kết nối |
| Cảnh báo/Chất lượng | Xem/ack toàn bộ |
| Audit/Lịch sử | Toàn bộ |
| System Health | Có |

Ràng buộc super:
- Không xóa/khóa chính mình.
- Không xóa/khóa/hạ cấp **super admin active cuối cùng**.
- Không tạo user `super_admin` gắn company.
- Không đổi company của tài nguyên/user sau khi tạo.
- Tạo tài nguyên phải chọn `company_id` (trừ khi suy ra được từ owner).

### 5.2. Admin công ty

| Nhóm | Quyền |
|---|---|
| Công ty | Không (không thấy menu) |
| Người dùng | Xem toàn company; tạo user cấp thấp hơn; tạo peer admin cùng company; sửa/khóa/xóa user cấp thấp hơn |
| Peer admin | Chỉ xem; **không sửa/khóa/xóa** (403) |
| Super admin | Không quản lý (403) |
| Phân quyền | Chỉ xem, read-only |
| Trạm/Relay | Xem/thêm/sửa/xóa toàn company |
| Mountpoint/NTRIP | Toàn company |
| Listener | Xem toàn bộ; không thêm/sửa/xóa |
| Kết nối caster | Xem/ngắt kết nối thuộc mountpoint company |
| Cảnh báo/Chất lượng | Xem/ack toàn company |
| Audit/Lịch sử | Toàn company |
| System Health/Settings | Không |
| Companies | Không |

Ràng buộc admin:
- `company_id` luôn bị ép theo admin, input `company_id` khác bị bỏ qua/không có
  tác dụng với user; với tài nguyên, gửi company khác → 403.
- Owner mới phải cùng company.
- Không tạo/sửa `super_admin`.
- Không sửa role/permission (mặc định).
- Không quản lý peer admin dù cùng level 50.

### 5.3. User

| Nhóm | Quyền |
|---|---|
| Trạm | Xem toàn company; không thêm/sửa/xóa |
| Relay | Xem toàn company; không thêm/sửa/xóa |
| Dashboard | Xem số liệu company + own tùy module |
| Mountpoint | Xem/thêm/sửa/xóa **own** |
| NTRIP account | Xem/thêm/sửa/xóa **own** |
| Cảnh báo | Xem/đánh dấu đã đọc **own**; không ack |
| Chất lượng | Xem **own**; không ack |
| Lịch sử relay | Xem relay sessions/events/hourly company |
| Audit | Không |
| Listener | Không |
| Người dùng/Phân quyền/Công ty | Không |
| System Health/Settings | Không |
| Profile | Sửa `display_name`, `email`, `password` của mình |

### 5.4. Quyền tự sửa hồ sơ

User tự sửa chỉ được allowlist:

- `display_name`
- `email`
- `password`

Gửi field khác (`role_id`, `company_id`, `parent_user_id`, ...) → 403.

---

## 6. Công ty và nhiều admin

### 6.1. Mô hình

```text
super_admin
├── Company A (id=1)
│   ├── admin A1 (company_id=1)
│   ├── admin A2 (company_id=1, peer)
│   └── user A1 (company_id=1, parent=A1)
└── Company B (id=2)
    ├── admin B1 (company_id=2)
    └── user B1 (company_id=2, parent=B1)
```

- Nhiều admin cùng company chia sẻ toàn bộ tài nguyên company.
- `parent_user_id` chỉ là cây báo cáo/quản lý, không quyết định tenant.
- User không thấy company khác dù biết ID (detail trả 404).

### 6.2. Tạo admin/peer admin

| Actor | Hành vi |
|---|---|
| Super | Tạo company + admin đầu tiên; tạo admin cho company bất kỳ |
| Admin | Tạo peer admin **cùng company**; parent tự đặt = admin root của company |
| Admin | Không tạo `super_admin` (403) |
| Admin | Không sửa/khóa/xóa peer admin (403) |

### 6.3. Company disable

Khi super gọi `POST /api/companies/:id/disable`:

- `companies.status = disabled`.
- Toàn bộ session web của user thuộc company bị xóa.
- Login mới → `403 COMPANY_DISABLED`.
- API với session cũ → `401`.
- Tài nguyên **không bị xóa**.
- Super vẫn xem/thao tác tài nguyên company đó.

### 6.4. Company delete

Chỉ super, và chỉ xóa được khi **không còn**:

- `web_users` thuộc company
- `stations`
- `mountpoints`
- `ntrip_accounts`
- `relay_jobs`

Nếu còn dữ liệu → `409 COMPANY_IN_USE`; khuyến nghị dùng `disable`.

Lưu ý: kiểm tra xóa hiện chưa tính `relay_credentials`, `station_probes`,
`alerts`, `audit_logs` (xem mục 14).

---

## 7. Cây user, parent và chống nâng quyền

### 7.1. Quy tắc parent

| Actor tạo | Parent mặc định | Ràng buộc |
|---|---|---|
| Admin tạo user | Chính admin | Parent phải cùng company |
| Admin tạo peer admin | Admin root của company | Không tạo chu trình |
| Super tạo admin | Admin root company nếu có, ngược lại null | Parent cùng company, trừ parent là super_admin |
| Super tạo user | null nếu không chọn | Parent cùng company |

- `parent = target` → 400.
- Parent là descendant của target → 400 (chu trình).
- Parent không tồn tại → 400.
- Parent khác company → 400/403.

### 7.2. Chống nâng quyền

| Luật | Kết quả |
|---|---|
| Admin sửa/xóa/lock peer admin | 403 |
| Admin sửa/xóa/lock super_admin | 403 |
| Admin tạo/gán super_admin | 403 |
| Admin gán role level > 50 | 403 |
| Admin gán role level = 50 (peer admin) | Được khi tạo; sau đó không quản lý được |
| Xóa/chỉnh mình thành role khác qua self-edit | 403 (allowlist) |
| Xóa chính mình | 409 `SELF_DELETE` |
| Khóa chính mình | 409 `SELF_LOCK` |
| Hạ cấp/xóa/khóa super admin cuối | 409 `LAST_SUPER_ADMIN` |
| Sửa/xóa role hệ thống | 403 `SYSTEM_ROLE` |
| Xóa role đang dùng | 409 `ROLE_IN_USE` |

### 7.3. Level role

- `super_admin = 100`
- `admin = 50`
- `user = 10`
- Custom role: 1–99.

Quản lý user dùng level:
- Tạo/gán role: `targetLevel <= actorLevel` (trừ super).
- Sửa/khóa/xóa: `targetLevel < actorLevel` (trừ super).
- Super bỏ qua giới hạn level nhưng vẫn giữ bất biến last super.

---

## 8. Quyền chi tiết theo module

> Quy ước bảng: `View` / `Write` là quyền hiệu lực mặc định.
> “Company” nghĩa là dữ liệu cùng `company_id`; “Own” là owner = actor.

### 8.1. Companies — `/api/companies`

Chỉ super admin.

| Method | Endpoint | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/api/companies` | `companies.view` | `q`, `status`, phân trang; kèm `userCount` |
| GET | `/api/companies/:id` | `companies.view` | |
| GET | `/api/companies/:id/users` | `companies.view` | User thuộc company |
| POST | `/api/companies` | `companies.add` | `code` unique; trùng → 409 |
| PATCH | `/api/companies/:id` | `companies.edit` | `name`, `notes` |
| POST | `/api/companies/:id/enable` | `companies.edit` | |
| POST | `/api/companies/:id/disable` | `companies.edit` | Xóa session company |
| DELETE | `/api/companies/:id` | `companies.delete` | 409 nếu còn dữ liệu |

Admin/user gọi bất kỳ endpoint nào → `403`.

### 8.2. Web users — `/api/web-users`

| Method | Endpoint | Quyền | Phạm vi / luật |
|---|---|---|---|
| GET | `/api/web-users` | `web_users.view` | Admin: company; super: all; `companyId` filter cho super |
| GET | `/api/web-users/export` | `web_users.view` | `.xlsx`; có `company_code`, không password |
| GET | `/api/web-users/:id` | `web_users.view` | Ngoài company → 404 |
| POST | `/api/web-users/import` | `web_users.add` | Super cần `company_code`; admin ép company; không password |
| POST | `/api/web-users` | `web_users.add` | Company bắt buộc với super; admin ép company |
| PATCH | `/api/web-users/:id` | `web_users.edit` | Peer admin/super → 403; self allowlist |
| POST | `/api/web-users/:id/lock` | `web_users.edit` | Xóa session; peer admin/super → 403 |
| POST | `/api/web-users/:id/unlock` | `web_users.edit` | |
| POST | `/api/web-users/bulk` | `web_users.edit/delete` | `lock/unlock` cần edit; `delete` cần delete |
| DELETE | `/api/web-users/:id` | `web_users.delete` | Không xóa mình |

Response user: `companyId`, `companyName`, `companyStatus`, `role`, `status`.

### 8.3. Roles & permissions — `/api/roles`, `/api/permissions`

| Method | Endpoint | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/api/roles` | `roles.view` | Admin read-only, super full |
| GET | `/api/roles/:id/permissions` | `roles.view` | |
| PUT | `/api/roles/:id/permissions` | `roles.edit` | Chỉ role không hệ thống |
| POST | `/api/roles` | `roles.add` | Level 1–99 |
| PATCH | `/api/roles/:id` | `roles.edit` | |
| DELETE | `/api/roles/:id` | `roles.delete` | Không xóa role hệ thống/role đang dùng |
| GET | `/api/permissions` | `roles.view` | Danh mục permission |

Mặc định admin chỉ có `roles.view = all`; mọi thao tác ghi role → 403.

### 8.4. Stations — `/api/stations`

| Method | Endpoint | Quyền | Phạm vi / luật |
|---|---|---|---|
| GET | `/` | `stations.view` | Admin/user: company |
| GET | `/export` | `stations.view` | `.xlsx` |
| GET | `/:id` | `stations.view` | Ngoài phạm vi → 404 |
| GET | `/:id/*` (connections, history, metadata, activity, timeline, uptime, sources) | `stations.view` | Cùng phạm vi station |
| POST | `/import` | `stations.add` | Admin ép company; super cần suy ra company từ owner |
| POST | `/` | `stations.add` | Super bắt buộc company; admin company tự động |
| PATCH | `/:id` | `stations.edit` | Không đổi tên/port/company |
| POST | `/:id/enable|disable` | `stations.edit` | Trạm locked phải unlock trước |
| POST | `/:id/lock|unlock` | `stations.edit` | |
| PUT | `/:id/sources` | `stations.edit` | |
| POST | `/bulk` | `stations.edit/delete` | enable/disable/lock/unlock=edit; delete=delete |
| DELETE | `/:id` | `stations.delete` | Phải disable và không locked |

Tạo trạm tự sinh mountpoint + NTRIP account (nếu `ntrip_caster`) + ACL;
mountpoint/account kế thừa owner và company của trạm.

User mặc định chỉ có `stations.view = tenant`: xem toàn company nhưng không
có nút/không gọi được API ghi.

### 8.5. Mountpoints — `/api/mountpoints`

| Method | Endpoint | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/` | `mountpoints.view` | Admin: company; user: own; super: all |
| GET | `/explorer` | `mountpoints.view` | Cùng phạm vi |
| GET | `/:id/explorer` | `mountpoints.view` | Ngoài phạm vi → 404 |
| GET | `/:id/impact` | `mountpoints.view` | |
| GET | `/:id` | `mountpoints.view` | |
| POST | `/` | `mountpoints.add` | User chỉ own; admin company |
| PATCH | `/:id` | `mountpoints.edit` | Không đổi tên/company |
| POST | `/bulk` | `mountpoints.edit/delete` | enable/disable=edit, delete=delete |
| DELETE | `/:id` | `mountpoints.delete` | |

User own muốn gắn `station_id` phải là station thuộc own; gắn station company
khác → 404/403. Admin gắn station company mình.

### 8.6. NTRIP accounts — `/api/ntrip-accounts`

| Method | Endpoint | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/` | `ntrip_accounts.view` | Admin: company; user: own |
| GET | `/:id` | `ntrip_accounts.view` | |
| GET | `/:id/mountpoints` | `ntrip_accounts.view` | Effective mountpoints |
| GET | `/:id/listeners` | `ntrip_accounts.view` | |
| PUT | `/:id/mountpoints` | `ntrip_accounts.edit` | Admin: mountpoint company; user: own |
| PUT | `/:id/listeners` | `ntrip_accounts.edit` | Listener là global, chỉ cần tồn tại |
| POST | `/` | `ntrip_accounts.add` | User own; admin company |
| PATCH | `/:id` | `ntrip_accounts.edit` | Username immutable |
| POST | `/:id/lock|unlock` | `ntrip_accounts.edit` | Lock đóng connection online |
| POST | `/bulk` | `ntrip_accounts.edit/delete` | lock/unlock=edit; delete=delete |
| DELETE | `/:id` | `ntrip_accounts.delete` | |

NTRIP account **không đăng nhập web**; xác thực Basic do caster Go xử lý.
Web user chỉ quản lý account theo owner/company.

### 8.7. Relay jobs — `/api/relay-jobs`

| Method | Endpoint | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/` | `relay.view` | Admin/user: company |
| GET | `/:id` | `relay.view` | |
| GET | `/:id/status|activity|timeline|history` | `relay.view` | |
| POST | `/` | `relay.add` | Super bắt buộc company; admin company |
| PATCH | `/:id` | `relay.edit` | Không đổi company; owner cùng company |
| POST | `/import` | `relay.add` | Super/ admin theo company |
| POST | `/bulk` | `relay.edit/delete` | enable/disable/lock/unlock/restart=edit; delete=delete |
| POST | `/:id/enable|disable|lock|unlock|restart|test` | `relay.edit` | |
| DELETE | `/:id` | `relay.delete` | Soft-delete (`deleted_at`) |

User chỉ xem relay company; không thêm/sửa/xóa.

### 8.8. Caster listeners — `/api/caster/listeners`

**Global, không company.**

| Method | Endpoint | Quyền | Admin | User |
|---|---|---|---|---|
| GET | `/listeners` | `caster.view` | Xem tất cả | Không |
| GET | `/listeners/:id` | `caster.view` | Xem tất cả; `mountpointIds` lọc company | Không |
| POST | `/listeners` | `caster.add` | 403 | 403 |
| PATCH | `/listeners/:id` | `caster.edit` | 403 | 403 |
| POST | `/listeners/bulk` | `caster.edit/delete` | 403 | 403 |
| DELETE | `/listeners/:id` | `caster.delete` | 403 | 403 |
| POST | `/:id/enable|disable` | `caster.edit` | 403 | 403 |
| GET | `/:id/mountpoints` | `caster.view` | Chỉ mountpoint company | Không |
| PUT | `/:id/mountpoints` | `caster.edit` | 403 | 403 |

- Listener response: `global: true`, `ownerWebUserId`, `ownerName`; **không**
  có `companyId`.
- Admin xem tất cả listener của mọi company.
- Danh sách mountpoint gắn listener bị lọc theo company của admin; super thấy tất cả.
- Tạo listener trùng port → 409 (`uq_caster_listeners_port`).
- Cổng 2101/8081 bị cấm.

### 8.9. Caster connections — `/api/caster/connections`, `/api/connections`

| Method | Endpoint | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/api/caster/connections` | `connections.view` | Super all; admin mountpoint company; user none |
| DELETE | `/api/caster/connections/:id` | `connections.delete` | Cùng phạm vi |
| GET | `/api/connections` | `connections.view` | Alias |
| DELETE | `/api/connections/:id` | `connections.delete` | Alias |

Admin không thấy kết nối của mountpoint company khác.

### 8.10. Alerts — `/api/alerts`

| Method | Endpoint | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/` | `alerts.view` | Admin company; user own; super all |
| GET | `/:id` | `alerts.view` | |
| POST | `/read-all` | `alerts.view` | Đánh dấu đọc theo phạm vi |
| POST | `/:id/read` | `alerts.view` | |
| POST | `/:id/ack` | `alerts.ack` | User 403 mặc định |
| POST | `/bulk-ack` | `alerts.ack` | |

Alert phát sinh từ relay/station lấy owner tương ứng; company lấy từ owner.

### 8.11. Quality & probes — `/api/quality/*`, `/api/stations/:id/probes`

| Method | Endpoint | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/api/quality/overview` | `quality.view` | Admin company; user own |
| GET | `/api/quality/alerts` | `quality.view` | |
| POST | `/api/quality/alerts/:id/ack` | `quality.ack` | User none |
| GET | `/api/quality/export` | `quality.view` | |
| GET | `/api/stations/:id/quality` | `quality.view` | |
| GET | `/api/stations/:id/rtcm/messages` | `quality.view` | |
| GET | `/api/relay-jobs/:id/quality` | `quality.view` | |
| GET | `/api/relay-jobs/:id/rtcm/messages` | `quality.view` | |
| GET | `/api/stations/:id/probes` | `stations.view` | |
| POST | `/api/stations/:id/probes` | `stations.edit` | Admin/super; user none |
| PATCH | `/api/station-probes/:id` | `stations.edit` | |
| DELETE | `/api/station-probes/:id` | `stations.edit` | |
| POST | `/api/station-probes/:id/enable|disable` | `stations.edit` | |

Quality dùng owner-based scope; xem mục 14 cho khác biệt với company_id.

### 8.12. History & audit

| Method | Endpoint | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/api/history/sessions` | `relay.view` | Relay job company |
| GET | `/api/history/events` | `relay.view` | |
| GET | `/api/history/hourly` | `relay.view` | |
| GET | `/api/audit-logs` | `audit.view` | Admin company; user none; super all |

User có `relay.view = tenant` nên xem được lịch sử relay company, nhưng không
thấy tab Audit.

### 8.13. Map, Dashboard, Snapshot, Realtime

| Thành phần | Quyền | Phạm vi |
|---|---|---|
| `GET /api/map/overview` | `stations.view` | Company (company_id) |
| `GET /api/ops/dashboard` | Đăng nhập | Lọc theo từng permission scope |
| `GET /api/snapshot` | Đăng nhập | Lọc theo permission scope |
| Socket.IO snapshot/subscribe | Đăng nhập | Lọc theo permission scope |

Dashboard/snapshot/socket dùng owner-based:
- Trạm/relay: company user IDs.
- Mountpoint: own/tenant.
- Quality: own/tenant.
- Alerts: own/tenant.
- Connections: theo mountpoint owner.
- Listener room: chỉ cần `connections.view != none` (admin/super).

### 8.14. System health & settings

| Endpoint | Quyền | Ai có |
|---|---|---|
| `GET /api/system/health` | `system_health.view` | Super only |
| settings API/UI | `settings.*` | Reserved, chưa triển khai route/UI |

### 8.15. Profile & dictionaries

- `GET/PATCH /api/profile`: mọi user đã đăng nhập, chỉ dữ liệu của mình.
- `POST /api/profile/password`: yêu cầu mật khẩu hiện tại.
- `GET /api/profile/sessions`: session của mình.
- `GET /api/dictionaries`: mọi user đã đăng nhập; chỉ dictionary `enabled = 1`.

---

## 9. Quy tắc owner, company và các trường bất biến

### 9.1. Khi tạo tài nguyên

`resolveWriteOwnership` áp dụng cho station/mountpoint/ntrip/relay:

| Actor | Company | Owner mặc định | Owner được chọn |
|---|---|---|---|
| Super | Bắt buộc `company_id` hoặc suy ra từ owner | Chính super | User cùng company, hoặc super |
| Admin | Ép `company_id` của admin | Chính admin | User cùng company |
| User (own) | Company của user | Chính user | Không được chọn người khác |

Lỗi:
- Thiếu company (super) → `400 COMPANY_REQUIRED`.
- Company không tồn tại → `400 INVALID_COMPANY`.
- Owner khác company → `400 OWNER_COMPANY_MISMATCH`.
- User own gán owner khác → `403 FORBIDDEN`.

### 9.2. Khi cập nhật

- Không đổi `company_id` → `400 COMPANY_IMMUTABLE`.
- Đổi owner: owner mới phải cùng company.
- Station: `name`, `port` immutable.
- Mountpoint: `name` immutable.
- NTRIP account: `username` immutable.
- Relay: `company_id` immutable.

### 9.3. Xóa / cascade

- Xóa station yêu cầu trạm đã disable và không locked; cascade mountpoint,
  station source, probe, account managed, ACL liên quan.
- Relay job là soft-delete (`deleted_at`), giữ lịch sử.
- Company disable không xóa dữ liệu.
- Company delete bị chặn nếu còn user/station/mountpoint/account/relay job.

### 9.4. Tài nguyên super tạo

- Super tạo tài nguyên có `company_id` nhưng owner mặc định là super
  (`company_id = NULL`).
- Admin company thấy trong list/detail nhờ lọc `company_id`.
- Tuy nhiên các API owner-based (quality, dashboard, realtime, station bulk)
  có thể không thấy/không thao tác được; xem mục 14.

### 9.5. Trường response dùng để test company/owner

| Module | Trường company | Trường owner |
|---|---|---|
| Stations | `company_id`, `company_name` | `owner_web_user_id`, `owner_name` |
| Mountpoints | `company_id`, `company_name` | `owner_web_user_id`, `owner_name` |
| Relay jobs | `companyId`, `companyName` | `ownerWebUserId`, `ownerName` |
| NTRIP accounts | `companyId`, `companyName`; `company` là tên đơn vị nghiệp vụ cũ | `ownerWebUserId`, `ownerName` |
| Web users | `companyId`, `companyName`, `companyStatus` | `parentUserId` (cây), không owner |
| Alerts | `companyId`, `companyName` | `ownerWebUserId`, `ownerName` |
| Audit logs | `companyId`, `companyName` | `actorId`, `actorName` |
| Caster listeners | **Không có** company | `ownerWebUserId`, `ownerName`; `global: true` |

Lưu ý: NTRIP account có 2 khái niệm khác nhau:
- `company` (string): tên đơn vị/khách hàng nghiệp vụ trên account.
- `companyId`/`companyName`: công ty tenant dùng cho phân quyền.
Khi test phân quyền, dùng `companyId`, không dùng `company`.

---

## 10. Mã lỗi và ý nghĩa khi test

| HTTP | Mã | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod/schema sai |
| 400 | `COMPANY_REQUIRED` | Super tạo tài nguyên/user thiếu company |
| 400 | `INVALID_COMPANY` | Company không tồn tại / super admin có company |
| 400 | `OWNER_COMPANY_MISMATCH` | Owner khác company |
| 400 | `COMPANY_IMMUTABLE` | Cố đổi company |
| 400 | `INVALID_PARENT` | Parent sai/chu trình/khác company |
| 400 | `STATION_ENABLED` / `STATION_LOCKED` | Xóa trạm khi còn bật/khóa |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Chưa login/hết hạn/session bị thu hồi |
| 403 | `FORBIDDEN` | Thiếu permission hoặc vi phạm luật |
| 403 | `CSRF_INVALID` | Thiếu/sai CSRF header |
| 403 | `ACCOUNT_LOCKED` | User bị khóa |
| 403 | `COMPANY_DISABLED` | Company bị disable |
| 403 | `SYSTEM_ROLE` | Sửa/xóa role hệ thống |
| 404 | `NOT_FOUND` | Không tồn tại hoặc ngoài phạm vi |
| 409 | `LAST_SUPER_ADMIN` | Hạ cấp/khóa/xóa super cuối |
| 409 | `SELF_DELETE` / `SELF_LOCK` | Tự xóa/khóa mình |
| 409 | `DUPLICATE_*` | Trùng port/username/tên/code |
| 409 | `ROLE_IN_USE` | Xóa role đang gán |
| 409 | `COMPANY_IN_USE` | Xóa company còn dữ liệu |
| 409 | `IMMUTABLE_FIELD` | Sửa trường bất biến |

Bulk trả:

```json
{ "result": { "updated": 1, "notFound": 0, "forbidden": 2, "skipped": 0 } }
```

---

## 11. UI — menu và nút theo vai trò

### 11.1. Menu

| Menu | Super | Admin | User |
|---|---|---|---|
| Dashboard | Có | Có | Có |
| Trạm / Danh sách trạm | Có | Có | Có |
| Bản đồ / Bản đồ vận hành | Có | Có | Có |
| Bản đồ / Danh sách online | Có | Có | Không |
| CORS / Mountpoint | Có | Có | Có (own) |
| CORS / Listener | Có | Có | Không |
| Tài khoản / NTRIP | Có | Có | Có (own) |
| Relay / Relay jobs | Có | Có | Có (view) |
| Hệ thống / Sức khỏe | Có | Không | Không |
| Hệ thống / Cảnh báo | Có | Có | Có |
| Hệ thống / Lịch sử | Có | Có | Có |
| Hệ thống / Người dùng | Có | Có | Không |
| Hệ thống / Công ty | Có | Không | Không |
| Hệ thống / Phân quyền | Có | Có (read-only) | Không |
| Profile (avatar) | Có | Có | Có |

Lưu ý: menu Lịch sử hiện với user vì `relay.view = tenant`, nhưng tab Audit
chỉ hiện khi `audit.view != none`.

### 11.2. Nút thao tác

| Trang | Super | Admin | User |
|---|---|---|---|
| Công ty | Thêm/sửa/disable/xóa | Không vào | Không vào |
| Người dùng | Thêm/sửa/khóa/xóa | Thêm/sửa/khóa/xóa user cấp thấp; nút trên peer admin vẫn hiện nhưng API 403 | Không |
| Phân quyền | Sửa ma trận/tạo/xóa role | Chỉ xem | Không |
| Trạm | Full | Full company | Chỉ xem |
| Relay | Full | Full company | Chỉ xem |
| Mountpoint | Full | Full company | Full own |
| NTRIP | Full | Full company | Full own |
| Listener | Thêm/sửa/xóa/gắn MP | Chỉ xem; không nút | Không |
| Online | Ngắt kết nối | Ngắt kết nối company | Không |
| Cảnh báo | Ack | Ack company | Chỉ đánh dấu đọc own |
| Chất lượng | Ack | Ack company | Chỉ xem own |
| System Health | Xem | Không | Không |

UI hiện ẩn nút theo `permission.scope != none`. Server vẫn kiểm tra lại; không
tin UI.

---

## 12. Realtime / Socket.IO

### 12.1. Xác thực

- Socket dùng cookie session `cors_sid`, không dùng JWT.
- Không có session hợp lệ → từ chối kết nối.
- Khi role hoặc session thay đổi, socket refresh permission.
- Snapshot/subscribe được lọc theo permission scope.

### 12.2. Room/subscribe

| Hành động | Điều kiện |
|---|---|
| Subscribe `station:<id>` | `stations.view` và station trong scope |
| Subscribe `relay:<id>` | `relay.view` và relay trong scope |
| Join `caster` | `connections.view != none` |
| Quality snapshot | `quality.view`; lọc owner trong scope |
| Alerts | `alerts.view`; lọc owner trong scope |

### 12.3. Hành vi cần biết khi test

- Sửa **ma trận quyền của cùng role** khi socket đang mở: socket **không**
  reload permission ngay (chỉ reload khi roleId/sessionId đổi). Cần reconnect.
- Disable company: HTTP chặn ngay; socket hiện **không** kiểm tra company
  status trong `loadSessionByToken`/`refreshAuth`. Đây là điểm cần reconcile.
- `entity.changed` được phát broadcast; payload chỉ gồm entity/id/action,
  không chứa dữ liệu nhạy cảm.

---

## 13. Audit và bảo mật

- Audit ghi cho các thao tác ghi chính (tạo/sửa/xóa/khóa/mở/ack/import/bulk).
- `audit_logs.company_id`:
  - Ưu tiên `company_id` trong `after`/`before` của tài nguyên.
  - Nếu không có, lấy company của actor.
- Redaction trước khi ghi: key khớp
  `pass|password|token|secret|hash|dsn|authorization|cookie` → `"***"`.
- Audit không chặn nghiệp vụ nếu ghi lỗi; lỗi được log server.
- Không log Authorization/password/DSN; pino redact header/cookie/password.
- Export user không có password; import user không có cột password.
- NTRIP password mã hóa (`password_enc`), không trả về client.

---

## 14. Điểm lệch / known gaps hiện tại

Các điểm này **có thật trong code hiện tại**, cần test riêng và cân nhắc sửa:

1. **Station bulk dùng owner-based scope**
   - `POST /api/stations/bulk` không select `company_id`; `assertRecordScope`
     nhận `company_id = undefined` nên fallback owner.
   - Hệ quả: tài nguyên do super tạo (company A, owner super) hiện trong list
     của admin nhưng bulk enable/disable/lock/delete có thể bị `forbidden`.

2. **Quality / Dashboard / Snapshot / Socket dùng owner-based**
   - Không dùng `company_id` trực tiếp.
   - Tài nguyên super tạo (owner super, company A) có thể không xuất hiện với
     admin trong các màn hình này dù list API chính có hiện.

3. **Socket không kiểm tra company disabled**
   - `loadSessionByToken` và `refreshAuth` chỉ kiểm tra session hạn + user active.
   - Company disable xóa session DB; socket đang mở có thể còn nhận dữ liệu đến
     khi reconnect/tick thất bại tùy thời điểm.

4. **Permission của cùng role không reload trên socket đang mở**
   - Chỉ reload khi `roleId` hoặc `sessionId` đổi.

5. **Company delete chỉ kiểm tra 5 bảng**
   - `web_users`, `stations`, `mountpoints`, `ntrip_accounts`, `relay_jobs`.
   - Chưa kiểm tra `relay_credentials`, `station_probes`, `alerts`, `audit_logs`;
     có thể còn dữ liệu mồ côi nếu xóa company đã qua các bảng này.

6. **UI form tạo tài nguyên của super chưa có ô chọn Công ty**
   - API bắt buộc `company_id`; thao tác tạo station/relay/mountpoint/NTRIP
     trên UI super có thể trả `400 COMPANY_REQUIRED` nếu không truyền company.
   - Form user đã có chọn company.

7. **`settings.*` là permission reserved**
   - Chưa có route/UI settings; chỉ có trong bảng quyền.

8. **Admin có thể tạo user role level 50 rồi không quản lý được**
   - `canAssignRole` cho phép `<=`, nhưng `assertCanTarget` chặn `>=` khi sửa.
   - Đây là hệ quả của D05-1 (tạo peer admin) + D05-2 (không sửa peer admin).

9. **Tài nguyên legacy owner super/null company**
   - Nằm trong `company_backfill_reports`; chỉ super xử lý được.
   - Không tự động gán company.

10. **`mountpointCount` của listener là tổng toàn hệ thống**
    - Admin A thấy `mountpointCount` gồm cả mountpoint company B, trong khi
      danh sách `mountpointIds`/`GET /:id/mountpoints` đã lọc company A.
    - Đây là chênh lệch số đếm so với danh sách chi tiết; cần thống nhất khi
      test UI listener.

---

## 15. Checklist test chi tiết

> Dùng dữ liệu test; tạo username/company code có suffix timestamp và cleanup
> sau mỗi nhóm. Không dùng mountpoint công cộng, không chạy relay.exe, không
> chiếm cổng 8081/2101.

### 15.1. Chuẩn bị fixture

1. Super tạo Company A, Company B.
2. Super tạo admin A1 (company A), admin B1 (company B).
3. Admin A1 tạo admin A2 (peer, company A) và user A1 (company A).
4. Super/admin tạo station, relay, mountpoint, NTRIP account cho từng company.
5. Tạo ít nhất một listener global (super).

Kiểm tra DB:

```sql
SELECT id, code, name, status FROM companies;
SELECT u.id, u.username, r.code, u.company_id, u.parent_user_id, u.status
  FROM web_users u JOIN roles r ON r.id = u.role_id ORDER BY u.id;
SELECT id, name, company_id, owner_web_user_id FROM stations;
SELECT id, name, company_id, owner_web_user_id FROM mountpoints;
SELECT id, username, company_id, owner_web_user_id FROM ntrip_accounts;
SELECT id, name, company_id, owner_web_user_id, deleted_at FROM relay_jobs;
SELECT * FROM company_backfill_reports ORDER BY entity_type, entity_id;
```

### 15.2. Nhóm A — Auth/session/CSRF

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A1 | Login super/admin/user đúng | 200, có csrfToken + permissions |
| A2 | Sai mật khẩu | 401 `INVALID_CREDENTIALS` |
| A3 | User locked login | 403 `ACCOUNT_LOCKED` |
| A4 | User company disabled login | 403 `COMPANY_DISABLED` |
| A5 | Gọi API không cookie | 401 |
| A6 | POST/PATCH/DELETE thiếu CSRF | 403 `CSRF_INVALID` |
| A7 | Lock user, dùng session cũ | 401 |
| A8 | Đổi mật khẩu user khác | Session cũ 401 |

### 15.3. Nhóm B — Super admin

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| B1 | List stations/relay/MP/NTRIP/alerts/audit | Thấy cả A và B |
| B2 | Tạo company trùng code | 409 |
| B3 | Tạo tài nguyên thiếu company | 400 `COMPANY_REQUIRED` |
| B4 | Tạo tài nguyên company A | 201, `company_id = A` |
| B5 | Tạo tài nguyên owner B + company A | 400 `OWNER_COMPANY_MISMATCH` |
| B6 | Tạo user admin company A | 201, `companyId = A` |
| B7 | Disable company B | 200; login B 403; session B 401; tài nguyên còn |
| B8 | Delete company B còn dữ liệu | 409 `COMPANY_IN_USE` |
| B9 | Listener trùng port | 409 |
| B10 | Filter `companyId=A` trên stations | Chỉ A |
| B11 | Xóa super cuối | 409 `LAST_SUPER_ADMIN` |
| B12 | Tự xóa/tự khóa | 409 |

### 15.4. Nhóm C — Admin công ty

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| C1 | List stations/MP/NTRIP/relay/alerts | Chỉ company A |
| C2 | Xem station B detail | 404 |
| C3 | Tạo station/relay/MP/NTRIP | 201, `company_id = A` |
| C4 | Gửi `company_id = B` khi tạo tài nguyên | 403 |
| C5 | Gán owner B | 400 `OWNER_COMPANY_MISMATCH` |
| C6 | Tạo peer admin A2 | 201, `companyId = A`, audit |
| C7 | Sửa/lock/xóa A2 | 403 |
| C8 | Tạo super_admin | 403 |
| C9 | Sửa/lock/xóa user A1 | 200 |
| C10 | Parent user B / parent chu trình | 403/400 |
| C11 | Gọi `/api/system/health` | 403 |
| C12 | Gọi `/api/companies` | 403 |
| C13 | Sửa role/permission | 403 |
| C14 | List listener | 200, thấy tất cả listener |
| C15 | Tạo/sửa/xóa listener | 403 |
| C16 | Listener mountpoints | Chỉ mountpoint company A |
| C17 | Audit logs | Chỉ company A |
| C18 | Filter `companyId=B` | Bị bỏ qua/không trả B |

### 15.5. Nhóm D — User

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| D1 | List stations/relay | Toàn company A |
| D2 | Thêm/sửa/xóa station/relay | 403 |
| D3 | List mountpoint | Chỉ own |
| D4 | Xem mountpoint user A2 | 404 |
| D5 | Tạo/sửa/xóa mountpoint own | 200/201/204 |
| D6 | Gắn mountpoint own vào station user A2 | 404/403 |
| D7 | List NTRIP | Chỉ own |
| D8 | Xem NTRIP user A2 | 404 |
| D9 | Alerts | Chỉ own; read own 200; ack 403 |
| D10 | Quality | Chỉ own; ack 403 |
| D11 | Audit | 403 |
| D12 | Users/Roles/Companies/Listener | 403 |
| D13 | System health | 403 |
| D14 | Dashboard | Số liệu theo scope, không lỗi |
| D15 | Profile sửa `display_name/email/password` | 200 |
| D16 | Profile gửi `role_id/company_id` | 403 |
| D17 | Đổi mật khẩu | Session khác 401, session hiện tại còn |

### 15.6. Nhóm E — Cô lập company

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| E1 | A1 và A2 cùng thấy tài nguyên A | Cùng total |
| E2 | A1 không thấy tài nguyên B | 404/không có trong list |
| E3 | B1 không thấy tài nguyên A | 404/không có trong list |
| E4 | Super thấy cả A và B | Đúng company/owner |
| E5 | Company A disable | B không ảnh hưởng |
| E6 | Tài nguyên company A không bị xóa khi disable | Count giữ nguyên |

### 15.7. Nhóm F — Listener toàn hệ thống

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| F1 | Admin A và admin B list listener | Cùng total với super |
| F2 | Admin A tạo/sửa/xóa listener | 403 |
| F3 | Super tạo listener trùng port | 409 |
| F4 | Super tạo listener port 2101/8081 | 400 |
| F5 | Admin A xem mountpoints listener có MP A+B | Chỉ MP A |
| F6 | Super xem mountpoints listener | Thấy cả A+B |
| F7 | User gọi listener API | 403 |

### 15.8. Nhóm G — Audit

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| G1 | Admin A tạo station | Audit có `companyId = A` |
| G2 | Super tạo tài nguyên company B | Audit có `companyId = B` |
| G3 | Audit chứa password/token | Giá trị bị `***` |
| G4 | Admin A list audit | Chỉ company A |
| G5 | Super filter `companyId=B` | Chỉ audit B |
| G6 | User list audit | 403 |

### 15.9. Nhóm H — Import/export user

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| H1 | Super import user có `company_code` | Tạo đúng company |
| H2 | Super import thiếu `company_code` | 400 |
| H3 | Admin import user | Ép company admin |
| H4 | Import user role super_admin bởi admin | 400 |
| H5 | Import cập nhật peer admin bởi admin | 400/403 |
| H6 | Export user | Có `company_code`, không có password |
| H7 | Import user tạo mới | Mật khẩu mặc định `123456`, audit |

### 15.10. Nhóm I — Realtime

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| I1 | Socket không cookie | Từ chối |
| I2 | User snapshot | Stations/relay company; quality/alerts own; connections rỗng |
| I3 | Admin subscribe station B | Từ chối/không dữ liệu |
| I4 | Admin join caster | Được nếu `connections.view != none` |
| I5 | User join caster | Từ chối |
| I6 | Đổi role user khi socket mở | Socket refresh permission |
| I7 | Sửa permission cùng role | Socket không reload ngay (known gap) |
| I8 | Disable company khi socket mở | Kiểm tra hành vi thực tế (known gap) |

### 15.11. Nhóm J — Bất biến dữ liệu

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| J1 | PATCH station đổi company | 400 `COMPANY_IMMUTABLE` |
| J2 | PATCH MP đổi company | 400 |
| J3 | PATCH NTRIP đổi company | 400 |
| J4 | PATCH relay đổi company | 400 |
| J5 | Đổi owner sang company khác | 400 |
| J6 | Xóa station đang bật | 400 `STATION_ENABLED` |
| J7 | Xóa station đang locked | 400 `STATION_LOCKED` |
| J8 | Xóa relay | Soft-delete, list mặc định không thấy |
| J9 | Legacy company null | Chỉ super thấy; admin không thấy |
| J10 | `company_backfill_reports` | Có bản ghi owner null/company null |

### 15.12. Mapping 05-T1..T19

| ID | Đã kiểm tra | Bằng chứng |
|---|---|---|
| 05-T1 | Migration + backfill | Migration 028–033; SQL company/user/resource |
| 05-T2 | A1, A2 cùng thấy tài nguyên A | API integration: cùng 3 trạm |
| 05-T3 | Admin tạo peer admin | API 201 + audit |
| 05-T4 | Sửa/lock peer admin | 403 |
| 05-T5 | Admin tạo super_admin | 403 |
| 05-T6 | Admin xem tài nguyên B | 404 / list không có |
| 05-T7 | User xem trạm/relay A | Total = company |
| 05-T8 | User xem MP/NTRIP user khác | 404 |
| 05-T9 | Super thấy tất cả | Company/owner đúng |
| 05-T10 | Super tạo thiếu company | 400 |
| 05-T11 | Owner khác company | 400 |
| 05-T12 | Company disable | Login 403, session 401, resource còn |
| 05-T13 | Audit company/secret | Có company, không lộ secret |
| 05-T14 | Import/export user | Company đúng, không password |
| 05-T15 | Regression RBAC cũ | Server 61/61, Playwright 6/6 |
| 05-T16 | Admin CRUD listener | 403 |
| 05-T17 | Super listener trùng port | 409 |
| 05-T18 | A và B xem listener | Cùng total |
| 05-T19 | MP gắn listener theo company | Admin chỉ A, super A+B |

---

## 16. Lệnh kiểm tra và bằng chứng hiện tại

### 16.1. Hạ tầng

```powershell
docker compose ps
docker compose run --rm --build migrate
curl http://127.0.0.1:4000/health
```

Migration hiện tại: admin version **33**, runtime **6**.

### 16.2. Test tự động

```powershell
cd server
npx tsc -p tsconfig.json --noEmit
npm test
npm run build

cd ..\frontend
npx tsc --noEmit
npm run build

cd ..\gnss
go test ./...
go vet ./...
```

Playwright (đặt biến môi trường từ `.env.local`, không in ra):

```powershell
$env:E2E_PASSWORD = $env:SEED_SUPERADMIN_PASSWORD
$env:E2E_ADMIN_PASSWORD = $env:SEED_ADMIN_PASSWORD
$env:E2E_USER_PASSWORD = $env:SEED_USER_PASSWORD
cd frontend
npx playwright test tests/company.spec.ts tests/p1-rbac.spec.ts tests/navigation.spec.ts
```

Kết quả đã ghi nhận:
- Server tsc/build PASS, vitest **61/61**.
- Frontend tsc/build PASS.
- Go test/vet PASS.
- Playwright **6/6**.
- API integration **37/37** (T2–T14, T16–T19 + T2 peer).
- Graphify: **2983 nodes, 7258 edges**.

### 16.3. Query kiểm tra ma trận quyền

```sql
SELECT p.module, p.action, p.code,
       MAX(CASE WHEN r.code='super_admin' THEN rp.scope END) AS super_admin,
       MAX(CASE WHEN r.code='admin' THEN rp.scope END) AS admin,
       MAX(CASE WHEN r.code='user' THEN rp.scope END) AS user
  FROM permissions p
  LEFT JOIN role_permissions rp ON rp.permission_id = p.id
  LEFT JOIN roles r ON r.id = rp.role_id
 GROUP BY p.id, p.module, p.action, p.code
 ORDER BY p.module, p.action;
```

### 16.4. Query kiểm tra company/owner

```sql
SELECT 'stations' t, COUNT(*) total, SUM(company_id IS NULL) null_company,
       SUM(owner_web_user_id IS NULL) null_owner FROM stations
UNION ALL
SELECT 'mountpoints', COUNT(*), SUM(company_id IS NULL), SUM(owner_web_user_id IS NULL) FROM mountpoints
UNION ALL
SELECT 'ntrip_accounts', COUNT(*), SUM(company_id IS NULL), SUM(owner_web_user_id IS NULL) FROM ntrip_accounts
UNION ALL
SELECT 'relay_jobs', COUNT(*), SUM(company_id IS NULL), SUM(owner_web_user_id IS NULL) FROM relay_jobs
UNION ALL
SELECT 'alerts', COUNT(*), SUM(company_id IS NULL), SUM(owner_web_user_id IS NULL) FROM alerts;
```

### 16.5. Query báo cáo backfill

```sql
SELECT entity_type, reason, COUNT(*) total
  FROM company_backfill_reports
 GROUP BY entity_type, reason
 ORDER BY entity_type, reason;
```

### 16.6. Mẫu gọi API có session + CSRF

```powershell
$base = 'http://127.0.0.1:4000'
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# Mật khẩu đọc từ biến môi trường, không hard-code trong tài liệu
$login = Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post `
  -ContentType 'application/json' -WebSession $s `
  -Body (@{ username = 'superadmin'; password = $env:SEED_SUPERADMIN_PASSWORD } | ConvertTo-Json)

$headers = @{ 'X-CSRF-Token' = $login.csrfToken }
$stamp = Get-Date -Format 'HHmmss'

# Tạo company
$company = Invoke-RestMethod -Uri "$base/api/companies" -Method Post `
  -Headers $headers -WebSession $s -ContentType 'application/json' `
  -Body (@{ code = "test_$stamp"; name = "Test $stamp" } | ConvertTo-Json)

# Tạo admin đầu tiên cho company
$roles = Invoke-RestMethod -Uri "$base/api/roles" -WebSession $s
$adminRole = $roles.items | Where-Object { $_.code -eq 'admin' } | Select-Object -First 1
$user = Invoke-RestMethod -Uri "$base/api/web-users" -Method Post `
  -Headers $headers -WebSession $s -ContentType 'application/json' `
  -Body (@{
    username = "admin_$stamp"
    password = 'TestOnly!2026'
    display_name = "Admin $stamp"
    role_id = $adminRole.id
    company_id = $company.item.id
  } | ConvertTo-Json)

# Kiểm tra
Invoke-RestMethod -Uri "$base/api/stations?pageSize=10" -WebSession $s |
  ConvertTo-Json -Depth 5
```

Khi test write API, thiếu header `X-CSRF-Token` sẽ trả `403 CSRF_INVALID`.

---

## 17. Phụ lục — endpoint & permission nhanh

### 17.1. Auth/profile

| Endpoint | Permission |
|---|---|
| `POST /api/auth/login` | Public |
| `GET /api/auth/me` | Đăng nhập |
| `POST /api/auth/logout` | Đăng nhập + CSRF |
| `GET/PATCH /api/profile` | Đăng nhập |
| `POST /api/profile/password` | Đăng nhập |
| `GET /api/profile/sessions` | Đăng nhập |
| `GET /api/dictionaries` | Đăng nhập |

### 17.2. Quản trị

| Endpoint | Permission |
|---|---|
| `/api/companies*` | `companies.*` (super) |
| `/api/web-users*` | `web_users.*` |
| `/api/roles*` | `roles.*` |
| `/api/permissions` | `roles.view` |
| `/api/system/health` | `system_health.view` |
| `/api/audit-logs` | `audit.view` |

### 17.3. Vận hành

| Endpoint | Permission |
|---|---|
| `/api/stations*` | `stations.*` |
| `/api/map/overview` | `stations.view` |
| `/api/mountpoints*` | `mountpoints.*` |
| `/api/ntrip-accounts*` | `ntrip_accounts.*` |
| `/api/relay-jobs*` | `relay.*` |
| `/api/history/*` | `relay.view` |
| `/api/caster/listeners*` | `caster.*` |
| `/api/caster/connections*`, `/api/connections*` | `connections.*` |
| `/api/alerts*` | `alerts.*` |
| `/api/quality/*` | `quality.*` |
| `/api/stations/:id/probes`, `/api/station-probes/:id*` | `stations.view/edit` |
| `/api/ops/dashboard`, `/api/snapshot` | Đăng nhập + lọc scope |
| Socket.IO | Đăng nhập + lọc scope |

### 17.4. Ghi chú về NTRIP và Go

- NTRIP account không phải web account; không login UI.
- Xác thực NTRIP Basic do Go caster/relay thực hiện; web RBAC chỉ quản lý
  account, ACL listener/mountpoint.
- Internal API Go không public; bảo vệ bằng mạng nội bộ + HMAC, không dùng
  session web.

---

## 18. Kết luận ngắn cho người test

- Muốn test **company isolation**: tạo 2 company, 2 admin, tài nguyên mỗi bên;
  kiểm tra list/detail/owner/company.
- Muốn test **peer admin**: admin A1 tạo A2, sau đó thử sửa/lock/xóa A2 → 403.
- Muốn test **listener global**: admin A/B list cùng total, nhưng CRUD 403;
  kiểm tra mountpoint gắn listener bị lọc company.
- Muốn test **user own**: user1 xem MP/NTRIP user2 → 404; sửa own → 200.
- Muốn test **super create**: thiếu company → 400; có company → 201.
- Muốn test **company disable**: disable B, login B 403, session B 401,
  tài nguyên B vẫn còn khi super query.
- Luôn kiểm tra thêm các known gaps ở mục 14 để tránh coi là lỗi mới.
