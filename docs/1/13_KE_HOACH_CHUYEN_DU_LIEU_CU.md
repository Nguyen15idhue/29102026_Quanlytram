# Kế hoạch 13 — Chuyển dữ liệu hệ thống cũ sang hệ thống mới

- Ngày: 2026-11-03
- Trạng thái: kế hoạch, chưa thực thi (không sửa code ở bước này)
- Nguồn dữ liệu: `db/data/` (config.json, caster_stations.*, caster_mountpoints.*,
  sourcetable_1508/1509.txt, caster_scan_summary.md)
- Đích: hệ thống hiện tại (MySQL `cors_admin`/`cors_runtime`, Go caster 1508/1509)

## 1. Hiện trạng dữ liệu nguồn

| Hạng mục | Số lượng | Ghi chú |
|---|---:|---|
| Trạm (station) | 36 | 31 có trong caster, 5 chỉ có trong relay config |
| Mountpoint | 36 dòng / 35 tên | 26 mapping 1509, 6 mapping 1508, 1 tên nằm cả 2 port (`TNN_TpThaiNguyen`) |
| Relay job | 67 | 66 bật; 36 job lấy nguồn từ hệ thống cũ `rtktk.online`, 31 job nguồn hệ thống khác |
| Relay đích hệ thống cũ | 7 | 2 job đẩy vào 1508, 5 job đẩy vào 1509 |
| Sourcetable 1509 | 26 STR | auth = `none` |
| Sourcetable 1508 | 6 STR | auth = `none` |

Điểm quan trọng:

- Trạm V1 chỉ xuất hiện trong sourcetable khi đang online; danh sách đầy đủ nằm
  trong `caster_stations.json` + `caster_mountpoints.csv` + `config.json`.
- Toạ độ trong sourcetable là `0.00`; file CSV để trống → **không import 0,0**.
  Chờ 1005/1006 hoặc probe sau.
- `BG.TP` là tên mountpoint hợp lệ; mã trạm phải là `BG_TP` (regex code).
- Không có mật khẩu publish của thiết bị trong `db/data`; sourcetable ghi
  `auth=none` → hệ thống cũ không kiểm tra mật khẩu khi trạm đẩy dữ liệu.

## 2. Hiện trạng hệ thống đích (trước khi xoá)

- 3 công ty, 6 người dùng, 8 trạm, 9 mountpoint, 13 relay job, 7 tài khoản NTRIP,
  5 listener (chỉ giữ 1508/1509).
- Có dữ liệu test: DOCS Demo, E2E, trạm/probe/relay test.
- Listener cần giữ: id 1 (1509), id 2 (1508). Listener 15151, 15152, 15999 xoá.

## 3. Mục tiêu sau chuyển đổi

1. Chỉ còn 1 công ty **Wally** (`code=WALLY`) và tài khoản **superadmin**.
2. Tạo tài khoản admin **wally** (role admin, thuộc Wally, must_change_password).
3. Giữ đúng 2 listener 1508/1509; xoá listener và dữ liệu test khác.
4. Import đủ 36 trạm, 35 mountpoint (36 mapping port), 67 relay job từ hệ thống cũ.
5. Import 3 NTRIP account đang dùng (`nguyen`, `admin`, `aitogy123`) + ACL.
6. Trạm V1 đẩy dữ liệu tới 1509/1508 được hệ thống nhận như cũ (nguồn không
   xác thực), sourcetable hiển thị đúng khi trạm online.
7. Relay job chạy đúng byte, credential mã hoá; admin wally chỉ thấy dữ liệu Wally.
8. Không còn dữ liệu test; có backup và đường rollback.

## 4. Quyết định kỹ thuật đề xuất

### 4.1. Xác thực nguồn V1 (1508/1509)

Phân biệt hai loại kết nối:

- **Nguồn (trạm đẩy dữ liệu lên caster)**: hệ thống cũ không kiểm tra mật khẩu;
  thiết bị gửi Basic với mật khẩu ngẫu nhiên.
- **Đọc mountpoint (rover/relay lấy dữ liệu)**: vẫn giữ nguyên tắc hiện tại —
  phải có NTRIP account + ACL mountpoint.

Đề xuất:

- Thêm lựa chọn **“v1 (nguồn không xác thực)”** trong cấu hình nguồn caster của
  trạm (`station_sources.caster_requires_auth = 0`). Chỉ áp dụng cho chiều
  **publish** (SOURCE/POST) của trạm đó.
- Mountpoint vẫn `requires_auth = 1`; rover/relay đọc dữ liệu phải đăng nhập
  NTRIP như hiện tại. Không hạ chuẩn xác thực phía đọc.
- Caster (Go) khi nhận publish: nếu station source của mountpoint có
  `caster_requires_auth = 0` thì cho phép publish không cần account (vẫn đọc
  Basic nếu client gửi). Với chiều đọc, giữ nguyên `authorize()` + ACL.
