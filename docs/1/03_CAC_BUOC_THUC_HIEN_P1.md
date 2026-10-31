# 03 — CÁC BƯỚC THỰC HIỆN P1

> Ngày lập: 2026-10-31
> Nguồn: yêu cầu mới của chủ dự án + kết quả P0 + phân tích `graphify`
> Trạng thái: **KẾ HOẠCH — chưa sửa code**
> Cách dùng: làm tuần tự; mỗi phase chỉ chuyển khi checklist test PASS hoặc có
> ghi chú chấp nhận. Bản đồ vận hành để phase sau.

## 1. Cách đọc tài liệu

Mỗi phase gồm:

1. **Mục tiêu** — kết quả cần có.
2. **Việc cần làm** — bước triển khai.
3. **File/khu vực** — nơi sẽ sửa.
4. **Yêu cầu cần đạt** — điều kiện nghiệm thu.
5. **Checklist test** — bằng chứng PASS/FAIL.
6. **Ghi chú** — rủi ro, migration, điều kiện dừng.

Quy ước:

- `[ ]` chưa làm, `[x]` PASS, `[!]` lỗi/chấp nhận tạm.
- Không đánh dấu PASS khi chưa chạy test.
- Không commit secret, `.env.local`, credential, DSN hoặc file backup relay.
- Mọi thay đổi schema phải có migration tăng dần; không sửa migration đã chạy.

## 2. Quyết định đã chốt

| Mã | Quyết định |
|---|---|
| D1 | `Super admin` quản lý toàn hệ thống. |
| D2 | `Admin` quản lý toàn bộ tài nguyên thuộc công ty/nhánh mình; không sửa phân quyền; không xem System Health. |
| D3 | `User` xem toàn công ty đối với **Dashboard, Trạm, Relay**; các module còn lại chỉ xem/quản lý tài nguyên cá nhân. |
| D4 | Bỏ toàn bộ mountpoint cũ và import lại; dữ liệu hiện tại là test, không cần giữ. |
| D5 | NtripClient của trạm dùng mô hình **station source riêng** (không nhồi vào `relay_jobs`); chỉ tái sử dụng code NTRIP/proxy/TLS/backoff của relay. |
| D6 | Listener ACL của tài khoản NTRIP là **ACL thật**. |
| D7 | Quyền hiệu lực của tài khoản = listener được phép → mountpoint của listener đó ∩ mountpoint được chọn. |
| D8 | Ví dụ: tài khoản A chỉ được listener 1508; listener 1508 có 5 mountpoint. Dù chọn full mountpoint, A chỉ thấy 5 mountpoint trong sourcetable và chỉ kết nối được 5 mountpoint đó. |
| D9 | Admin được xem danh sách role nhưng read-only; không add/edit/delete permission. |
| D10 | Mountpoint chỉ hiển thị: tên, trạm liên kết, trạng thái khóa/mở, ghi chú. |
| D11 | Bỏ menu Mountpoint Explorer; gộp chi tiết Explorer vào trang Mountpoint. |
| D12 | Mã trạm không bắt người dùng nhập; dùng `id` làm định danh. Nếu cần `code` nội bộ thì tự sinh và ẩn. |
| D13 | Bản đồ vận hành để phase sau; không sửa `/map` trong P1. |

### Giả định cần xác nhận khi bắt đầu code

- `User` chỉ có menu Dashboard, Trạm, Relay, Trang cá nhân; mountpoint/tài khoản
  NTRIP cá nhân nếu được cấp quyền `own` sẽ mở từ menu phụ hoặc deep link.
- Dashboard của User hiển thị số liệu toàn công ty; danh sách sự cố/hoạt động
  gần đây sẽ lọc theo quyền `own` trừ khi chủ dự án muốn company-wide.
- NtripCaster v1 không nhập username/password → mountpoint không auth; v2 bắt
  buộc tài khoản.

## 3. Hiện trạng và khoảng cách

| Khu vực | Hiện tại | Cần đạt |
|---|---|---|
| RBAC | `all/subtree/own/none`, owner-based | Thêm `tenant`; tách `system_health.view`, `caster.*`; sửa seed ghi đè quyền |
| Dashboard | 4 vùng, KPI cũ | KPI trạm/account/relay có on/off/khác; incidents + audit tối đa 5, 2 cột |
| Trạm | code bắt buộc; form trộn tạo/xem; thiếu vị trí địa lý | Form tạo gọn; form xem đầy đủ; geocode; source client/caster |
| Chi tiết trạm | 5 tab; quality có Sky Plot | Thêm uptime 1d/7d/30d; siết dữ liệu vệ tinh |
| Mountpoint | Có auth/password; Explorer riêng | 4 trường; gộp Explorer; cảnh báo xóa theo listener/relay/account |
| Listener | Tạo chưa chọn mountpoint | Multiselect mountpoint ngay khi tạo; owner/tenant |
| NTRIP account | Checkbox ACL mountpoint; auth method | Multiselect listener + mountpoint; bỏ auth method; ACL thật |
| Relay | Form thiếu trường; chưa import JSON | Form đầy đủ; import single/array; dry-run/transaction/audit |
| Bảng | Có STT, filter thu gọn | Checkbox dòng + bulk action theo module |
| Unicode | `stations.notes` có ký tự `?` thật | Repair dữ liệu + chuẩn hóa encoding |
| Map | `/map` hiện có | Không sửa trong P1 |

