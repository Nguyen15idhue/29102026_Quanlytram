# KẾ HOẠCH PHASE 7–12 — HOÀN THIỆN PHẦN MỀM QUẢN LÝ TRẠM CORS

> Ngày lập: 2026-10-30. Tài liệu này là bản khảo sát + roadmap chi tiết cho
> Phase 7–12. Checklist thực thi nằm ở `TASKS.md`; thứ tự bước và test nằm ở
> `docs/0/CAC_BUOC_THUC_HIEN.md`.

## 1. Mục tiêu

- Sửa các lỗi nhất quán đang thấy trên UI: default port, dữ liệu trạm thiếu,
  menu phẳng, popup sơ sài, owner hiển thị ID, footer dev.
- Đưa dữ liệu trạm lên đủ để vận hành: receiver/antenna/SN/firmware/vị trí/
  vùng/đơn vị thi công/custom fields.
- Tổ chức lại IA theo nhóm chức năng, học cách CGBAS tổ chức thông tin.
- Bổ sung các mảng còn thiếu: notification center, dictionary, custom fields,
  user center, log viewer, export/import, báo cáo, bản đồ trạm.
- Giữ nguyên bất biến: Node ghi `cors_admin`; Go ghi `cors_runtime`; Node không
  nằm trên đường byte RTCM; không thêm Redis/Kafka/K8s.

## 2. Ngoài phạm vi

Không làm trong Phase 7–12:

- VRS/subnet/grid division/transfer/subscribe (động cơ NRTK hoàn chỉnh).
- Storage task dữ liệu thô: `obs_type`, sample rate, upload FTP/SFTP cron.
- Displacement monitor/RTK engine/post-processing/push third-party.
- Expression engine kiểu SpEL của CGBAS.
- Open API key cho khách + QPS (có thể mở phase sau).
- Copy password plaintext, i18n lệch menu/route, bundle không menu của CGBAS.

## 3. Hiện trạng mã nguồn

### 3.1 Frontend

| Route | Trang | Hiện có | Thiếu / vấn đề |
|---|---|---|---|
| `/` | Dashboard | KPI realtime, relay list, quick actions, session | Không có trạng thái trạm, map, chart xu hướng, freshness rõ |
| `/stations` | Trạm | List + CRUD modal + detail drawer + quality panel | Form 7 trường; thiếu receiver/antenna/SN/vùng/custom fields; list thiếu trạng thái, vị trí, mountpoint, dữ liệu cuối; owner là ID |
| `/mountpoints` | Mountpoint | CRUD cơ bản | Thiếu owner name, trạng thái trạm, ACL, filter |
| `/relay-jobs` | Relay | CRUD + action + detail + quality | Thiếu credential status, endpoint test, import/export; detail còn mỏng |
| `/history` | Lịch sử relay | Session/event/hour tabs | Chưa có filter sâu, export |
| `/alerts` | Cảnh báo | List + ack | Chưa có event type/level/unread; chưa có notification center |
| `/caster` | Caster | Listener/mount/connection | Thiếu force disconnect, online user, nhóm cấu hình |
| `/ntrip-accounts` | TK NTRIP | CRUD + ACL cơ bản | Thiếu company/phone/available area/thời hạn/online session |
| `/web-users`, `/roles` | Quản trị | CRUD + role matrix | Thiếu user center, menu/permission admin, API key, log |
| — | — | — | Không có dictionary/custom fields/system params/log viewer/export/import |

Tổ chức FE hiện tại: page monolithic trong `frontend/src/pages/*`, component
dùng chung ở `components/ui.tsx`, query key rải rác, format ngày/trạng thái
lặp lại ở nhiều page. Chưa có feature module/query key registry/hook dùng chung.

### 3.2 Backend