- UI hiện cảnh báo “nguồn không xác thực” ở trạm; audit khi bật/tắt.

Đây là thay đổi code Go (caster) + UI, thực hiện ở pha triển khai.

### 4.2. Relay job

- `external_key = id cũ` để chạy lại không tạo trùng.
- Import **disabled toàn bộ** ở môi trường dev/local để không kết nối ra ngoài;
  giữ trạng thái bật/tắt cũ trong `tags` để bật lại khi cutover.
- **Không rewrite host**: giữ nguyên `rtktk.online` và các host khác đúng như
  `config.json`, vì sau này hệ thống mới dùng chính tên miền `rtktk.online`.
- 5 job đang đẩy vào `rtktk.online:1509` **giữ nguyên** (relay từ hệ thống
  khác về trạm của hệ thống hiện tại).
- Credential `src_user/src_pass`, `dst_user/dst_pass` mã hoá bằng APP_ENC_KEY;
  không ghi log/không xuất ra báo cáo.

### 4.3. Trạm và mountpoint

- Trạm: `code`, `name`, `enabled`, `station_type=reference`, `source_type`
  theo CSV (`relay_caster`/`caster_ingest`), `ntrip_version=v1`.
- `host = rtktk.online`, `port = 1509/1508` theo CSV (hệ thống mới sẽ dùng
  chính tên miền này).
- 5 trạm chỉ có trong relay config: vẫn tạo trạm nhưng **không** tạo mountpoint
  local.
- Mountpoint: giữ nguyên tên (kể cả `BG.TP`), gắn `station_id`, bật/tắt theo
  `in_caster`, mapping vào listener 1509/1508 theo cột `caster_ports`;
  **`requires_auth = 1`** (rover/relay đọc vẫn phải có NTRIP account + ACL).
- `station_sources`: `source_role=ntrip_caster`, `caster_version=v1`,
  `caster_username` = mã trạm, `caster_requires_auth=0` (nguồn không xác thực),
  `caster_listener_id` theo port.
- Bỏ qua probe test (`db/data/probes/*`) trừ khi được yêu cầu.

### 4.4. NTRIP account cho chiều đọc/relay

Dù nguồn trạm không xác thực, chiều đọc vẫn cần account. `config.json` cho thấy
3 tài khoản đang được relay dùng khi trỏ `rtktk.online`:

| Username | Quyền dùng trong config | Số mountpoint |
|---|---|---:|
| `nguyen` | đọc (src) | 15 |
| `admin` | đọc (src) | 13 |
| `aitogy123` | đọc + ghi (src/dst) | 4 |

- Import 3 account này với **đúng mật khẩu cũ** (mã hoá), owner Wally.
- ACL: chỉ các mountpoint xuất hiện trong config (đọc/ghi) như bảng trên.
- Không tạo account mới cho trạm; trạm dùng nguồn no-auth.
- Nếu sau này cần rover khác, tạo account qua UI như bình thường.

### 4.5. Phạm vi listener 1508

- 1508 chỉ map các mountpoint có `caster_ports` chứa 1508: `BG.TP`,
  `TNN_DaiTu`, `TNN_PhoYen`, `TNN_TpThaiNguyen`, `TNN_VoNhai`, `YBI_XuanAI`
  (6 mountpoint; `TNN_TpThaiNguyen` nằm cả 1508 và 1509).
- Không map mountpoint 1509 sang 1508; sourcetable 1508 chỉ thấy các mountpoint
  này.
- 1509 map 26 mountpoint còn lại theo CSV.

### 4.6. Toạ độ giả định theo tên trạm

Toạ độ trong sourcetable là 0.00, CSV để trống → import toạ độ giả định theo
prefix tên trạm, ghi chú “toạ độ giả định, chờ 1005/1006”. Bảng prefix:

| Prefix | Khu vực suy luận | Lat, Lon |
|---|---|---:|
| BDH | Bình Định (Hoài Ân) | 14.05, 108.95 |
| BG | Bắc Giang | 21.27, 106.20 |
| BKN | Bắc Kạn (Ba Bể) | 22.15, 105.83 |
| BTE | Bến Tre (Châu Thành) | 10.24, 106.38 |
| CMU | Cà Mau (Đất Mũi) | 9.18, 105.15 |
| DTP | Đồng Tháp (Tân Hồng) | 10.45, 105.63 |
| GLI | Gia Lai | 13.98, 108.00 |
| HBH | Hòa Bình | 20.82, 105.34 |
| HUG | Hậu Giang (Vị Thủy) | 9.78, 105.47 |
| KGG | Kiên Giang (Giồng Riềng) | 10.01, 105.08 |
| LCI | Lào Cai | 22.49, 103.97 |
| PYN | Phú Yên (Sông Hinh) | 13.09, 109.30 |
| QBH | Quảng Bình (Lệ Thủy) | 17.47, 106.60 |
| QNH | Quảng Ninh (Đông Triều) | 21.00, 107.30 |
| SLA | Sơn La (Mộc Châu/TP) | 21.33, 103.91 |
| THA | Thanh Hóa (Hậu Lộc/Ngọc Lặc) | 19.80, 105.78 |
| TNN | Thái Nguyên | 21.59, 105.85 |
| TQG | Tuyên Quang (Hàm Yên) | 21.82, 105.21 |
| YBI | Yên Bái | 21.72, 104.90 |
| hauloc | Thanh Hóa (Hậu Lộc) | 19.93, 105.75 |
| MocChautest | Sơn La (Mộc Châu) | 20.85, 104.63 |