## 4. Phân tích graphify

- Graph hiện tại: `graphify-out/graph.json`, **1.734 nodes**.
- Các cụm chính:
  - `app.ts`, `rbac/permissions.ts`, `rbac/scope.ts`, `middleware/auth.ts`
  - `admin/001_init.sql` và các migration
  - `Stations.tsx`, `Mountpoints.tsx`, `Caster.tsx`, `RelayJobs.tsx`,
    `NtripAccounts.tsx`, `ui.tsx`
  - `caster`, `quality`, `relay`, `snapshot`, `socket`
- Hệ quả:
  - Thay đổi scope/quyền ảnh hưởng đồng thời REST, Socket.IO, nav và mọi list.
  - Station source/tọa độ ảnh hưởng schema, form, drawer, map sau này.
  - ACL listener phải sửa cả Node, Go caster, UI và test sourcetable.
- Graph có thể chưa cập nhật hết thay đổi UI gần nhất; trước khi code chạy
  `graphify update .`. Cảnh báo phiên bản graphify: skill 0.9.99, package 0.9.97;
  nên upgrade trước khi dùng tiếp.

## 5. Mô hình đích

### 5.1 Scope `tenant`

```text
all | subtree | tenant | own | none
```

- `tenant` = toàn bộ user thuộc công ty.
- Company root = admin cao nhất không phải `super_admin` trong chuỗi
  `parent_user_id`.
- Admin dùng `subtree`; User dùng `tenant` cho Dashboard/Trạm/Relay.
- User dùng `own` cho các module cá nhân được cấp.

### 5.2 Ma trận quyền đích

| Module | Super admin | Admin | User |
|---|---|---|---|
| Dashboard | all | tenant | tenant |
| Stations view | all | subtree | tenant |
| Stations add/edit/delete | all | subtree | none |
| Relay view | all | subtree | tenant |
| Relay add/edit/delete | all | subtree | none |
| Mountpoints | all | subtree | own |
| Listeners/Caster | all | subtree | none |
| NTRIP accounts | all | subtree | own |
| Web users | all | subtree, level thấp hơn | none; `/profile` riêng |
| Roles | all | view read-only, không add/edit/delete | none |
| Connections | all | subtree view/disconnect | none |
| Alerts/Quality | all | subtree view/ack | own view; không ack |
| Audit/History | all | subtree | none |
| System Health | all | **none** | none |
| Settings | all | none | none |

### 5.3 Chuẩn dữ liệu trạng thái

```text
Station: active | disabled | locked
Mountpoint: active | locked
NTRIP account: active | locked | expired
Relay: enabled | disabled | streaming | connecting | backoff | error
```

Nhãn UI: Đang bật / Đã tắt / Đã khóa / Hết hiệu lực / Đang streaming.

### 5.4 Bulk action theo bảng

| Trang | Bulk action |
|---|---|
| Trạm | Bật, tắt, khóa, mở khóa, xóa |
| Mountpoint | Bật, khóa, mở khóa, xóa |
| Listener | Bật, tắt, xóa |
| Tài khoản NTRIP | Khóa, mở khóa, xóa |
| Relay | Bật, tắt, restart, xóa |
| Người dùng web | Khóa, mở khóa, xóa |
| Cảnh báo | Xác nhận, đánh dấu đã đọc |
| Lịch sử/audit | Không bulk mutation; có thể export selected |

Mọi bulk action:

- Checkbox chọn dòng hiện tại; header checkbox chọn cả trang.
- Bulk bar hiển thị số lượng + action.
- Server kiểm tra scope từng ID, transaction, audit, không log secret.
- Không cho partial âm thầm: trả lỗi rõ nếu có ID ngoài quyền.

## 6. Thứ tự phase

| Phase | Nội dung | Phụ thuộc |
|---|---|---|
| P1.0 | Baseline, backup, graph update, encoding audit | — |
| P1.1 | Schema & dữ liệu nền | P1.0 |
| P1.2 | RBAC tenant + permission matrix | P1.1 |
| P1.3 | Shared UI: DataTable selection, BulkBar, MultiSelect | P1.2 |
| P1.4 | Dashboard số liệu & layout | P1.2 |
| P1.5 | Trạm: form, vị trí, source, chi tiết, uptime | P1.1–P1.3 |
| P1.6 | Mountpoint gộp Explorer + Listener multiselect | P1.3 |
| P1.7 | NTRIP account ACL listener + caster/sourcetable | P1.2, P1.6 |
| P1.8 | Relay form + import JSON | P1.1, P1.3 |
| P1.9 | Unicode, lịch sử, chuẩn hóa hiển thị | P1.5–P1.8 |
| P1.10 | Regression, docs, bàn giao | P1.0–P1.9 |
| P1.11 | Bản đồ vận hành | Phase sau |

---

## Phase P1.0 — Baseline, backup và audit dữ liệu

### Mục tiêu

Có mốc an toàn trước khi đổi schema/dữ liệu và xác định chính xác lỗi Unicode.