| Module | Endpoint chính | Ghi chú |
|---|---|---|
| Auth/RBAC | `/api/auth`, `/api/roles`, `/api/permissions` | Có session + CSRF + scope; chưa có audit API/log viewer |
| Stations | `/api/stations` | Schema chỉ 10 trường; chưa có profile/status/owner name |
| Mountpoints | `/api/mountpoints` | CRUD cơ bản; chưa có ACL/filter |
| Relay | `/api/relay-jobs` | CRUD + action + import; default port từng là 2101 |
| NTRIP | `/api/ntrip-accounts` | CRUD + ACL placeholder |
| Caster | `/api/caster`, `/api/connections` | Listener/mount/connection |
| Realtime | `/api/snapshot`, Socket.IO | Dashboard/history/alerts |
| Quality | `/api/quality/*`, `/api/stations/:id/quality` | Parser Go + REST + socket |
| Alerts | `/api/alerts` | Schema cũ, thiếu event_type/level/unread |
| Settings | bảng `settings` | Chưa có API/UI quản trị |

Route file lớn (`quality.ts` ~24KB, `relayJobs.ts` ~23KB); chưa có service
layer rõ giữa route và SQL. Validation đặt trong route; một số default bị
hardcode ở cả FE/BE/DB.

### 3.3 Database

- Admin: `001_init` → `007_port_defaults` (mới); runtime: `001_init` → `004_rtcm_quality`.
- `stations` hiện có: code, name, host, port, connection_type, lat, lon, notes,
  owner, timestamps.
- `alerts` hiện có: type, severity, target, title, message, status, dedupe,
  ack; chưa có `event_type`, `level`, `unread`, `read_at`.
- Có `settings`, `audit_logs`, `station_probes`, `quality_alert_acks`.
- Chưa có `dictionaries`, `custom_field_defs`, `menu_items`, `notification_rules`.

## 4. Đối chiếu CGBAS (chỉ phần liên quan)

### 4.1 Menu/route CGBAS

| Nhóm | Route/chức năng | Dùng cho ta |
|---|---|---|
| Workbench | `/workbench` | Dashboard tổng quan |
| Station | `/station/station-overview` | Danh sách + map trạm |
| Station | `/station/station-operation/station-manage` | Hồ sơ trạm, realtime info |
| Station | `/station/station-operation/data-inspect` | Chất lượng dữ liệu trạm |
| Station | `/station/station-operation/coord-update` | Cập nhật toạ độ/ARP |
| Station | `/station/station-operation/station-control` | Test/restart/control, firmware |
| Station | `/station/comprehensive-ephemeris` | Lịch thiên văn (cân nhắc sau) |
| Broadcast | caster/mount/user-account/online-user/online-map | Caster + online user |
| Notification | `/notification-center` (all/unread) | Notification center |
| System | access user/role/menu | Quản trị user/quyền/menu |
| System | data custom-fields/coordinate/electronic-fence | Dictionary/custom fields |
| System | config dictionary/notification/params/version | Cấu hình hệ thống |
| System | logs login/operate | Log viewer |
| User center | `/user-center` | Hồ sơ/đổi mật khẩu |
| Skip | subnet/grid/storage/displacement/VRS | Ngoài phạm vi |

### 4.2 Trường trạm CGBAS (từ chunk `station-manage`)

| Nhóm | Trường |
|---|---|
| Cơ bản | station name, identify name, type, receiver type, antenna type, antenna height, antenna SN, contractor, station SN, device ID, receiver URL, region, elevation mask, custom fields |
| Kết nối | IP, port, username, password, protocol, mountpoint, source list, encrypt strategy, co-located |
| Toạ độ | lat, lon, elevation, ECEF X/Y/Z, default/extend coordinate, update time |
| Realtime | data age, epoch, satellites, disconnect count, flow, total flow, CPU temp, environment temp, network/SIM, battery/AC, receiver/OEM firmware |
| Chất lượng | online rate, integrity rate, cycle ratio, MP, SNR, epoch |
| Vận hành | start/stop, restart, firmware upgrade, storage settings (skip storage) |
| Cảnh báo | event type/name/object/level/time/read |
| Dictionary | code/name/value/order/status/description |
| User | account/name/email/phone/role/status/locked/API key |
| Log | login/operate: module/type/method/url/time/status/request/response |