Trạm có tên huyện trong mã (Ba Bể, Châu Thành, Đất Mũi, Giồng Riềng, Hậu Lộc,
Ngọc Lặc, Đông Triều, Hoài Ân, Vị Thủy…) lấy toạ độ huyện; còn lại lấy trung tâm
tỉnh.

## 5. Các pha thực hiện

### Pha 0 — Chuẩn bị và backup

1. Dừng ghi dữ liệu (maintenance window), không chạy relay mới.
2. Backup `cors_admin` + `cors_runtime` ra ngoài repo (mysqldump + kiểm tra size).
3. Lưu báo cáo hiện trạng: counts, listeners, users, schemas.
4. Xác nhận không đụng `relayrtcm\backup`, không chạy `relay.exe`, không chiếm
   port 8081/2101.

### Pha 1 — Công cụ import (implementation)

1. Script Node `db:import-legacy` (dry-run mặc định, `--apply` mới ghi):
   - Đọc `config.json`, `caster_stations.json`, `caster_mountpoints.csv`.
   - Chuẩn hoá tên/port, phát hiện trùng hoa-thường, mountpoint 2 port.
   - Xuất báo cáo: số trạm/mountpoint/relay/account, danh sách credential
     thiếu, toạ độ giả định, job trùng/vòng.
   - Idempotent theo `external_key`/`code`; chạy trong transaction.
2. Bổ sung caster chế độ **nguồn không xác thực** (`caster_requires_auth=0`)
   cho chiều publish; chiều đọc vẫn bắt buộc NTRIP account + ACL; test Go với
   mock source.
3. UI trạm: thêm lựa chọn `v1 (nguồn không xác thực)` cạnh `v1`/`v2`, cảnh
   báo + audit khi bật/tắt.

### Pha 2 — Xoá dữ liệu test (sau backup)

Thứ tự xoá (một transaction):

1. Runtime: `relay_job_state`, `relay_sessions`, `quality_samples`,
   `quality_alerts`, `station_uptime`, timeline/service runs, alerts.
2. Admin: `alerts`, `audit` (backup trước), `relay_credentials`, `relay_jobs`,
   `station_sources`, `station_probes`, `mountpoints`, `ntrip_account_acl*`,
   `ntrip_accounts`, `web_sessions`, `web_users` (trừ superadmin),
   `companies` (trừ Wally).
3. `caster_listener_mountpoints` + listener ngoài 1508/1509.
4. Giữ: `superadmin`, listener 1508/1509, `settings` (map/system), schema
   migrations.

Sau đó tạo `WALLY` + user `wally` (mật khẩu ngẫu nhiên in một lần, bắt đổi).

### Pha 3 — Import tài nguyên

1. Import 36 trạm (host `rtktk.online`, port theo CSV, toạ độ giả định).
2. Import 35 mountpoint + 36 mapping listener (1509: 26, 1508: 6;
   `TNN_TpThaiNguyen` nằm cả hai).
3. Import station_sources (`v1`, `caster_requires_auth=0`, listener theo port).
4. Import 3 NTRIP account (`nguyen`, `admin`, `aitogy123`) + ACL theo config.
5. Import 67 relay job + credential (disabled, giữ nguyên host/port); ghi
   trạng thái bật/tắt cũ vào `tags`.
6. Ghi audit cho từng nhóm; không ghi secret.

### Pha 4 — Kiểm chứng

- SQL: companies=1, users=2 (superadmin+wally), stations=36, mountpoints=35,
  mappings=36, relays=67, listeners=2 (1508/1509), NTRIP accounts=3 đúng ACL.
- Dry-run lần 2 = 0 thay đổi (idempotent).
- Mock V1 source đẩy vào 1509/1508 **không cần Basic** → được nhận, xuất hiện
  trong sourcetable; ngắt → biến mất.
- Đọc mountpoint **không có account** → 401; có account đúng ACL → 200.
- Mock relay byte-exact vào 1508/1509; job disabled không kết nối ngoài.
- sourcetable 1508 chỉ có 6 mountpoint của listener 1508, không lẫn mountpoint
  1509.