### Việc cần làm

1. Backup `cors_admin`, `cors_runtime` và cấu hình.
2. Chạy baseline:
   - `cd server && npm test && npm run build`
   - `cd frontend && npm run build`
   - `cd gnss && go test ./... && go vet ./...`
   - Playwright hiện có.
3. Chạy `graphify update .` sau khi xác nhận graph cũ.
4. Audit Unicode:
   - `stations.name`, `stations.notes`, `stations.address`, `region`.
   - `alerts.title/message`, `relay_sessions.message`, `audit_logs` JSON.
   - Tìm chuỗi có `?`, `�`, `Ã`, `â€`, `Æ`, `ÿ`.
5. Ghi danh sách bản ghi lỗi và mapping sửa.

### File/khu vực

- `SESSION.md`, `TASKS.md`
- DB backup ngoài workspace
- `docs/1/03_CAC_BUOC_THUC_HIEN_P1.md` (nhật ký)

### Yêu cầu cần đạt

- Backup restore thử được.
- Baseline PASS hoặc danh sách FAIL rõ.
- Có danh sách dữ liệu Unicode lỗi, không sửa mù.

### Checklist test

- [ ] `git status` sạch trước khi bắt đầu.
- [ ] Server test PASS.
- [ ] Frontend build PASS.
- [ ] Go test/vet PASS.
- [ ] Backup/restore thử PASS.
- [ ] Graphify updated.
- [ ] Danh sách Unicode lỗi được ghi lại.

### Ghi chú

- Dừng nếu backup không restore được.
- Không chạy relay/caster cũ ngoài phạm vi cho phép.

---

## Phase P1.1 — Schema và dữ liệu nền

### Mục tiêu

Có schema đủ cho tên trạm, trạng thái, tọa độ/địa lý, source, listener ACL và
tenant.

### Việc cần làm

1. Migration admin mới:
   - `stations.status ENUM('active','disabled','locked')`
   - `stations.coordinate_type ENUM('wgs84','vn2000','itrf')`
   - `stations.province`, `stations.ward`, `stations.address_detail`
   - `caster_listeners.owner_web_user_id`
   - `role_permissions.scope` thêm `tenant`
   - `account_listener_acl(account_id, listener_id)`
   - `station_sources` cho NtripClient/NtripCaster
2. `station_sources` tối thiểu:
   - `station_id` PK/FK
   - `source_role ENUM('ntrip_client','ntrip_caster')`
   - client: host, port, mountpoint, username, password_enc, tls,
     send_gga, nmea_interval_sec
   - caster: version, username, password_enc, requires_auth
   - `relay_job_id` nullable chỉ để tham chiếu nếu cần
3. Loại bỏ mô hình auth khỏi mountpoint:
   - Không cho tạo/sửa `auth_mode/password_hash` trên mountpoint.
   - `requires_auth` chỉ còn là cờ kỹ thuật nội bộ hoặc bỏ nếu đã chuyển
     hoàn toàn sang account/listener ACL.
   - Vì dữ liệu là test: backup rồi xóa toàn bộ mountpoint cũ, mapping cũ;
     import lại từ `db/data/caster_mountpoints.csv` sau khi tạo station.
4. Sinh `stations.code` tự động sau insert (`STN-<id>` hoặc slug ổn định),
   không cho nhập từ form.
5. Backfill:
   - `enabled` → `status`.
   - owner công ty cho dữ liệu legacy nếu chủ dự án xác nhận.
   - Không tự đoán owner/tọa độ.
6. Cập nhật `seed.ts`: không xóa/ghi đè `role_permissions` mỗi lần chạy.

### File/khu vực

- `db/migrations/admin/014_*.sql` trở đi
- `server/src/db/seed.ts`
- `server/src/db/importLegacyCaster.ts`
- `server/src/routes/stations.ts`, `mountpoints.ts`, `caster.ts`

### Yêu cầu cần đạt

- Migration idempotent/fail-fast, có dry-run nếu xóa dữ liệu.
- Không còn mountpoint auth/password trong API/UI.
- Station không cần nhập code.
- Không có mountpoint mồ côi.
- Backup trước khi xóa mountpoint.

### Checklist test

- [ ] Migration chạy trên DB có dữ liệu.
- [ ] Migration chạy lại không phá dữ liệu.
- [ ] `stations.status` backfill đúng.
- [ ] Mountpoint reimport khớp 36/36.
- [ ] `account_listener_acl` rỗng trước khi cấu hình.
- [ ] Seed restart không đổi quyền.

### Ghi chú

- Không drop cột legacy ngay nếu còn rollback.
- Nếu drop `auth_mode/password_hash`, phải xác nhận không còn thiết bị legacy
  phụ thuộc trước cutover.

---

## Phase P1.2 — RBAC tenant và menu

### Mục tiêu

Phân quyền đúng Super/Admin/User, chống xem chéo công ty và chống seed ghi đè.

### Việc cần làm

1. Thêm `tenant` vào `Scope`, `role_permissions.scope`.
2. Thêm:
   - `tenantRootId(userId)`
   - `tenantIds(userId)`