### 4.3 Bài học áp dụng

- Dùng **nhóm menu** thay vì danh sách phẳng.
- Trang trạm phải trả lời: trạm nào đang chạy, dữ liệu cuối khi nào, chất
  lượng ra sao, thiết bị gì, ai quản lý.
- Chi tiết trạm dùng tab; form sửa là popup riêng.
- Select dùng dictionary, không hardcode.
- Notification center có All/Unread + read-all + level/type.
- Log viewer và user center là chức năng hệ thống, không phải trang dev.

## 5. Ma trận khoảng cách

| Ưu tiên | Khoảng cách | Ảnh hưởng | Phase |
|---|---|---|---|
| P0 | Default port 2101 ở form/API/DB/seed | Sai cấu hình, lệch quyết định 1509 | P7-00 (đã sửa) |
| P0 | Trạm chỉ có 7 trường nghiệp vụ | Không vận hành được, form sơ sài | P7 |
| P0 | List/detail trạm thiếu trạng thái, vị trí, thiết bị, dữ liệu cuối | Người dùng không biết trạm nào cần xử lý | P7 |
| P0 | Menu phẳng, footer dev, topbar trùng tên | IA rối, thiếu tin cậy | P7 |
| P1 | Không có dictionary/custom fields | Form không nhất quán, khó mở rộng | P7/P10 |
| P1 | Alert cũ, không notification center | Bỏ lỡ sự kiện vận hành | P9 |
| P1 | Không có user center/log viewer/system params | Thiếu quản trị vận hành | P10 |
| P1 | Không có export/import chuẩn | Khó bàn giao, khó nhập liệu | P11 |
| P1 | Không có map/overview trạm | Khó nhìn tổng thể | P8 |
| P2 | FE page monolithic, format lặp | Khó bảo trì, UI lệch nhau | P7/P11 |
| P2 | BE route lớn, chưa service layer | Khó test/mở rộng | P7/P12 |
| P2 | Chưa load test 50–100, probe runner defer | Rủi ro production | P12 |

## 6. Menu chốt

```text
Dashboard

Trạm
├── Bản đồ trạm
└── Danh sách trạm

CORS
├── Bản đồ online
├── Danh sách online
├── Tài khoản NTRIP
├── Mountpoint
└── Caster

Relay

Hệ thống
├── Phân quyền
├── Người dùng
├── Lịch sử
└── Cảnh báo

(Ẩn menu) Trang cá nhân — mở khi bấm avatar/tên người dùng
```

Quyết định đã chốt:
- Excel `.xlsx` dùng **`exceljs`**; không dùng CSV làm mặc định cho các màn hình có yêu cầu Excel.
- Bản đồ online chỉ hiện marker tài khoản NTRIP **có gửi toạ độ**; tài khoản không gửi toạ độ không hiện marker, chỉ hiện tổng số “x tài khoản không gửi tọa độ”. Có thêm menu **Danh sách online**.
- Import người dùng: file Excel **không có cột password**; hệ thống tự tạo mật khẩu **123456**, ghi audit, không export password.
- Caster: **listener CRUD** + tab **live/force disconnect**.

## 7. Quy ước UI chung

- Mọi bảng server-side pagination, **mặc định 10**, luôn hiển thị kể cả `0–0 / 0`; cho chọn `10/20/50`.
- Search debounce; filter/page lưu URL; loading/empty/error đủ.
- CRUD dùng Dialog/Drawer; xóa dùng AlertDialog; không form inline.
- Toolbar list: Thêm, Import, Export Excel, Tải lại.
- Row actions: Xem, Sửa, Xóa; màn hình chất lượng có thêm “Xem chất lượng”.
- Import: template `.xlsx`, preview, lỗi theo dòng `Line {0} column {1} {2}`, transaction, audit.
- Export: `.xlsx` theo bộ lọc hiện tại hoặc toàn bộ, giới hạn dòng, audit; không xuất secret/password.
- Icon lucide monochrome; dark mode token; a11y AA; 1440/768/390.