- UI: superadmin thấy tất cả; `wally` chỉ thấy Wally; không còn tên test.
- Go logs sạch, `relayDegraded=false`; `/health` OK.

### Pha 5 — Cutover và bật relay

1. Thiết bị trỏ về host mới (hoặc DNS trỏ sang) port 1509/1508.
2. Theo dõi sourcetable + log đăng nhập; xác nhận đủ trạm online.
3. Bật relay theo nhóm (ưu tiên job nội bộ trước), theo dõi CRC/backoff.
4. Chỉ bật job đích hệ thống cũ sau khi xác nhận không còn phụ thuộc.

## 6. Tiêu chí nghiệm thu

- Không còn dữ liệu test; chỉ Wally + superadmin + 1508/1509.
- Đủ 36 trạm/35 mountpoint/67 relay theo báo cáo đối chiếu nguồn.
- Trạm V1 kết nối được với mật khẩu ngẫu nhiên như cũ; sourcetable đúng.
- Relay chạy byte-exact (mock) và không job nào trỏ nhầm sang hệ thống cũ
  ngoài danh sách đã duyệt.
- `wally` đăng nhập được, buộc đổi mật khẩu, chỉ thấy tài nguyên Wally.
- Backup + kịch bản rollback đã kiểm tra thử trên bản dump.

## 7. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Thiết bị không kết nối lại do auth | No-auth theo mountpoint legacy; thử mock trước; log 401 theo IP |
| Trùng tên mountpoint/hoa-thường | Chuẩn hoá + báo cáo dry-run, dùng unique index |
| Relay vòng (local → local) | Chặn self-loop/cycle khi import; review 5 job đích 1509 |
| Bật relay sớm gây tải ngoài | Import disabled; bật theo nhóm trong cutover |
| Mất dữ liệu khi xoá | Backup ngoài repo + transaction + rollback đã test |
| Lộ mật khẩu cũ | Chỉ mã hoá; audit redaction; không in báo cáo |

## 8. Quyết định đã chốt và điểm cần xác nhận

Đã chốt:

1. Nguồn trạm V1 có thể **không xác thực**; mountpoint vẫn bắt buộc NTRIP
   account + ACL khi đọc.
2. **Không rewrite** host relay; giữ `rtktk.online`; import disabled.
3. 5 job đích `rtktk.online:1509` giữ nguyên.
4. Dùng toạ độ giả định theo tên trạm (bảng §4.6), sẽ thay bằng 1005/1006.
5. Xoá audit/history/alerts test sau backup.
6. `stations.host = rtktk.online`, port theo CSV.
7. `wally` / `12345678`, `must_change_password = 0`.

Cần xác nhận khi duyệt:

1. Duyệt bảng toạ độ §4.6 (hoặc sửa các dòng sai).
2. CSV có **6 mountpoint trên 1508** (BG.TP, TNN_DaiTu, TNN_PhoYen,
   TNN_TpThaiNguyen, TNN_VoNhai, YBI_XuanAI) trong khi mô tả là “5 trạm”.
   Xác nhận giữ đủ 6 mountpoint này trên 1508.
3. Có cần thêm account NTRIP nào khác ngoài 3 account `nguyen`, `admin`,
   `aitogy123` cho rover/đối tác đang dùng hệ thống cũ không?

## 9. Tiến độ thực hiện

### Bước 0 — Backup & baseline (2026-11-03)

- Backup `cors_admin` 3.672.151 bytes + `cors_runtime` 22.488.953 bytes tại
  `%TEMP%\opencode\db-backup\admin_20261103_222345.sql`,
  `runtime_20261103_222345.sql` (ngoài repo).
- Baseline: 3 company/6 user/8 trạm/9 mountpoint/13 relay/7 account/5 listener.
- Nguồn: 36 trạm, 35 mountpoint/36 mapping, 67 relay, 3 account.

### Bước 1 — Caster nguồn không xác thực + UI

- Go: `MountpointConfig.SourceNoAuth`; store đọc
  `station_sources.caster_requires_auth`; `handleSource` bỏ qua Basic khi
  no-auth; `isInvalidLocked` cho phép publish không account nhưng vẫn chặn đọc.
- Test Go: publish no-auth/random Basic → 200; đọc không account → 401;
  mountpoint yêu cầu auth vẫn 401 khi publish không account.
- UI trạm: `Caster version` thêm `v1 (nguồn không xác thực)`; bỏ select
  "Yêu cầu xác thực" trùng lặp; hint cảnh báo.
- Gate: Go build/vet/test PASS; server/frontend tsc PASS; frontend build PASS;
  Playwright `station-source` PASS; gnss rebuild healthy, `/health` OK.