3. Cập nhật:
   - `server/src/rbac/scope.ts`
   - `server/src/rbac/access.ts`
   - `server/src/middleware/auth.ts`
   - `server/src/realtime/filter.ts`
   - `server/src/realtime/socket.ts`
4. Thêm permission:
   - `system_health.view`
   - `caster.view/add/edit/delete`
5. Sửa route Caster từ `settings.*` sang `caster.*`.
6. System Health yêu cầu `system_health.view`.
7. Sửa `roleMatrix` theo bảng §5.2.
8. Sửa `seed.ts`:
   - Chỉ seed permission/role nếu chưa có.
   - Không `DELETE FROM role_permissions` mỗi lần chạy.
   - Có cờ `--reset-rbac` riêng cho môi trường test.
9. Frontend:
   - `AuthProvider.permissions` dùng scope tenant.
   - Layout ẩn menu System Health với Admin/User.
   - Roles page: Admin xem read-only, ẩn add/edit/delete.
   - User chỉ thấy Dashboard/Trạm/Relay/Profile; module cá nhân mở khi có
     quyền own.
10. Audit mọi thay đổi role/permission.

### Yêu cầu cần đạt

- Admin không xem System Health.
- Admin không sửa role/permission.
- Admin quản lý listener/caster trong subtree.
- User xem toàn công ty Stations/Relay/Dashboard nhưng không sửa/xóa.
- User quản lý own ở module được cấp.
- Company A không thấy Company B.
- Restart server không làm mất chỉnh quyền.

### Checklist test

- [ ] Unit scope tenant.
- [ ] Unit permission matrix.
- [ ] API Super/Admin/User từng module.
- [ ] Cross-tenant 403/404.
- [ ] Admin System Health 403.
- [ ] Admin sửa role 403.
- [ ] User sửa/xóa trạm/relay 403.
- [ ] Seed restart giữ quyền.
- [ ] Socket room/realtime lọc tenant.

### Ghi chú

- Tenant dựa trên cây `parent_user_id`, chưa thêm bảng company riêng.
- Nếu cần nhiều công ty độc lập hơn, phase sau thêm `company_id`.

---

## Phase P1.3 — Shared UI: chọn dòng, bulk action, multiselect

### Mục tiêu

Mọi bảng có hành động đều chọn được nhiều dòng; thay checkbox ACL bằng
multiselect có tìm kiếm.

### Việc cần làm

1. Mở rộng `DataTable`:
   - `selectable?: boolean`
   - `selectedKeys: Set<string|number>`
   - `onSelectionChange`
   - Header checkbox chọn trang hiện tại.
   - Dòng checkbox có accessible name.
2. Thêm `BulkActionBar`:
   - `Đã chọn N`
   - `Bỏ chọn`
   - Action buttons theo module.
3. Thêm `SearchableMultiSelect`:
   - Input search bên trong.
   - Danh sách checkbox.
   - Chọn tất cả/đã chọn.
   - Chip/tóm tắt.
   - Keyboard accessible.
4. Bulk API:
   - `POST /api/stations/bulk`
   - `POST /api/mountpoints/bulk`
   - `POST /api/caster/listeners/bulk`
   - `POST /api/ntrip-accounts/bulk`
   - `POST /api/relay-jobs/bulk`
   - `POST /api/web-users/bulk`
   - `POST /api/alerts/bulk-ack`
5. Mọi bulk API:
   - Validate action + IDs.
   - Scope từng ID.
   - Transaction.
   - Audit.
   - Trả `updated`, `skipped`, `forbidden`, `notFound`.

### Yêu cầu cần đạt

- Không chọn/sửa/xóa dòng ngoài quyền.
- Bulk all-or-nothing hoặc báo partial rõ; không silent.
- Header checkbox chỉ chọn trang hiện tại, có nhãn rõ.
- Multiselect tìm theo tên/username/code.
- Không còn checkbox list dài không search.

### Checklist test

- [ ] Chọn nhiều dòng, bulk đúng.
- [ ] Bỏ chọn, đổi trang reset selection.
- [ ] Bulk cross-tenant bị chặn.
- [ ] Audit ghi batch.
- [ ] Multiselect keyboard/focus.
- [ ] Mobile 390 không tràn.

---

## Phase P1.4 — Dashboard

### Mục tiêu

Dashboard trả lời nhanh quy mô và sự cố, bố cục 2 cột.

### Việc cần làm

1. `GET /api/ops/dashboard` trả:
   - `stations {total, active, disabled, locked, other}`
   - `ntripAccounts {total, active, disabled, expired, other}`
   - `relays {total, streaming, disabled, error, other}`
   - `incidents {total, critical, warning, info}`
   - health
   - incidents tối đa 5
   - recentAudit tối đa 5
2. Frontend:
   - 4 KPI đúng định nghĩa mới.
   - Sự cố + hoạt động gần đây 2 cột desktop, stack mobile.
   - Mỗi vùng giữ màu phân loại hiện có.
   - Link mở đúng trạm/relay/alerts.

### Checklist test

- [ ] Số liệu khớp DB/API.
- [ ] Incidents tối đa 5.
- [ ] Audit tối đa 5.
- [ ] 2 cột 1440/768, stack 390.
- [ ] RBAC Super/Admin/User.
- [ ] Dark mode.

---