## 8. Đặc tả màn hình

### 8.1 Dashboard
**Nhìn thấy:**
- KPI: Tổng trạm, Trạm online, Trạm mất dữ liệu/lỗi, Tài khoản NTRIP online, Relay streaming, Cảnh báo mở.
- “Sức khỏe trạm”: mã/tên, trạng thái, quality score, dữ liệu cuối, mountpoint.
- Biểu đồ 24h: tỷ lệ online, quality score.
- Cảnh báo gần đây: level, thời gian, đối tượng, tiêu đề, trạng thái.
- Hoạt động gần đây: audit/event.
- Nút nhanh: Thêm trạm, Thêm tài khoản NTRIP, Thêm relay.
- Badge realtime + thời điểm cập nhật.

### 8.2 Trạm → Bản đồ trạm
**Nhìn thấy:**
- Bản đồ toàn bộ trạm, **không có relay**.
- Marker màu: online, stale, offline, error, unknown.
- Panel trái: search, filter trạng thái/vùng/owner, danh sách trạm.
- Popup marker: mã, tên, trạng thái, quality score, satellites, dữ liệu cuối, mountpoint, receiver/antenna, toạ độ, owner.
- Nút: Xem chi tiết, Sửa (nếu có quyền).
- Legend + attribution OSM; realtime marker/status.

### 8.3 Trạm → Danh sách trạm
**Cột:** mã, tên, trạng thái, vị trí, thiết bị (receiver/antenna), mountpoint, dữ liệu cuối, chất lượng, owner, thao tác.

**Filter:** mã/tên, trạng thái, vùng, owner, receiver, có mountpoint, có probe, quality.

**Form nhóm:**
- **Định danh:** mã, tên, loại trạm, bật/tắt, owner, vùng, địa chỉ, đơn vị thi công, tags, ghi chú.
- **Vị trí:** vĩ độ, kinh độ, độ cao, hệ toạ độ, toạ độ mặc định, toạ độ mở rộng, elevation mask.
- **Thiết bị:** hãng/model receiver, serial receiver, firmware, hãng/model antenna, serial antenna, chiều cao antenna, radome, device ID, receiver URL.
- **Kết nối:** host, port mặc định **1509**, protocol, mountpoint, username/password, TLS, proxy, network type/mode, source mode, probe bật/tắt + interval.
- **Vận hành read-only:** trạng thái, dữ liệu cuối, quality, số mountpoint, phiên online.
- **Custom fields:** trường động theo dictionary.

**Popup chi tiết — tab:** Tổng quan / Kết nối / Mountpoint / Chất lượng / Lịch sử. Nút **Sửa** mở popup sửa riêng.

### 8.4 CORS → Bản đồ online
**Nhìn thấy:**
- Bản đồ trạm + marker tài khoản NTRIP **có gửi toạ độ**.
- Tài khoản không gửi toạ độ: không có marker; hiển thị badge/tổng “x tài khoản không gửi tọa độ”.
- Panel phải: tài khoản online có toạ độ; click highlight marker.
- Popup trạm: danh sách tài khoản online tại trạm/mountpoint.
- Filter: online, tài khoản, mountpoint, caster, trạng thái.

### 8.5 CORS → Danh sách online
**Cột:** username, tên/company, mountpoint, caster/listener, remote IP, login time, thời lượng, bytes in/out, trạng thái toạ độ (có/không), thao tác.

**Filter:** online, tài khoản, mountpoint, caster, có toạ độ/không toạ độ, search.
**Thao tác:** Xem chi tiết, force disconnect (nếu có quyền), export Excel.
**Dòng “không gửi tọa độ”** vẫn hiển thị trong danh sách, chỉ không có marker.

