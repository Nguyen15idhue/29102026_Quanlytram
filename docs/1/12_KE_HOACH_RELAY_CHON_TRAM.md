# Kế hoạch 12 — Chọn trạm nguồn/đích khi tạo relay

- Ngày: 2026-11-03
- Phạm vi: form Relay (tạo/sửa), API relay, dữ liệu trạm, phân quyền hiển thị
- Trạng thái: DONE (gate 2026-11-03)

## 1. Mục tiêu

- Form relay chia 3 section: **Nguồn dữ liệu**, **Đích đến dữ liệu**, **Thông tin khác**.
- Mỗi phía có select **Mode**: `Nhập thủ công` (mặc định) / `Chọn trạm`.
  - Nhập thủ công: giữ nguyên các trường host/port/mount/proxy/SSL/version/username/password.
  - Chọn trạm: chỉ hiện select trạm (+ tóm tắt endpoint chỉ đọc).
- Không cho chọn trạm ở cả hai phía (tránh relay vòng một trạm về chính nó); có banner giải thích.
- Trạm được lọc theo quyền hiện có (`stations.view`): superadmin thấy tất cả, admin/user chỉ trong công ty.
- Relay do superadmin tạo không hiển thị với cấp thấp hơn.

## 2. Quyết định đã chốt

1. “Chọn trạm” ưu tiên mountpoint của trạm trên caster nội bộ:
   `host=127.0.0.1`, `port=caster_listeners.port` (qua `station_sources.caster_listener_id`),
   `mount=tên mountpoint`, credential = `caster_username/caster_password` của trạm.
   Trạm `ntrip_client` không có mountpoint thì fallback `client_host/port/mount/tls` +
   `client_username/client_password`.
2. Mật khẩu trạm được copy kín ở server sang `relay_credentials` (AAD mới), không trả
   plaintext về trình duyệt.
3. Trạm có nhiều mountpoint: hiện thêm select mountpoint (chỉ khi >1).
4. “Tên relay” nằm ở section Thông tin khác (bắt buộc); “Đích mode” nằm ở section Đích.
5. Ẩn relay superadmin: relay tạo bởi superadmin có `company_id = NULL`
   (owner = chính superadmin), nên mọi truy vấn scope tenant/company tự loại;
   superadmin (scope `all`) vẫn thấy. Không backfill dữ liệu cũ.

## 3. Dữ liệu

Migration admin **038**:

- `relay_jobs.upstream_station_id`, `downstream_station_id` BIGINT NULL (không FK).
- `relay_jobs.upstream_mountpoint_id`, `downstream_mountpoint_id` BIGINT NULL (không FK).
- Index nhẹ theo station id.

## 4. API

- `GET /api/relay-jobs/station-options` (`stations.view`):
  trả trạm theo scope + endpoint tóm tắt 2 hướng + danh sách mountpoint; không trả password.
- `POST /api/relay-jobs`, `PATCH /api/relay-jobs/:id`:
  nhận thêm `upstreamStationId`, `downstreamStationId`, `upstreamMountpointId`,
  `downstreamMountpointId`.
  - Có station id → server resolve endpoint + credential, bỏ qua host/port/mount client gửi.
  - Chặn `400 RELAY_SAME_STATION` nếu cả hai phía chọn trạm.
  - Chặn `403/404` nếu trạm ngoài scope.
- `publicJob` trả thêm 4 id để form sửa hiển thị đúng mode.
- Relay do superadmin tạo: `owner_web_user_id = superadmin`, `company_id = NULL`.
  Đọc danh sách/chi tiết/snapshot/history vẫn dùng scope hiện có nên cấp thấp không thấy.
- Các join đọc relay không kèm scope công ty (relay của trạm, mountpoint explorer,
  đếm trên bản đồ) thêm điều kiện bỏ qua job `company_id IS NULL` với non-superadmin.

## 5. Giao diện

- `RelayJobs.tsx`: tách form thành 3 `<section>` có tiêu đề; select Mode thay radio.
- Trạng thái form thêm: mode nguồn/đích, station id, mountpoint id.
- Đổi mode một phía sang `Chọn trạm` → phía kia tự về `Nhập thủ công`, clear lựa chọn;
  banner thông báo lý do.
- GGA: checkbox “Có gửi GGA” điều khiển hiển thị vĩ độ/kinh độ/NMEA interval.
- Sửa job: nếu có station id → mở đúng mode `Chọn trạm`; ngược lại `Nhập thủ công`.
- A11y: label cho select, banner `role="status"`, focus không nhảy khi ẩn/hiện trường.

## 6. Kiểm thử

- Server unit: resolve mountpoint vs ntrip_client; chặn 2 mode; chặn trạm ngoài scope;
  copy credential đúng AAD; superadmin tạo job → `company_id NULL`, admin không thấy.
- SQL scope: relay list của admin không chứa job superadmin; superadmin thấy.
- Playwright: 3 section; đổi mode ẩn/hiện; banner + khóa mode đối diện; tạo relay bằng
  trạm fixture `DOCS-Trạm Hậu Lộc`; sửa giữ mode; superadmin tạo relay → admin không thấy;
  390/768 không tràn.
- Gate: server `tsc` + test; frontend `tsc` + build; Playwright toàn bộ; migrate dev.

Kết quả gate 2026-11-03:

- Migration admin 038 applied; server **37 file/179 test PASS**, `tsc` PASS.
- Frontend `tsc` + build PASS; Playwright **59/59 PASS** (3.3 phút).
- Smoke API: tạo relay bằng trạm → `downstream 127.0.0.1:1509/<mountpoint>`,
  `companyId null`; admin list = 0, station detail không lộ relay;
  `station-options` của admin chỉ còn công ty 35; chọn trạm cả 2 phía → 400
  `RELAY_SAME_STATION`.

## 7. Tài liệu

- `docs-site/docs/07-relay.md`: mô tả 3 section, mode chọn trạm, ràng buộc và quyền hiển thị.
- `SESSION.md`, `TASKS.md`, `docs/2/THUC_HIEN_FIX_LOI.md`: cập nhật sau khi gate PASS.