## Phase P1.5 — Trạm

### Mục tiêu

Form tạo gọn, form xem đầy đủ; dữ liệu vị trí/kết nối/hệ thống chuẩn hóa.

### Việc cần làm

1. `StationForm`:
   - Create: chỉ Thông tin cơ bản + Thông tin kết nối.
   - Ẩn Vị trí và Hệ thống khi tạo.
   - View: đầy đủ, read-only.
   - Edit: đầy đủ; Hệ thống read-only.
2. Thông tin cơ bản:
   - Bỏ input mã trạm.
   - Gộp receiver/antenna/serial/firmware/device/network vào đây.
   - Không đặt bật/tắt/khóa trong form; dùng bulk action.
3. Vị trí:
   - `coordinate_type`: WGS84/VN2000/ITRF.
   - Chỉ hiển thị tọa độ read-only từ 1005/1006.
   - Province/ward/address_detail.
   - Backend `GET /api/geo/reverse` dùng Geoapify, key server-side,
     cache, timeout, fallback.
4. Kết nối:
   - `station_sources`.
   - NtripClient: host, port, mountpoint, username, password, TLS, GGA,
     tần suất.
   - NtripCaster: v1/v2; v1 username/password optional; v2 bắt buộc.
   - Không lưu plaintext; password mã hóa.
5. Hệ thống read-only:
   - creator, created_at, updated_at, status, streaming.
6. Bảng trạm:
   - Cột: ID/tên, trạng thái, nguồn, thiết bị, vị trí, MP, quality,
     dữ liệu cuối.
   - Bulk bật/tắt/khóa/mở/xóa.
7. Chi tiết:
   - Tổng quan theo dữ liệu mới.
   - Kết nối: uptime 24h/7d/30d, timeout/error breakdown.
   - Chất lượng: biểu đồ vệ tinh + bảng constellation + CNR/cell.
   - Metadata giữ nguyên.
   - Lịch sử giữ nguyên, sửa Unicode.
8. API uptime:
   - `GET /api/stations/:id/uptime?range=1d|7d|30d`
   - Nguồn: caster source connections + relay sessions/source runner.
   - Trả bucket, uptime, timeouts, auth/proxy/network errors.

### Checklist test

- [ ] Tạo trạm không cần code, không thấy vị trí/hệ thống.
- [ ] Sau tạo mở form xem đầy đủ.
- [ ] 1005/1006 điền tọa độ; Geoapify fill địa chỉ.
- [ ] Không lộ Geoapify key.
- [ ] NtripClient/Caster hiện đúng trường.
- [ ] Uptime 3 range có dữ liệu.
- [ ] Quality chart/table có dữ liệu hoặc ghi rõ thiếu.
- [ ] Bulk trạng thái.
- [ ] RBAC user view-only.

---

## Phase P1.6 — Mountpoint và Listener

### Mục tiêu

Mountpoint tối giản; Explorer gộp vào trang Mountpoint; listener tạo kèm
mountpoint.

### Việc cần làm

1. Xóa toàn bộ mountpoint cũ; import lại.
2. Bảng/form mountpoint chỉ còn:
   - Tên, trạm, trạng thái, ghi chú.
3. Bỏ auth/password/service/caster interval khỏi UI/API public.
4. Bỏ menu/route `/mountpoints/explorer`.
5. Click mountpoint mở drawer Explorer gộp:
   - Source state, quality, relay, listener, account, online, alerts.
6. `DELETE` mountpoint:
   - `GET /api/mountpoints/:id/impact` trước.
   - ConfirmDialog liệt kê listener, relay, account, online.
   - Vẫn cho xóa sau cảnh báo; có thể yêu cầu gõ tên.
7. Listener:
   - Create/Edit nhận `mountpointIds` bằng `SearchableMultiSelect`.
   - API transaction listener + mapping.
   - Thêm owner_web_user_id.
8. Bulk mountpoint/listener.

### Checklist test

- [ ] Mountpoint list chỉ 4 thông tin.
- [ ] Không còn Explorer menu, deep link `/mountpoints/:id`.
- [ ] Xóa hiện cảnh báo liên kết.
- [ ] Listener tạo kèm mountpoint.
- [ ] Sourcetable listener đúng mapping.
- [ ] Bulk.

---

## Phase P1.7 — NTRIP account, listener ACL và caster

### Mục tiêu

Tài khoản giới hạn thật theo listener + mountpoint; sourcetable phản ánh đúng.

### Việc cần làm

1. Bỏ `auth_method` khỏi form/table.
2. Thêm `SearchableMultiSelect` listener + mountpoint.
3. Backend:
   - `account_listener_acl`.
   - `GET/PUT /api/ntrip-accounts/:id/listeners`.
   - Cập nhật account create/update nhận `listenerIds`, `mountpointIds`.
   - Trả `effectiveMountpoints`.
4. Effective ACL:
   - `listenerMounts = union(mountpoints của listener được chọn)`
   - `effective = listenerMounts ∩ selectedMountpoints`
   - Nếu chọn full mountpoint vẫn chỉ còn 5 của listener 1508.