### 8.6 CORS → Tài khoản NTRIP
**Cột:** username, tên/company, bật/tắt, max connections, đang online, mountpoint, hiệu lực từ/đến, owner, last login, thao tác.

**Form nhóm:**
- **Tài khoản:** username, password, tên/company, người liên hệ, email, phone, bật/tắt, max connections, hiệu lực từ/đến, owner, tags, ghi chú.
- **Truy cập:** mountpoint được phép (multi-select), caster/listener được phép, auth method, available area.
- **Runtime read-only:** online, số kết nối, last login, bytes, remote IP, mountpoint hiện tại.

**Drawer:** thông tin + ACL + phiên đang online.

### 8.7 CORS → Mountpoint
**Cột:** tên, trạm, bật/tắt, yêu cầu auth, service type, caster/listener, online users, quality, owner, thao tác.

**Form nhóm:**
- **Cơ bản:** tên, trạm, bật/tắt, yêu cầu auth, owner, mô tả.
- **Broadcast:** service type, position mode, hệ vệ tinh, caster interval, code protocol/type, mountpoint standard/group.
- **Runtime read-only:** listener, online users, source status, quality.

### 8.8 CORS → Caster
**Cột:** tên, port, role, bật/tắt, số mountpoint, connections, bytes, uptime, trạng thái, thao tác.

**Form nhóm:**
- **Cơ bản:** tên, port (mặc định 1509), role `both/source/rover`, bật/tắt, mô tả.
- **Mountpoint:** multi-select mountpoint được gán.
- **Nâng cao:** auth mode, max connections, TLS (nếu bật).
- **Runtime read-only:** trạng thái, connections, bytes, uptime.

**Drawer:** Tổng quan / Mountpoint / **Kết nối live** / Lịch sử. Tab live có force disconnect.

### 8.9 Relay
**Cột:** tên, bật/tắt, trạng thái, upstream, downstream, mode, quality/parity, owner, last error, thao tác.

**Form nhóm:**
- **Cơ bản:** tên, bật/tắt, owner, tags, origin.
- **Upstream:** host, port 1509, mount, credential, proxy, SSL, NTRIP version.
- **Downstream:** host, port 1509, mount, credential, proxy, SSL, NTRIP version, mode.
- **Nâng cao:** lat/lon, UA prefix, NMEA interval.
- **Runtime read-only:** state, revision, last error, bytes, frames, quality, parity.

**Drawer:** Tổng quan / Upstream / Downstream / Chất lượng / Lịch sử. Nút enable/disable/restart/test.

### 8.10 Hệ thống → Phân quyền
**Cột:** code, tên, level, mô tả, role hệ thống, số user, thao tác.
**Form:** code, tên, level, mô tả.
**Ma trận quyền:** module × action (`view/add/edit/delete/ack`) × scope (`all/subtree/own/none`). Role hệ thống bị khóa sửa/xóa.
**Import/export:** role + ma trận quyền; preview; chỉ role tùy chỉnh.

### 8.11 Hệ thống → Người dùng
**Cột:** username, tên hiển thị, email, phone, role, parent, trạng thái, locked, last login, thao tác.

**Form nhóm:**
- **Tài khoản:** username (chỉ tạo), password/reset, tên hiển thị, email, phone, avatar.
- **Phân quyền:** role, parent user, trạng thái, locked.
- **Read-only:** created at, last login, phiên hiện tại.

**Import Excel:** cột username, display_name, email, phone, role_code, parent_username, status; **không có password**; hệ thống tạo mật khẩu **123456**; audit; không export password.

### 8.12 Hệ thống → Lịch sử
**Tab:** Phiên / Sự kiện / Theo giờ.
**Filter:** relay job, from/to, result/type, search.
**Cột:**
- Phiên: job, start, end, duration, result, close reason, message.
- Sự kiện: job, time, type, message, duration.
- Theo giờ: job, hour, online sec, sessions, errors, timeouts, auth/proxy/nmea errors, retries.
- Pagination 10; export Excel.