5. Go caster:
   - `AccountConfig.ListenerACL`.
   - `authorize(req, mountpoint, listenerID)`.
   - Rover/source kiểm tra listener ACL + mountpoint ACL.
   - Sourcetable có Basic auth: chỉ trả effective mountpoints.
   - Anonymous: chỉ trả mountpoint public theo cấu hình; mặc định không trả.
6. UI hiển thị preview quyền hiệu lực.
7. Test account A listener 1508:
   - Sourcetable có đúng 5.
   - Kết nối ngoài 5 → 403/404.
   - Kết nối trong 5 → 200.
8. Bulk khóa/mở/xóa account.

### Checklist test

- [ ] Account A thấy 5 mountpoint.
- [ ] Chọn full mountpoint không vượt listener.
- [ ] Connect ngoài ACL bị từ chối.
- [ ] Sourcetable không lộ mountpoint khác.
- [ ] Max connection vẫn đúng.
- [ ] v1/v2 SOURCE/rover PASS.
- [ ] Không lộ hash/password.

---

## Phase P1.8 — Relay

### Mục tiêu

Tạo relay bằng form đầy đủ hoặc import JSON single/array an toàn.

### Việc cần làm

1. Form thêm:
   - Station ID/external key
   - Source host/port/mount/user/pass/proxy/SSL
   - Destination host/port/mount/user/pass/proxy/SSL
   - Lat/lon
   - UA prefix
   - NMEA interval
2. JSON import:
   - Object hoặc array.
   - Map `src_*`/`dst_*` → schema.
   - `dryRun` bắt buộc cho preview.
   - Transaction, idempotent theo `id`.
   - Kiểm tra trùng, loop guard.
   - Audit không log password.
3. UI:
   - Nút Import JSON.
   - Modal preview dry-run: created/updated/errors.
   - Nút xác nhận commit.
4. Bulk enable/disable/restart/delete.

### Checklist test

- [ ] Import single.
- [ ] Import array.
- [ ] Dry-run không ghi DB.
- [ ] Idempotent.
- [ ] Loop/self-loop bị chặn.
- [ ] Không lộ credential.
- [ ] Bulk.

---

## Phase P1.9 — Unicode, lịch sử và hiển thị

### Mục tiêu

Loại bỏ chuỗi lỗi encoding và thống nhất cách hiển thị.

### Việc cần làm

1. Sửa `pool.ts` dùng `charset: utf8mb4`.
2. Repair dữ liệu:
   - `stations.notes` 79/80 và bản ghi tương tự.
   - `alerts.title/message`, `relay_sessions.message`, audit JSON.
   - Dùng mapping tường minh; backup trước.
3. Import Excel/CSV giữ UTF-8.
4. Kiểm tra mọi trang hiển thị tiếng Việt đúng.
5. Chuẩn hóa nhãn trạng thái, ngày giờ, đơn vị.
6. Kiểm tra History: session end, message, result, close reason, audit.

### Checklist test

- [ ] Không còn `�`, `â€`, `Ã` trong dữ liệu hiển thị.
- [ ] Không còn chuỗi `Tr???m`/`H???u` trong bản ghi đã Repair.
- [ ] Import/export giữ tiếng Việt.
- [ ] History hiển thị đúng.

---

## Phase P1.10 — Regression và bàn giao

### Việc cần làm

1. Server test/build.
2. Frontend build.
3. Go test/vet.
4. Playwright cũ + mới.
5. Backup/restore, migration dry-run.
6. Cập nhật `SESSION.md`, `TASKS.md`, `AGENTS.md` nếu có quy tắc mới.
7. Commit/push.

### Checklist test

- [ ] Server PASS.
- [ ] Frontend PASS.
- [ ] Go PASS.
- [ ] Playwright PASS.
- [ ] RBAC Super/Admin/User.
- [ ] Cross-company isolation.
- [ ] Bulk actions.
- [ ] Multiselect.
- [ ] Geoapify fallback.
- [ ] Relay JSON.
- [ ] Unicode.
- [ ] Không secret trong diff/log.

---

## Phase P1.11 — Bản đồ vận hành (để sau)

Không làm trong P1. Các phụ thuộc cần giữ ổn định:

- `stations.status`, tọa độ WGS84/VN2000/ITRF, vùng/địa chỉ.
- `stations.owner_web_user_id` và tenant scope.
- Marker chỉ dùng 1005/1006.
- Layer, filter, panel, deep link `/map?station=`.
- Map chỉ đọc dữ liệu; không sửa trạm.

Khi làm phase map, cần đọc lại `docs/1/02` Phase 3 và cập nhật map contract.

---

## 7. Test matrix tổng hợp

| Nhóm | Test |
|---|---|
| RBAC | Super/Admin/User; tenant A/B; roles read-only; health 403; seed restart |
| Bulk | Từng module; cross-scope; partial; audit; mobile |
| Station | Create ẩn section; view đầy đủ; geocode mock; coords; source client/caster |
| Uptime | 1d/7d/30d; timeout/error buckets; empty data |
| Quality | Sky plot; constellation; CNR/cell; thiếu dữ liệu |
| Mountpoint | 4 fields; Explorer merged; delete impact; reimport |
| Listener | Tạo kèm mountpoint; multiselect search |
| NTRIP | Listener ACL; effective mountpoints; sourcetable; connect rejects outside |
| Relay | Form; JSON single/array; dry-run; idempotent; loop; secret |
| Unicode | DB/API/UI; Excel import/export |
| Regression | 15 Playwright hiện có + test mới |

## 8. Migration & rollback

- Backup trước mọi migration xóa mountpoint.
- Migration theo thứ tự; không sửa migration cũ.
- Không drop cột legacy trong cùng release nếu rollback chưa chắc.
- Seed RBAC có cờ reset riêng, không reset mặc định.
- Với dữ liệu test, được xóa mountpoint cũ nhưng phải có script reimport.
- Rollback: restore DB backup + checkout commit trước P1 + rebuild dev containers.

## 9. Rủi ro

1. Tenant scope dựa cây user; nếu owner dữ liệu null sẽ không thấy.
2. Admin hiện dùng `settings.view`; đổi permission có thể làm mất menu/route.
3. Listener ACL thay đổi hành vi sourcetable; client NTRIP có thể cần auth.
4. Station source NtripClient cần Go runner mới; ảnh hưởng load/reconnect.
5. Xóa mountpoint là thao tác phá hủy; cần backup/confirm rõ.
6. Geoapify phụ thuộc mạng/rate limit.
7. Unicode repair có thể không phục hồi được ký tự đã mất; chỉ sửa bản ghi có mapping.
8. Bulk action sai scope có thể xóa chéo công ty; bắt buộc test.

## 10. Definition of Done P1

1. P1.0–P1.10 PASS; P1.11 map ghi rõ defer.
2. RBAC đúng ma trận; cross-company isolation.
3. Không còn mountpoint auth/password trong UI/API public.
4. Listener ACL effective đúng ví dụ 1508/5 mountpoint.
5. Bulk action và multiselect hoạt động.
6. Dữ liệu trạm/mountpoint chuẩn hóa, reimport sạch.
7. Unicode PASS.
8. Không secret trong diff/log.
9. Test evidence trong `SESSION.md`.
10. `graphify update .` sau thay đổi cấu trúc.

## 11. Nhật ký thực hiện

### P1.0 — Baseline, backup và Unicode audit (2026-10-31)

- Trạng thái: **DONE**.
- Backup:
  - `C:\Users\ADMIN\AppData\Local\Temp\opencode\p1-backup-20261031`
  - `p1_full.sql`, `p1_admin.sql`, `p1_runtime.sql`.
- Restore thử:
  - trước: stations 39 / mountpoints 39 / quality_samples 22.420.
  - restore DB tạm: 39 / 39 / 22.420 → PASS; đã drop DB tạm.
- Graphify:
  - `graphify update .` PASS: 2.364 nodes, 5.814 edges, 173 communities.
  - Cảnh báo package 0.9.97 cũ hơn skill 0.9.99; không chặn.
- Baseline test:
  - Server build + Vitest 48/48 PASS.
  - Frontend build PASS.
  - Go test + vet PASS.
  - Playwright 15/15 PASS.
  - Sửa test UI cũ dùng tên trạm thay vì mã trạm để khớp UI hiện tại;
    dọn bản ghi test `UI*` còn sót.
- Unicode audit:
  - `stations.notes` lỗi: 2 bản ghi — id 79 `SLA_MocChau`, id 80
    `THA_HauLoc` (literal `?`).
  - `stations.address/region`, `alerts.title/message`,
    `relay_sessions.message`: 0 lỗi.
  - Frontend source: không phát hiện mojibake.
  - Backend `server/src/routes/stations.ts`: 9 dòng chứa mojibake
    (`KhĂ´ng`, `ChÆ°a`, `â€”`, `Â·`); sẽ sửa ở P1.9.
- Commit: `f21c5ed` — `chore(p1-0): chot baseline backup graphify va unicode audit`.

### P1.1 — Schema và dữ liệu nền (2026-10-31)

- Trạng thái: **DONE** (phần schema; reset/reimport mountpoint chuyển sang P1.6 để
  không phá caster trước khi listener ACL hoàn tất).
- Migration đã áp dụng:
  - `014_station_p1.sql`: `stations.status`, `coordinate_type`, `province`,
    `ward`, `address_detail`.
  - `015_station_sources.sql`: bảng `station_sources` cho NtripClient/NtripCaster;
    backfill 39 trạm.
  - `016_account_listener_acl.sql`: `account_listener_acl`,
    `caster_listeners.owner_web_user_id`.
  - `017_tenant_scope.sql`: `role_permissions.scope` thêm `tenant`.
- Kết quả DB:
  - station status: 39 active.
  - station_sources: 39.
  - listener owner: 2 listener đang null, sẽ gán ở P1.2/P1.6.
- Test:
  - `server npm run build` PASS; Vitest 48/48 PASS.
  - `frontend npm run build` PASS.
  - Migration dry-run/apply PASS, admin version 17.
- Ghi chú: chưa drop `mountpoints.auth_mode/password_hash`; sẽ xử lý cùng reset
  mountpoint ở P1.6 để tránh gãy caster hiện tại.
- Commit: `19cc562` — `feat(p1-1): schema station source listener acl va tenant scope`.

### P1.2 — RBAC tenant và menu (2026-10-31)