### 8.13 Hệ thống → Cảnh báo
**Tab:** Tất cả / Chưa đọc / Đang mở / Đã xử lý.
**Cột:** level, event type, đối tượng, tiêu đề/message, trạng thái, unread, first/last, ack by/at, thao tác.
**Filter:** level, type, target, status, time, search.
**Drawer:** chi tiết, link đối tượng, ack note, đánh dấu đã đọc. Nút ack/read-all.

### 8.14 Trang cá nhân (ẩn menu)
Mở khi bấm avatar/tên người dùng.
- **Hồ sơ:** avatar, username read-only, tên hiển thị, email, phone, role read-only, parent read-only.
- **Đổi mật khẩu:** hiện tại, mới, xác nhận.
- **Phiên đăng nhập:** thiết bị/IP/thời gian; đăng xuất các phiên khác.

## 9. Roadmap Phase 7–12 (theo menu)

### Phase 7 — Nền tảng UI & Trạm danh sách
- Shell/menu nhóm mới; bỏ footer dev; breadcrumb; user center entry.
- Shared list framework: pagination 10 luôn hiển thị, filter URL, import/export `.xlsx` (`exceljs`), audit.
- Hồ sơ trạm + dictionary/custom fields + API trạm v2.
- Danh sách trạm CRUD, quality, filter, import/export.
- Form trạm nhóm; test connection GET-only.

### Phase 8 — Bản đồ & chi tiết trạm
- Bản đồ trạm Leaflet/OSM, marker trạng thái, panel danh sách.
- Popup chi tiết trạm: Tổng quan/Kết nối/Mountpoint/Chất lượng/Lịch sử.
- Bản đồ online: marker tài khoản có toạ độ; badge số tài khoản không gửi toạ độ.
- Danh sách online: bảng chi tiết, filter, export; force disconnect nếu có quyền.

### Phase 9 — CORS
- Tài khoản NTRIP CRUD, ACL, hiệu lực, import/export `.xlsx`.
- Mountpoint CRUD, broadcast config, runtime.
- Caster listener CRUD + tab live/force disconnect + import/export.

### Phase 10 — Relay & Hệ thống
- Relay CRUD + quality + import/export.
- Phân quyền: role + permission matrix + import/export.
- Người dùng: CRUD + import Excel mật khẩu 123456 + export không password.
- Lịch sử: sessions/events/hourly + export.
- Cảnh báo: filter/ack/read; notification center cơ bản.

### Phase 11 — Cá nhân, cấu hình & báo cáo
- Trang cá nhân ẩn menu; đổi mật khẩu; phiên đăng nhập.
- Notification center nâng cao + event config.
- Dictionary/custom fields admin, system params, brand/logo, log viewer.
- Dashboard chart/report, retention, backup/restore UI.

### Phase 12 — Hardening & release
- Load 50–100; security; E2E; a11y/responsive/dark mode.
- Migration/backup/restore/release/rollback; observability.

## 10. Test gate tối thiểu

| Gate | Nội dung |
|---|---|
| G7 | Menu/shell + shared list + pagination 10 + import/export `.xlsx` + trạm list/form |
| G8 | Bản đồ trạm + chi tiết trạm + bản đồ online + danh sách online |
| G9 | NTRIP account + mountpoint + caster listener/live/force disconnect |
| G10 | Relay + role/user/history/alert + import user 123456 |
| G11 | User center + notification/config + report/retention |
| G12 | Load 50–100 + security + E2E + backup/restore + release |

## 11. Việc đã sửa ngay trong phiên này

- Default port trạm/relay/DB/seed → **1509**; thêm migration
  `db/migrations/admin/007_port_defaults.sql`.
- `CASTER_PORT=1509` trong `.env.local`.
- Graphify cập nhật: 1734 nodes, 4486 edges, 112 communities.
- Ghi nhận khảo sát CGBAS, menu/field spec và quyết định `exceljs`/online map/import user/caster live.