- Trạng thái: **DONE**.
- Graphify:
  - `graphify update .` PASS: 2.380 nodes, 5.835 edges, 174 communities.
- Code:
  - `Scope` thêm `tenant`; `tenantRootId`, `tenantIds` dựa cây
    `parent_user_id`.
  - `scopeIdsFor`, `assertRecordScope`, realtime filter/socket và dashboard
    dùng đúng ids theo từng scope (tenant/subtree/own).
  - `roleMatrix` tách sang `server/src/rbac/matrix.ts`.
  - Seed không xóa `role_permissions`; thêm cờ `--reset-rbac`.
  - Permission mới `system_health.view`, `caster.view/add/edit/delete`;
    route caster không còn dùng `settings.*`.
  - Caster listener có owner, list/detail/update/delete/mountpoint đều kiểm
    scope; listener cũ được backfill owner admin.
  - Frontend ẩn System Health với Admin/User; Caster dùng `caster.*`;
    Roles có scope `tenant` và Admin read-only.
- Migration:
  - `018_p1_rbac_matrix.sql`: permission mới + ma trận 3 role hệ thống.
  - `019_listener_owner_backfill.sql`: gán owner listener null.
- Test:
  - Server build PASS; Vitest **53/53 PASS** (thêm matrix/tenant/realtime).
  - Frontend build PASS.
  - Playwright `p1-rbac.spec.ts` **3/3 PASS**:
    Admin không xem System Health, không tạo role; User không tạo/xóa trạm,
    không sửa relay; công ty A không thấy trạm công ty B; cleanup PASS.
  - Seed chạy lại: `[seed] role_permissions đã có dữ liệu, bỏ qua ghi đè` PASS.
- Ghi chú: listener owner cũ đã gán admin; P1.6 sẽ gán owner theo công ty khi
  tạo/reimport.
- Commit code: `147beb4` — `feat(p1-2): rbac tenant menu quyen va listener owner`.

### P1.3 — Shared UI và bulk action (2026-10-31)

- Trạng thái: **DONE**.
- Shared UI:
  - `DataTable` hỗ trợ `selectable`, `selectedKeys`, `onSelectionChange`,
    checkbox header chọn trang, checkbox dòng có accessible name.
  - `BulkActionBar` hiển thị `Đã chọn N`, `Bỏ chọn`, action theo module.
  - `SearchableMultiSelect` có search, chọn tất cả kết quả, chip, keyboard,
    trạng thái disabled.
- Bulk API:
  - `POST /api/stations/bulk` (enable/disable/lock/unlock/delete).
  - `POST /api/mountpoints/bulk` (enable/disable/delete).
  - `POST /api/caster/listeners/bulk` (enable/disable/delete).
  - `POST /api/ntrip-accounts/bulk` (lock/unlock/delete).
  - `POST /api/relay-jobs/bulk` (enable/disable/delete).
  - `POST /api/web-users/bulk` (lock/unlock/delete, chặn self/last super).
  - `POST /api/alerts/bulk-ack`.
  - Mọi bulk API trả `{updated, skipped, forbidden, notFound}`, kiểm scope
    từng ID, transaction và audit batch.
- UI:
  - Các bảng Stations/Mountpoints/Listener/NTRIP/Relay/WebUsers/Alerts có
    chọn nhiều dòng; xóa hàng loạt dùng AlertDialog.
  - ACL của NTRIP account và Listener dùng `SearchableMultiSelect`.
  - Selection reset khi đổi trang/bộ lọc.
- Test:
  - Server build PASS; Vitest **53/53 PASS**.
  - Frontend build PASS.
  - Playwright `p1-bulk.spec.ts` **3/3 PASS**: chọn trang/bỏ chọn/reset,
    mobile 390 không tràn, multiselect search/focus, bulk station + audit batch,
    cross-tenant forbidden, 6 bulk route validate action.
- Commit code: `59deb9b` — `feat(p1-3): bang chon dong bulk action va multiselect`.

### P1.4 — Dashboard số liệu và layout (2026-10-31)

- Trạng thái: **DONE**.
- API `GET /api/ops/dashboard`:
  - `stations {total, active, disabled, locked, other}`.
  - `ntripAccounts {total, active, disabled, expired, other}`.
  - `relays {total, streaming, disabled, error, other}`.
  - `incidentsCount {total, critical, warning, info}`.
  - `incidents` tối đa 5; `recentAudit` tối đa 5.
  - Mọi số liệu lọc theo scope tenant/subtree/own.
- Frontend:
  - 4 KPI: Trạm, Tài khoản NTRIP, Relay, Sự cố mở.
  - Sự cố + Hoạt động gần đây 2 cột desktop/tablet, stack mobile.
  - Giữ màu phân loại zone; health chỉ hiện với `system_health.view`.
- Test:
  - Server build PASS; Vitest **53/53 PASS**.
  - Frontend build PASS.
  - Playwright `p1-dashboard.spec.ts` **2/2 PASS**: số liệu khớp API,
    incidents/audit ≤5, 2 cột 1440/768, stack 390, user tenant + health null.
- Commit code: `75e943b` — `feat(p1-4): dashboard so lieu tenant va layout hai cot`.
