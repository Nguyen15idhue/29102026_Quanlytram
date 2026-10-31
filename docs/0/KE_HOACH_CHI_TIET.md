# KẾ HOẠCH CHI TIẾT (v2)
## Hệ thống quản lý trạm CORS / NTRIP / RTCM (MVP)

> **Phiên bản 2** — cập nhật sau review kỹ thuật. Thay thế các điểm mâu thuẫn của v1.
> Tài liệu thực thi: `docs/0/CAC_BUOC_THUC_HIEN.md`.
>
> **Bảo mật:** Không ghi credential thật vào tài liệu, mã nguồn, log hay git. Chỉ dùng `.env.local` (gitignore) hoặc secret manager.

---

## 1. Bối cảnh & mục tiêu

Xây dựng MVP hệ thống quản lý trạm CORS/NTRIP/RTCM chạy thực tế:

- Quản lý trạm GNSS, mountpoint, tài khoản NTRIP, tài khoản web.
- Relay bridge là **menu riêng**, không gắn vào từng trạm.
- Giám sát trạng thái/kết nối/lưu lượng theo thời gian thực.
- UI quản trị tối giản, không gradient, không “phong cách AI”.
- Có kiểm thử, log, tài liệu vận hành.

**Thứ tự ưu tiên:** chạy end-to-end → bảo toàn dữ liệu kết nối relay cũ → tương thích NTRIP/RTCM trong phạm vi đã kiểm thử → realtime → mở rộng (1005/VRS).

**Nguyên tắc xuyên suốt:**
1. **Mock-first**: mọi tính năng NTRIP/RTCM phải đạt test với mock trước khi chạm dịch vụ thật.
2. **Không chuyển đổi production** trong giai đoạn đầu; relay cũ chỉ đọc.
3. **Bằng chứng test** quan trọng hơn “màn hình đã có”.
4. **MVP nhỏ**: mỗi phase có tiêu chí hoàn thành riêng, không gộp.

---

## 2. Quyết định đã chốt

| # | Quyết định | Hệ quả |
|---|---|---|
| D1 | Không đụng `relayrtcm\backup` | Chỉ đọc; không ghi/copy secret; không dừng relay cũ |
| D2 | Port relay vào codebase mới, bỏ binary cũ | Có giai đoạn chuyển đổi, không chạy song song lâu dài |
| D3 | Bỏ history SQLite, chỉ giữ dữ liệu kết nối `config.json` | Không import lịch sử |
| D4 | Relay là menu/thực thể riêng | `relay_jobs` độc lập, không FK `stations` |
| D5 | Chỉ MySQL | Không SQLite; hai schema, hai chủ sở hữu |
| D6 | Go ghi MySQL trực tiếp | Go sở hữu runtime; Node sở hữu quản trị |
| D7 | Caster ở Phase 4 | Phase 2 chỉ relay bridge + mock |
| D8 | **Test NTRIP/RTCM bằng mock trước** | Không chọn mountpoint công cộng ngẫu nhiên |
| D9 | **Test thật chỉ với endpoint được phép** | 1 upstream + 1 downstream đã xác nhận quyền; cleanup rõ |
| D10 | CLI/seed có allowlist | Không bật hàng loạt, mặc định disabled |
| D11 | Import 2–3 job giai đoạn đầu | Tránh ảnh hưởng production |
| D12 | Credential không commit/log/trả API | `.env.local`, mã hóa at-rest, redaction |
| D13 | **Múi giờ vận hành/hiển thị: `Asia/Ho_Chi_Minh` (+07:00)**; **lưu trữ UTC/epoch** | MySQL `+00:00`; UI/log +07; bucket nêu rõ múi giờ |
| D14 | RBAC: role + permission + scope | Mặc định `super_admin`, `admin`, `user`; tạo role mới |
| D15 | Tách tài khoản web và NTRIP | Hai bảng, hai luồng xác thực |
| D16 | **Auth web: server-side session + CSRF** | Không JWT cho MVP; thu hồi session được |
| D17 | **Schema ownership Model A** | Node/CI migrate cả 2 schema với 2 version riêng; Go chỉ đọc config, ghi runtime |
| D18 | **Station ≠ Mountpoint** | Bỏ `stations.mountpoint`; mountpoint 0..n, có thể chưa gắn trạm |
| D19 | **Soft-delete relay job** | `deleted_at`; giữ history theo retention |
| D20 | **Reconcile có revision** | `desired_revision`/`applied_revision`; Node phân biệt “đã lưu” và “đã áp dụng” |
| D21 | **Internal API chống replay** | HMAC + timestamp + nonce + body hash |
| D22 | **Audit redaction** | Không ghi secret/password/token/DSN vào audit |
| D23 | **Không dùng room role cho dữ liệu nhạy cảm** | Room theo tài nguyên sau khi kiểm tra quyền |
| D24 | **Go restart phải có test** | Job enabled tự chạy lại; session cũ đóng đúng |
| D25 | **Dùng `github.com/go-gnss/rtcm` (Apache-2.0) để parse RTCM3** | Chỉ parse/đọc; không serialize/sửa byte; xác minh license trước phân phối |
| D26 | **Chất lượng dùng chung theo `target_type` + `target_id` + `direction`** | Áp dụng cho `station` (ingest) và `relay_job` (upstream/downstream); không FK giữa relay và station |
| D27 | **Realtime quality: Go RAM → Node pull → Socket.IO** | Node không nằm trên đường byte; snapshot 1 s |
| D28 | **Chỉ lưu aggregate/sample, không lưu raw RTCM/payload** | Giảm dung lượng, tránh lộ dữ liệu; retention rõ |
| D29 | **Điểm chất lượng minh bạch, ngưỡng cấu hình được** | Không auto-disable job/probe; chỉ cảnh báo |
| D30 | **Cảnh báo có debounce** | Không báo lặp mỗi giây; có first_seen/last_seen/resolved_at |
| D31 | **Trạm thường: caster ingest; nếu ngoài hệ thống thì station probe GET-only** | Probe mặc định disabled; mock-first; không tạo downstream |
| D32 | **Relay có chỉ số parity upstream↔downstream** | Phát hiện relay suy giảm; vẫn giữ điểm upstream/downstream riêng |
| D33 | **Phase 3.5 UI/UX Foundation trước Phase 4** | Sửa shell/modal/table/pagination cho màn hình hiện có; Phase 4/5/6 tái sử dụng |
| D34 | **Shell cố định: sidebar + topbar; chỉ content cuộn** | Không cuộn menu cùng nội dung; mobile dùng drawer |
| D35 | **CRUD dùng Dialog/Drawer; không form inline trong bảng** | Create/Edit dialog; View drawer; Delete AlertDialog |
| D36 | **Phân trang server-side + search/filter + URL state** | Không `pageSize=100`; mặc định 20, page size 10/20/50 |
| D37 | **Icon `lucide-react` monochrome 16–20px; không icon màu/tinted chip** | Icon chỉ để nhận diện hành động; `currentColor` |
| D38 | **Radix Dialog/AlertDialog + focus trap; bỏ `window.confirm`** | Accessible, keyboard, Esc, restore focus |
| D39 | **Hướng UI `framed-sheet` + IBM Plex Sans/Mono self-host** | Một accent; không gradient/glass/shadow ở trạng thái nghỉ |
| D40 | **Dark mode `system/light/dark` + token, không hardcode light** | Toggle topbar; `color-scheme`; chống FOUC; test contrast cả 2 theme |
| D41 | **Caster listener mặc định 1509** | Áp dụng cho source và rover; tùy chỉnh theo listener; không dùng 2101/8081 |
| D42 | **Nhóm mountpoint ↔ listener many-to-many** | Một mountpoint có thể nghe trên nhiều port; ví dụ A,B,C→1509 và A,C→1508 |
| D43 | **Real endpoint chỉ dùng allowlist, credential ngoài repo** | Mock-first; chỉ endpoint được duyệt; không log/commit secret |
| D44 | **Phase 7–12 học từ CGBAS theo nhóm chức năng** | 7 dữ liệu trạm/IA → 8 vận hành/map → 9 notification → 10 quản trị hệ thống → 11 báo cáo/export → 12 hardening; không copy lỗ hổng CGBAS (password plaintext, i18n lệch menu/route, bundle không menu) |
| D45 *(đã chốt 2026-10-30: phương án (a))* | **Chart lib: tự vẽ SVG/light component (zero-dep)** — không thêm dependency; `recharts`/lib tương tự chỉ cân nhắc khi phát hiện nhu cầu chart phức tạp (tooltip/zoom/legend) | Áp cho P6-05 và P11-03 |
| D46 *(đã chốt 2026-10-30: phương án (a))* | **Map lib: Leaflet + tile OSM công cộng**; attribution bắt buộc; KHÔNG key dịch vụ thương mại (tianditu/googleMaps); tile self-host chỉ cân nhắc sau nếu tải cao | 'Station map overview + rover' tách Phase 8 (P8-01) |
| D47 *(đã chốt 2026-10-30: ĐÓNG)* | **i18n VN/EN + resource bundle: postpone**; chỉ mở lại khi có yêu cầu khách hàng tiếng Anh | Không nằm trong Phase 7–12; reopen bằng quyết định mới |
| D48 | **Export mặc định `.xlsx` qua `exceljs`** (D50) | CSV UTF-8 BOM chỉ dùng khi có yêu cầu riêng; giới hạn dòng + audit mỗi lần export |
| D49 | **Alert phân loại/mức theo mô hình CGBAS**: `event_type` × `level` (critical/major/minor/info) | Mở rộng bảng `alerts` ở Phase 10 sau khi P6-04 gán type/level |
| D50 | **Excel `.xlsx` dùng `exceljs`** | Import/export mọi list; template + preview + lỗi theo dòng; không export password/secret |
| D51 | **Bản đồ online chỉ marker tài khoản NTRIP có toạ độ** | Tài khoản không gửi toạ độ chỉ hiện tổng “x tài khoản không gửi tọa độ”; thêm menu **Danh sách online** |
| D52 | **Import người dùng không có cột password** | Hệ thống tạo mật khẩu mặc định `123456`, ghi audit, không export password |
| D53 | **Caster listener CRUD + tab live/force disconnect** | Listener vẫn là cấu hình; live connections chỉ đọc/force disconnect |

---

## 3. Hiện trạng

### 3.1. Workspace

```
29102026_Quanlytram/
  docs/0/XÂY DỰNG HỆ THỐNG QUẢN LÝ TRẠM CORS.docx
  docs/0/KE_HOACH_CHI_TIET.md
  docs/0/CAC_BUOC_THUC_HIEN.md
  .opencode/plugins/graphify.js
```

Chưa có mã nguồn ứng dụng.

### 3.2. Relay cũ — kết quả khảo sát

**Bản chất:** NTRIP **bridge một chiều**, không phải caster:
```
Caster nguồn --GET (rover)--> relay --POST (source)--> Caster đích
```
Bằng chứng: `main.go:680-728`, `main.go:816-846`.

| Hạng mục | Hiện trạng | Bằng chứng |
|---|---|---|
| Go 1.24.5, module `relayrtcm` | Có | `go.mod` |
| Deps | `x/net` (SOCKS5), `modernc.org/sqlite` | `go.mod` |
| NTRIP client GET / source POST | Có | `main.go:690`, `724` |
| Basic auth, `ICY 200`, chunked | Có | `main.go:1071`, `1163`, `1080-1160` |
| SOCKS5 proxy, TLS | Có | `main.go:872-960`, `961-1035` |
| NMEA GGA/GSA/RMC + jitter | Có | `main.go:756-793`, `1516-1618` |
| Config hot-reload 5s, backoff | Có | `main.go:296-300`, `348-475`, `535-673` |
| Đếm byte | Có | `main.go:843` |
| History SQLite | Có | `history.go:82-172` |
| Monitor + Basic Auth cổng **8081** | Có | `main.go:31`, `1626-1650` |
| RTCM framing/CRC | **Không** | không có `0xD3`/`crc24` |
| Caster / multi-client / ACL | **Không** | không có listener NTRIP |
| MySQL | **Không** | dùng SQLite |

**Dữ liệu:** `config.json` bản 2026-10-31 có **67 job (66 bật)**, phần lớn mountpoint CORS Việt Nam + 2 quốc tế; hiện không bật SSL/proxy.

**Test sẵn có:** `chunked_test.go`, `history_test.go`.

### 3.3. Môi trường dev

| Thành phần | Trạng thái |
|---|---|
| Node / npm | v22.16.0 / 10.9.2 |
| Go | Đã cài |
| Docker/Compose | Đã cài, daemon đang tắt |
| MySQL | Chưa cài (dùng container) |
| Cổng 3306/3307/1509/2101/4000/5173/7080/8081 | Trống |
| graphify / design-taste-frontend | Đã cài global |

---

## 4. Kiến trúc tổng thể

```
Browser (React/Vite/TS)
   │ REST + Socket.IO (session cookie)
   ▼
Node/Express (quản trị, auth, CRUD)
   │  MySQL cors_admin (RW)
   │  HTTP nội bộ (HMAC + nonce)
   ▼
Go GNSS service
   │  MySQL cors_runtime (RW)
   ├─ Relay Bridge (Phase 2)
   ├─ NTRIP Caster (Phase 4)
   ├─ RTCM monitor (parse-only)
   └─ RTCM Analyzer (Phase 6, go-rtcm parse-only)
```

### 4.1. Ranh giới trách nhiệm

- Node **không** nằm trên đường byte RTCM.
- Node ghi `cors_admin`; Go ghi `cors_runtime`.
- Go **chỉ đọc** cấu hình (`relay_jobs`, `relay_credentials`, `stations`, `mountpoints`, `ntrip_accounts`).
- Go **không** sửa cấu hình; Node **không** ghi trạng thái runtime.
- Trạng thái chạy của job nằm ở `cors_runtime.relay_job_state`.
- Live metrics nằm RAM của Go; Node lấy snapshot qua internal API.
- RTCM Analyzer (Phase 6) chỉ parse/đo chất lượng; không sửa byte, không chặn relay/caster.
- Chất lượng dùng chung cho `station` (ingest) và `relay_job` (upstream/downstream);
  không FK giữa relay và station.
- Trạm thường lấy từ caster ingest hoặc station probe GET-only; relay lấy từ bridge.
- Node không nằm trên đường byte; realtime quality đi qua pull internal API + Socket.IO.

### 4.2. Cổng

| Thành phần | Port | Ghi chú |
|---|---|---|
| Frontend dev/prod | 5173 / 3000 | |
| Node API + Socket.IO | 4000 | |
| Go internal HTTP | 7080 | bind loopback/docker network |
| NTRIP caster | 1509 | Phase 4; tùy chỉnh theo listener |
| MySQL | 3307→3306 | không public |
| Relay cũ | 8081 | không đụng |

### 4.3. Cấu trúc thư mục

```
AGENTS.md  TASKS.md  SESSION.md  README.md  .env.example  .gitignore
docker-compose.yml
docs/0/  docs/architecture.md  docs/relay-parity.md  docs/test-plan.md
docs/0/RTCM_QUALITY_PLAN.md  (Phase 6)
docs/0/UI_UX_PLAN.md         (Phase 3.5)
frontend/        React + Vite + TS
server/          Node + Express + TS + Socket.IO
gnss/            Go: caster + bridge + monitor + analyzer
db/migrations/   admin/ + runtime/ (hai tập, hai version)
scripts/         ntrip-probe, seed-relay, mock-caster, fixtures
graphify-out/    (gitignore)
```

---

## 5. MySQL: ownership, quyền, thời gian

### 5.1. Mô hình A (chốt)

- Node/CI chạy **cả hai** tập migration.
- Hai version riêng: `schema_migrations(scope ENUM('admin','runtime'), version)`.
- `cors_admin` do Node sở hữu logic; `cors_runtime` do Go sở hữu logic.
- Go kiểm tra version `runtime` lúc khởi động; thiếu → fail-fast.
- Go không tự thay đổi schema.

### 5.2. Quyền DB

| Schema | `cors_app` (Node) | `cors_relay` (Go) |
|---|---|---|
| `cors_admin` | RW | RO các bảng cấu hình cần đọc |
| `cors_runtime` | RO | RW |

Không dùng root. Không public MySQL ra ngoài Docker network.

### 5.3. Thời gian (chốt lại)

- **Lưu trữ:** `DATETIME(3)` theo **UTC** cho mọi bảng; hoặc `BIGINT` epoch-ms UTC nếu cần so sánh nhanh.
- **Hiển thị/log:** `Asia/Ho_Chi_Minh` (+07:00) — TP. Hồ Chí Minh, Việt Nam.
- MySQL `default-time-zone=+00:00`; Node/Go `TZ=Asia/Ho_Chi_Minh` chỉ cho hiển thị/log.
- **Bucket thống kê:** tính theo **UTC hour** trong DB; UI quy đổi +07. Ghi rõ `hour_start_utc`.
- Test ranh giới ngày/giờ: 00:00 và 23:59 theo +07 khi dữ liệu lưu UTC.
- Không trộn `DATETIME` local và epoch-ms trong cùng một loại dữ liệu.

### 5.4. Khi DB mất kết nối

- Relay tiếp tục chạy với cấu hình đã áp dụng gần nhất.
- Event buffer giới hạn (ví dụ 10.000 event/30 s); đầy thì **drop oldest**, tăng counter, log warning.
- Không chặn vòng đọc RTCM.
- Reconnect có backoff; khi DB trở lại, flush buffer có giới hạn.
- Nếu cần đọc credential/config mà DB không sẵn sàng: dùng bản cache trong RAM; không khởi động job mới cho đến khi đọc được.
- Có test thực tế cho tình huống DB down/up.

---

## 6. Mô hình dữ liệu

```sql
schema_migrations(scope ENUM('admin','runtime'), version, applied_at, PRIMARY KEY(scope,version))

-- RBAC
roles(id, code UNIQUE, name, level INT, is_system, description, created_at, updated_at)
permissions(id, code UNIQUE, module, action, description)
role_permissions(role_id, permission_id,
                 scope ENUM('all','subtree','own','none'),
                 UNIQUE(role_id, permission_id))

web_users(
  id, username UNIQUE, password_hash, display_name, email,
  role_id FK, parent_user_id FK NULL,
  status ENUM('active','locked','disabled'),
  created_by, created_at, updated_at, last_login_at
)
web_sessions(id, web_user_id, token_hash, csrf_token, ip, user_agent, expires_at, created_at)

-- Trạm & mountpoint (chuẩn hóa)
stations(
  id, code UNIQUE, name, host, port, connection_type,
  lat, lon, notes,
  owner_web_user_id FK, created_by, created_at, updated_at
)
mountpoints(
  id, name UNIQUE, station_id FK NULL,
  enabled, requires_auth,
  owner_web_user_id FK, created_by, created_at, updated_at
)
station_probes(
  id, station_id FK, mountpoint_id FK NULL,
  enabled, probe_interval_sec, credential_id NULL,
  owner_web_user_id FK, created_by, created_at, updated_at
)

-- Relay
relay_credentials(
  id, name, username, password_enc,
  owner_web_user_id FK, created_by, created_at, updated_at
)
relay_jobs(
  id, external_key UNIQUE, name, enabled,
  upstream_host, upstream_port, upstream_mount, upstream_credential_id,
  upstream_proxy, upstream_ssl, upstream_ntrip_version,
  downstream_host, downstream_port, downstream_mount, downstream_credential_id,
  downstream_proxy, downstream_ssl, downstream_ntrip_version, downstream_mode,
  lat, lon, ua_prefix, nmea_interval_sec,
  origin ENUM('manual','import','discover'), origin_ref, tags JSON,
  desired_revision BIGINT NOT NULL DEFAULT 0,
  owner_web_user_id FK, created_by,
  imported_at, source_sha256,
  deleted_at NULL, created_at, updated_at
)

-- Runtime (Go)
relay_job_state(
  relay_job_id PK, runtime_state ENUM('disabled','pending','connecting','streaming','backoff','error','stopped'),
  applied_revision BIGINT, last_error TEXT, last_applied_at, updated_at
)
relay_sessions(id, relay_job_id, start_ts, end_ts, duration_sec, result, close_reason, message)
relay_events(id, relay_job_id, ts, type, message, duration_sec)
relay_hourly(relay_job_id, hour_start_utc, online_sec, sessions, errors, timeouts,
             auth_errors, proxy_errors, nmea_errors, retries)

-- RTCM quality (Phase 6; Go ghi runtime, Node đọc)
-- target_type='station' (direction='ingest') hoặc 'relay_job' (upstream/downstream)
rtcm_message_stats(
  target_type ENUM('station','relay_job'), target_id BIGINT,
  mountpoint_id BIGINT NOT NULL DEFAULT 0,
  direction ENUM('ingest','upstream','downstream'),
  hour_start_utc DATETIME(3), message_type INT,
  count BIGINT, bytes BIGINT, last_seen_at DATETIME(3),
  PRIMARY KEY(target_type, target_id, mountpoint_id, direction, hour_start_utc, message_type)
)
quality_samples(
  id, target_type, target_id, mountpoint_id BIGINT NOT NULL DEFAULT 0,
  direction, ts DATETIME(3), window_sec INT,
  score TINYINT, state VARCHAR(32),
  frames BIGINT, bytes BIGINT, crc_errors BIGINT, parse_errors BIGINT,
  unknown_messages BIGINT, msm_epochs BIGINT,
  satellites INT, signals INT, cells INT, avg_cnr DECIMAL(5,2),
  reported_station_id INT NULL, arp_x BIGINT NULL, arp_y BIGINT NULL, arp_z BIGINT NULL,
  arp_delta_m DECIMAL(8,3) NULL, antenna VARCHAR(64) NULL,
  age_ms INT, gaps INT, cnr_available TINYINT(1), details JSON NULL,
  KEY(target_type, target_id, mountpoint_id, direction, ts)
)
quality_alerts(
  id, target_type, target_id, mountpoint_id BIGINT NOT NULL DEFAULT 0,
  direction, code VARCHAR(64),
  severity ENUM('info','warning','critical'),
  first_seen DATETIME(3), last_seen DATETIME(3), resolved_at DATETIME(3) NULL,
  details JSON NULL, KEY(target_type, target_id, mountpoint_id, last_seen)
)

-- NTRIP account (khác web account)
ntrip_accounts(
  id, username UNIQUE, password_hash, enabled, max_connections,
  owner_web_user_id FK, created_by, created_at, updated_at
)
account_mountpoint_acl(account_id, mountpoint_id)
caster_listeners(
  id, name, port UNIQUE, enabled, role ENUM('both','source','rover'),
  description, created_by, created_at, updated_at
)
caster_listener_mountpoints(listener_id, mountpoint_id,
  PRIMARY KEY(listener_id, mountpoint_id))
connections(id, listener_id, mountpoint_id, account_id, remote_addr, user_agent,
            start_ts, end_ts, bytes_sent, bytes_received, disconnect_reason)

-- Khác
alerts(id, severity, source_type, source_id, message, created_at, acknowledged_at)
audit_logs(id, actor_web_user_id, action, entity_type, entity_id,
           before_redacted JSON, after_redacted JSON, ip, created_at)
quality_alert_acks(alert_id, web_user_id, acked_at, note, PRIMARY KEY(alert_id, web_user_id))
internal_nonces(nonce PK, expires_at)
settings(key, value_json, updated_at)
```

**Ghi chú**
- `stations.mountpoint` **đã bỏ**. Một trạm có 0..n mountpoint; mountpoint có thể chưa gắn trạm.
- `owner_web_user_id` là chủ sở hữu hiện tại; `created_by` chỉ để audit. Hai trường khác nghĩa.
- `relay_jobs` chỉ chứa cấu hình; trạng thái chạy ở `relay_job_state`.
- `relay_sessions.close_reason`: `config_changed`, `disabled`, `deleted`, `service_restart`, `auth_failed`, `timeout`, `network`, `manual`.
- `audit_logs` chỉ lưu JSON đã **redact**.
- `internal_nonces` dùng chống replay; có thể kết hợp in-memory + DB.
- `quality_samples`/`rtcm_message_stats`/`quality_alerts` (Phase 6) dùng chung cho
  `station` và `relay_job`; chỉ lưu aggregate/sample, không raw RTCM/payload.
- `mountpoint_id` dùng cho chất lượng theo mountpoint của trạm; relay dùng `0`.
- `station_probes` mặc định disabled; chỉ GET, không tạo downstream;
  `credential_id` tham chiếu credential mã hóa hiện có, không log/không trả API.
- `caster_listeners.port` mặc định seed 1509; mỗi listener gắn 0..n mountpoint;
  một mountpoint có thể nằm trên nhiều listener.
- `quality_alert_acks` ở admin để Node ghi ack; không FK xuyên schema.

---

## 7. Thiết kế chức năng

### 7.1. Trạm & mountpoint

- Trạm: thực thể vật lý (mã, tên, host/port nguồn, toạ độ, trạng thái cấu hình).
- Mountpoint: endpoint dữ liệu do caster phục vụ; `station_id` nullable.
- Không lặp `mountpoint` trong `stations`.
- Một trạm có thể có nhiều mountpoint; mountpoint có thể tồn tại độc lập.
- Relay job **không** FK trạm; chỉ có thể gắn nhãn nhóm.

### 7.2. Relay job lifecycle

- `enabled`: ý định của admin.
- `desired_revision`: tăng mỗi lần sửa cấu hình.
- `runtime_state` + `applied_revision` + `last_error`: do Go ghi vào `relay_job_state`.
- Node hiển thị cả “đã lưu” và “đã áp dụng”.
- Sửa cấu hình: transaction → tăng revision → gọi `POST /internal/reconcile`.
- Node không coi “lưu thành công” là “relay đang chạy”.
- Xóa: soft-delete (`deleted_at`); Go dừng job, đóng session với `close_reason='deleted'`; history giữ theo retention.
- Reconcile idempotent: Go đọc revision, áp dụng, ghi kết quả; Node retry nếu Go tạm down.

### 7.3. Tài khoản web & RBAC

**Role mặc định**
| Role | Level | Quyền |
|---|---:|---|
| `super_admin` | 100 | Toàn quyền, scope `all` |
| `admin` | 50 | Trong subtree; không quản lý `super_admin`; không sửa role hệ thống |
| `user` | 10 | Chỉ tài khoản của mình; không add/delete |

**Scope**
- `all`: mọi bản ghi.
- `subtree`: bản ghi có `owner_web_user_id` thuộc bản thân + toàn bộ cấp dưới (`parent_user_id`).
- `own`: `owner_web_user_id = actor`.
- `none`: mặc định.

Áp dụng cho: `web_users`, `stations`, `mountpoints`, `relay_jobs`, `relay_credentials`, `ntrip_accounts`, `connections` (qua mountpoint/station), `quality` (theo owner station/relay), `audit` (theo actor).

**Quy tắc chống nâng quyền**
- Không tạo/sửa user có level ≥ level của mình (trừ `super_admin`).
- Không gán role có level cao hơn mình.
- Không sửa/xóa/khóa `super_admin`.
- Không xóa `super_admin` cuối cùng; không tự khóa mình.
- `user` tự sửa chỉ được allowlist: `display_name`, `email`, `password`; **không** `role_id`, `status`, `parent_user_id`, `owner_web_user_id`.
- Kiểm tra scope bằng query filter ở server, không chỉ ẩn UI.
- Test phải kiểm tra **dữ liệu trả về** không chứa bản ghi ngoài scope, không chỉ status 403.

### 7.4. Tài khoản NTRIP (khác web account)

| Tiêu chí | Web account | NTRIP account |
|---|---|---|
| Mục đích | Đăng nhập UI | Xác thực Basic ở caster |
| Bảng | `web_users` | `ntrip_accounts` |
| Mật khẩu | Argon2id | Argon2id |
| Phiên | Session cookie + CSRF | Không session |
| Quyền | role + permission + scope | ACL mountpoint + max_connections |

Quản lý NTRIP account theo RBAC `ntrip_accounts.*` + scope; có `owner_web_user_id`.

### 7.5. Caster (Phase 4)

- Listener mặc định **1509** cho source và rover; tùy chỉnh theo listener.
- Nhóm mountpoint ↔ listener many-to-many: một mountpoint có thể nghe trên
  nhiều port (ví dụ A,B,C→1509; A,C→1508).
- NTRIP v1 legacy, v1 auth, v2.
- Source uplink + rover client; multi-client/mountpoint.
- Queue giới hạn; **drop slow client**; không để một client làm nghẽn.
- ACL + max connections.
- RTCM passthrough; monitor parse-only; buffer giới hạn, resync khi mất đồng bộ, không chặn vòng relay.
- Test mock trước; chỉ mở cổng thật khi mock đạt.
- Integration thật chỉ endpoint allowlist Q10; credential ngoài repo; 1 upstream +
  1 downstream; cleanup sau test.

### 7.6. Realtime & phân quyền

- Socket.IO xác thực bằng **session cookie** hợp lệ (không token trong URL).
- Room: `user:<id>`; room tài nguyên (`relay:<id>`, `station:<id>`) **chỉ sau khi kiểm tra quyền**.
- Room theo role chỉ dùng cho thông báo chung, **không** chứa dữ liệu nhạy cảm.
- Payload lọc theo quyền + scope của người nhận.
- Khi role/ownership thay đổi: cập nhật/ngắt kết nối realtime đang mở.
- Không phát credential/password/token/cấu hình bí mật.
- Test: user không có quyền cố join room → bị từ chối; sau khi đổi quyền, dữ liệu cũ không còn lộ.

### 7.7. Discover, import & bulk

- Discover sourcetable trước; chỉ tạo job disabled.
- Import `config.json`: chạy trên **Windows host** hoặc mount **read-only** đúng lúc import; không mount vào app container.
- `--dry-run`, `--ids`, `--force`; idempotent; log không secret.
- Bulk create/delete theo `origin_ref`/tag; audit.
- Không tự tạo mountpoint trên caster công cộng; chỉ dùng endpoint được phép.

### 7.8. History, retention, audit

- Job xóa mềm; history giữ theo retention (events 30d, sessions 90d, connections 30d).
- Prune theo batch; không xóa session đang mở.
- Audit redaction trước khi ghi; không lưu secret dù đã mã hóa nếu không cần.
- Audit là append-only ở tầng ứng dụng; tài khoản app không có quyền xóa audit.
- Lỗi audit không được chặn vòng RTCM.

### 7.9. RTCM Analytics & chất lượng trạm/relay (Phase 6)

- Dùng `github.com/go-gnss/rtcm` (`rtcm3`) để parse RTCM3; **chỉ đọc**.
- Phân tích song song, queue giới hạn; đầy thì drop sample, không chặn relay/caster.
- Đối tượng chất lượng dùng chung:
  - `station` + `direction='ingest'`: trạm thường, lấy từ caster ingest hoặc
    station probe GET-only (mặc định disabled).
  - `relay_job` + `direction='upstream'|'downstream'`: trạm relay.
- Chỉ số: transport, CRC/parse errors, message type/rate, MSM epoch/sat/signal/cell,
  CNR, metadata 1005/1006/1007/1008/1033, station ID, ARP jump, age/gap.
- Relay có thêm `parity` so sánh upstream/downstream; job score = min(upstream, downstream).
- Điểm 0–100 minh bạch, ngưỡng cấu hình; không auto-disable job/probe.
- Cảnh báo có debounce; ack lưu admin, có audit.
- Realtime: Go RAM (1 s) → Node pull `/internal/rtcm/snapshot` → Socket.IO → FE.
- DB: sample 60 s (30 ngày), aggregate giờ (90 ngày), alert 90 ngày; không raw payload.
- Chi tiết: `docs/0/RTCM_QUALITY_PLAN.md`.

### 7.10. UI/UX app shell & CRUD patterns (Phase 3.5)

- Hướng: **framed-sheet** (light), chrome tinted L-frame, content white sheet;
  một accent; không gradient/glass/shadow ở trạng thái nghỉ.
- Shell: sidebar 228px + topbar 48px cố định; chỉ content cuộn; mobile drawer.
- CRUD: create/edit trong Dialog (mobile full-screen Drawer); view trong Drawer;
  delete/disable trong AlertDialog; **không form inline trong bảng**.
- Bảng: server pagination 20 (10/20/50), search debounce 300ms, filter, URL state;
  sticky header; số căn phải; không zebra; row action menu.
- Icon: `lucide-react` 16–20px, stroke 1.5, `currentColor`; không icon màu,
  không icon trong ô tinted.
- Form: label/help/error; submit disabled khi lưu; dirty guard; toast success/error.
- A11y: focus trap, Esc, restore focus, aria-label, contrast AA, reduced-motion.
- Type: IBM Plex Sans (400/500/600) + IBM Plex Mono cho ID/key/số bảng; self-host.
- Dark mode: `system` mặc định, toggle `light/dark`; token dark near-black,
  `color-scheme`, chống FOUC; mọi component đọc token, không hardcode light.
- Phase 3.5 làm trước Phase 4; Phase 4/5/6 dùng lại foundation, không làm lại shell.
- Chi tiết: `docs/0/UI_UX_PLAN.md`.

### 7.11. Hoàn thiện theo CGBAS (Phase 7–12 — khảo sát 2026-10-30)

- Menu chốt:
  - **Dashboard**
  - **Trạm**: Bản đồ trạm, Danh sách trạm.
  - **CORS**: Bản đồ online, Danh sách online, Tài khoản NTRIP, Mountpoint, Caster.
  - **Relay**
  - **Hệ thống**: Phân quyền, Người dùng, Lịch sử, Cảnh báo.
  - **Ẩn menu**: Trang cá nhân mở bằng avatar/tên người dùng.
- Quyết định mới:
  - D50: Excel `.xlsx` dùng `exceljs`; template/preview/lỗi theo dòng; audit.
  - D51: Bản đồ online chỉ marker tài khoản có toạ độ; hiện tổng số tài khoản
    không gửi tọa độ; thêm menu **Danh sách online**.
  - D52: Import người dùng không có cột password; mật khẩu mặc định `123456`;
    không export password.
  - D53: Caster listener CRUD + tab live/force disconnect.
- Drawer chi tiết trạm 1080px; metric thiếu dữ liệu disabled; Sky Plot thật/
  cycle slip/RMS/latency/neighboring stations để Phase 8–9.
- Roadmap 7–12:
  - **7** Nền tảng UI & Trạm danh sách: menu, shared list/pagination 10,
    import/export `.xlsx`, hồ sơ trạm, form/list.
  - **8** Bản đồ trạm + chi tiết trạm + bản đồ online + danh sách online.
  - **9** CORS: NTRIP account, mountpoint, caster live/force disconnect.
  - **10** Relay + Hệ thống: phân quyền, người dùng, lịch sử, cảnh báo.
  - **11** Trang cá nhân, notification center, dictionary/config, báo cáo.
  - **12** Load 50–100, security, E2E, backup/restore, release.
- Giữ D45 chart SVG zero-dep; D46 Leaflet + OSM public (map Phase 8);
  D47 i18n đóng.
- Ngoài phạm vi: VRS/subnet/grid/transfer/subscribe, storage raw FTP/SFTP,
  displacement monitor, SpEL, Open API khách.
- Chi tiết trường UI: `docs/0/PHASES_7_12_PLAN.md` §8; checklist `TASKS.md`;
  bước/test `docs/0/CAC_BUOC_THUC_HIEN.md`.

---

## 8. API contract (chuẩn hóa)

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập |
| POST | `/api/auth/logout` | Đăng xuất |
| GET | `/api/auth/me` | Profile + role + permission/scope |
| GET | `/api/overview` | Dashboard |
| GET/POST | `/api/stations` | Danh sách/tạo trạm |
| GET/PATCH/DELETE | `/api/stations/:id` | Chi tiết/sửa/xóa |
| POST | `/api/stations/:id/enable` | Bật trạm |
| POST | `/api/stations/:id/disable` | Tắt trạm |
| GET/POST | `/api/mountpoints` | Danh sách/tạo |
| GET/PATCH/DELETE | `/api/mountpoints/:id` | Chi tiết/sửa/xóa |
| GET/POST | `/api/relay-jobs` | Danh sách/tạo job |
| GET/PATCH/DELETE | `/api/relay-jobs/:id` | Chi tiết/sửa/xóa mềm |
| POST | `/api/relay-jobs/:id/enable` | Yêu cầu bật |
| POST | `/api/relay-jobs/:id/disable` | Yêu cầu tắt |
| POST | `/api/relay-jobs/:id/restart` | Yêu cầu restart |
| POST | `/api/relay-jobs/:id/test` | Kiểm tra kết nối |
| GET | `/api/relay-jobs/:id/sessions` | Lịch sử phiên |
| GET | `/api/relay-jobs/:id/events` | Sự kiện |
| GET | `/api/relay-jobs/:id/metrics` | Metrics |
| GET | `/api/quality/overview` | Tổng quan chất lượng RTCM (station + relay) |
| GET | `/api/stations/:id/quality` | Chất lượng trạm thường (ingest) |
| GET | `/api/stations/:id/rtcm/messages` | Message type/rate của trạm |
| GET | `/api/relay-jobs/:id/quality` | Chất lượng upstream/downstream |
| GET | `/api/relay-jobs/:id/rtcm/messages` | Phân bố message type/rate |
| GET | `/api/quality/alerts` | Cảnh báo chất lượng (station + relay) |
| POST | `/api/quality/alerts/:id/ack` | Xác nhận cảnh báo |
| GET | `/api/quality/export` | Export CSV có giới hạn |
| GET/POST | `/api/stations/:id/probes` | Danh sách/tạo station probe GET-only |
| PATCH/DELETE | `/api/station-probes/:id` | Sửa/xóa probe |
| POST | `/api/station-probes/:id/enable` | Bật probe |
| POST | `/api/station-probes/:id/disable` | Tắt probe |
| POST | `/api/relay-jobs/discover` | Discover sourcetable |
| POST | `/api/relay-jobs/bulk` | Tạo hàng loạt |
| DELETE | `/api/relay-jobs?originRef=...` | Xóa hàng loạt |
| GET/POST | `/api/web-users` | Tài khoản web |
| GET/PATCH/DELETE | `/api/web-users/:id` | Chi tiết/sửa/xóa |
| POST | `/api/web-users/:id/lock` | Khóa |
| POST | `/api/web-users/:id/unlock` | Mở khóa |
| GET/POST | `/api/ntrip-accounts` | Tài khoản NTRIP |
| GET/PATCH/DELETE | `/api/ntrip-accounts/:id` | Chi tiết/sửa/xóa |
| POST | `/api/ntrip-accounts/:id/lock` | Khóa |
| POST | `/api/ntrip-accounts/:id/unlock` | Mở khóa |
| GET/PUT | `/api/ntrip-accounts/:id/mountpoints` | ACL placeholder mountpoint |
| GET/POST | `/api/caster/listeners` | Listener caster (mặc định 1509) |
| GET/PATCH/DELETE | `/api/caster/listeners/:id` | Chi tiết/sửa/xóa listener |
| POST | `/api/caster/listeners/:id/enable` | Bật listener |
| POST | `/api/caster/listeners/:id/disable` | Tắt listener |
| GET/PUT | `/api/caster/listeners/:id/mountpoints` | Gắn mountpoint vào listener |
| GET/POST | `/api/roles` | Role |
| GET/PATCH/DELETE | `/api/roles/:id` | Chi tiết/sửa/xóa |
| GET/PUT | `/api/roles/:id/permissions` | Ma trận quyền |
| GET | `/api/permissions` | Danh mục quyền |
| GET | `/api/connections` | Client đang kết nối |
| DELETE | `/api/connections/:id` | Ngắt client |
| GET | `/api/events` | Nhật ký |
| GET | `/api/alerts` | Cảnh báo |
| POST | `/api/alerts/:id/ack` | Xác nhận |
| GET | `/api/snapshot` | Snapshot reconnect |
| GET/PATCH | `/api/settings` | Cấu hình |

**Internal**
| Method | Endpoint | Ghi chú |
|---|---|---|
| GET | `/internal/health` | Health |
| GET | `/internal/snapshot` | Live snapshot |
| GET | `/internal/rtcm/snapshot` | Quality snapshot RAM (Phase 6) |
| GET | `/internal/rtcm/health` | Queue/drop/parse errors |
| POST | `/internal/events` | HMAC + nonce |
| POST | `/internal/reconcile` | Áp dụng revision |

**Socket.IO:** `snapshot`, `station.updated`, `relay.updated`, `relay.session`,
`connection.updated`, `alert.created`, `quality.snapshot`, `quality.updated`,
`quality.alert`, `quality.alert.ack`.

---

## 9. Bảo mật

- Auth web: **session cookie** `HttpOnly`, `Secure` khi HTTPS, `SameSite=Lax`, CSRF token; thu hồi session khi khóa/đổi mật khẩu; timeout.
- Không JWT dài hạn trong `localStorage`.
- NTRIP account: Argon2id hash.
- Relay credential: AES-256-GCM; key env; không trả API.
- RBAC server-side; deny by default; field allowlist khi tự sửa.
- Socket.IO: xác thực session; room sau kiểm tra quyền; lọc payload theo scope.
- Internal API: HMAC-SHA256 trên `method + path + timestamp + nonce + sha256(body)`; timestamp ±60 s; nonce unique (DB/in-memory); so sánh constant-time; rate limit; body size limit.
- Audit redaction; không log Authorization/password/DSN.
- Caster no-auth chỉ khi cấu hình rõ ràng + cảnh báo.
- MySQL/Go internal không public.
- Secret không nằm trong image/log.

---

## 10. Import `config.json`

### 10.1. Mapping

| Field cũ | Cột mới | Ghi chú |
|---|---|---|
| `id` | `external_key` | UNIQUE |
| `enable` | `enabled` | mặc định false |
| `src_*` | `upstream_*` + `relay_credentials` | pass mã hóa |
| `dst_*` | `downstream_*` + `relay_credentials` | pass mã hóa |
| `lat/lon` | `lat/lon` | validate |
| `nmea_interval_sec` | `nmea_interval_sec` | 0 = auto |

### 10.2. Nguyên tắc
- Chạy import trên **Windows host** hoặc mount read-only; không copy file vào repo.
- Chỉ import ID được chọn; dry-run; idempotent; transaction.
- `source_sha256` + `imported_at`.
- Không import history/binary.
- Không log secret.
- Job mới **disabled**; test mock trước khi bật.

---

## 11. Kế hoạch test

### 11.1. Tầng test

| Tầng | Nội dung |
|---|---|
| Unit Go | NTRIP request/response context, chunked, CRC24Q, fan-out, timeout, backoff, loop guard |
| Mock | mock caster + mock rover; byte-exact; mảnh read; nhiều frame/read; CRC sai; slow client |
| Parity | relay cũ (đọc-only) vs bridge mới trên cùng mock |
| Restart | Go restart khi đang stream; session cũ đóng `service_restart`; không trùng kết nối |
| DB failure | DB down/up; buffer giới hạn; không chặn RTCM |
| Reconcile | Node lưu config, Go down/up; desired vs applied; retry |
| RBAC | scope all/subtree/own; chống nâng quyền; field allowlist |
| Realtime | session auth; room theo quyền; đổi quyền khi đang mở socket |
| Internal API | HMAC sai, timestamp lệch, nonce replay, body sai |
| RTCM parser (Phase 6) | 1005/1006/1007/1008/MSM/1230; CRC/length/truncated/unknown; byte-exact |
| Quality (Phase 6) | station ingest/probe + relay upstream/downstream/parity; score, baseline, station ID, ARP jump, CNR |
| Quality realtime | Socket auth/room/throttle <2 s; scope; reconnect snapshot |
| Audit | redaction secret; append-only |
| Timezone | lưu UTC; hiển thị +07; bucket/ngày giờ |
| API/FE | vitest + supertest + Playwright; loading/empty/error; a11y |
| UI/UX (Phase 3.5) | modal/drawer CRUD, pagination, fixed shell, lucide, dark mode, keyboard; `inspect.mjs --app` 0 FAIL |

### 11.2. Test NTRIP thật (có kiểm soát)

**Bắt buộc theo thứ tự:**
1. **Mock caster/rover**: toàn bộ chức năng + tiêu chí kỹ thuật.
2. **Integration được phép**: 1 upstream đã xác nhận quyền đọc + 1 downstream đã xác nhận quyền ghi.
3. Chỉ sau khi pass mới tăng số job (theo danh sách được duyệt).

**Không làm:**
- Không chọn ngẫu nhiên mountpoint công cộng.
- Không tự tạo mountpoint `SMOKE_*` trên caster công cộng.
- Không bật hàng loạt trước khi xác nhận quyền/giới hạn.
- Không coi `HTTP 200`, `ICY 200`, `SOURCETABLE 200` là cùng nghĩa; parser phải kiểm tra ngữ cảnh request/response.

**Cleanup:** xóa job mềm → Go dừng/đóng socket → history theo retention; mountpoint test trên caster do admin caster xóa nếu cần.

### 11.3. Giới hạn chống đệ quy

- Self-loop: cùng endpoint.
- Cycle nội bộ: DFS trên đồ thị job đang bật.
- Cycle xuyên hệ thống: **không thể** phát hiện tuyệt đối nếu ngoài hệ thống; cần kiểm soát vận hành + topology thủ công.
- Key endpoint: `scheme + host + port + mount` chuẩn hóa (lowercase host, trim `/`).
- Unique index chỉ chặn trùng cặp, không thay DFS.
- Không bật job nếu không xác định được cấu hình.
- Ghi rõ giới hạn trong tài liệu và UI.

---

## 12. Rủi ro & giảm thiểu

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| R1 | Double-connect upstream | Import disabled; mock trước; tạm dừng job cũ nếu trùng |
| R2 | Lộ secret | Mã hóa; redaction; `.env.local`; audit redact |
| R3 | Hai writer MySQL | Tách schema/quyền; hai version; Go không sửa config |
| R4 | Reconcile thất bại | revision + applied; retry; UI phân biệt |
| R5 | RBAC thiếu owner | Thêm `owner_web_user_id`; test dữ liệu trả về |
| R6 | Rò realtime | Room theo quyền; lọc payload; đổi quyền cập nhật socket |
| R7 | Replay internal | HMAC + nonce + timestamp + body hash |
| R8 | Go restart mất trạng thái | Test restart; đóng session cũ; tự reconnect |
| R9 | DB down | Buffer giới hạn; không chặn RTCM; test |
| R10 | Test thật ảnh hưởng dịch vụ | Mock-first; endpoint được phép; cleanup |
| R11 | Múi giờ lệch | Lưu UTC; hiển thị +07; test ranh giới |
| R12 | Scope quá rộng | Mặc định deny; review role; audit |
| R13 | Slow client | Queue giới hạn/drop; đo p95 |
| R14 | Docker public port | Bind nội bộ; không public MySQL/Go API |
| R15 | License | Xác minh license phiên bản thực tế trước phân phối (go-rtcm Apache-2.0) |
| R16 | MVP quá rộng | Phase 0–6, tiêu chí từng phase |
| R17 | Parser RTCM chặn relay | Queue giới hạn/drop sample; test byte-exact + tải |
| R20 | UI refactor ảnh hưởng luồng đang chạy | Playwright trước/sau; làm Phase 3.5, không đổi API/DB |
| R21 | Icon/màu lòe loẹt | Lucide monochrome; accent chỉ cho primary/active; status dùng badge |
| R22 | Phase 3.5 kéo dài sang Phase 4 | Chốt foundation + gate trước khi mở màn hình mới |
| R23 | Dark mode sai contrast/FOUC | Token dark riêng; script inline; test status/focus/table/form cả 2 theme |
| R18 | Cảnh báo chất lượng nhiễu | Baseline + debounce 3 cửa sổ; ngưỡng cấu hình |
| R19 | Lộ vị trí/metadata trạm | Lọc theo scope; không raw payload; export có audit |

---

## 13. Tiêu chí nghiệm thu MVP

- `docker compose up` chạy; có bằng chứng test từng phase.
- Đăng nhập web bằng session; NTRIP account không login web và ngược lại.
- CRUD trạm/mountpoint/tài khoản web/NTRIP account; RBAC đúng scope.
- Relay mock đạt byte-exact, reconnect, timeout, slow client.
- Integration thật chỉ với endpoint được phép; cleanup sạch.
- Reconcile: Node phân biệt đã lưu/đã áp dụng; Go restart tự phục hồi.
- Realtime đúng quyền; không lộ dữ liệu ngoài scope.
- Audit không chứa secret; internal API chống replay.
- Timezone: lưu UTC, hiển thị +07 nhất quán.
- Phase 6: parse RTCM không sửa byte; chất lượng cho trạm thường (ingest/probe)
  và trạm relay (upstream/downstream/parity) realtime <2 s; cảnh báo có debounce;
  không lộ metadata ngoài scope.

---

## 14. Lộ trình phase

| Phase | Nội dung | Kết quả |
|---|---|---|
| 0 | Chuẩn bị & xác minh (đọc-only) | Tài liệu, inventory, quyết định |
| 1 | Skeleton & hợp đồng dữ liệu | Compose, schema, auth, API contract, RBAC nền |
| 2 | Port relay & test mock | Bridge parity, mock tests, chưa chạm dịch vụ thật |
| 3 | Quản trị trạm & relay ổn định | CRUD, import có kiểm soát, RBAC scope, reconcile, soft-delete |
| 3.5 | UI/UX Foundation | Shell, modal/drawer, table/pagination, icon, a11y |
| 4 | NTRIP caster & quản lý client | Mock trước, sau đó cổng thật |
| 5 | Realtime, dashboard, vận hành | Socket, history, alert, backup, load test |
| 6 | RTCM Analytics & chất lượng trạm/relay | go-rtcm parse-only, quality score, alert, FE realtime |
| 7 | Nền tảng UI & Trạm danh sách | Menu nhóm, shared list/pagination 10, import/export `.xlsx`, hồ sơ trạm, form/list |
| 8 | Bản đồ & chi tiết trạm | Bản đồ trạm, chi tiết trạm, bản đồ online, danh sách online |
| 9 | CORS | Tài khoản NTRIP, mountpoint, caster listener + live/force disconnect |
| 10 | Relay & Hệ thống | Relay, phân quyền, người dùng, lịch sử, cảnh báo |
| 11 | Cá nhân, cấu hình & báo cáo | Trang cá nhân, notification center, dictionary/config, báo cáo |
| 12 | Hardening, load test & release | Load 50–100, security, E2E, backup/restore, release |

Chi tiết: `docs/0/PHASES_7_12_PLAN.md`; bước/test:
`docs/0/CAC_BUOC_THUC_HIEN.md`; Phase 3.5: `docs/0/UI_UX_PLAN.md`;
Phase 6: `docs/0/RTCM_QUALITY_PLAN.md`.
Phase 3.5 làm trước Phase 4; Phase 4/5/6 dùng lại UI foundation.
P6-01/P6-02 có thể bắt đầu sau Phase 3; P6-03 cần Phase 4 cho caster ingest
(hoặc station probe GET-only sớm hơn); P6-04/P6-05 cần realtime Phase 5.

---

## 15. Quy ước làm việc cho AI

- Đọc `AGENTS.md`, `TASKS.md`, `SESSION.md`, `README.md` trước khi sửa.
- Mỗi task ghi rõ: phạm vi file, mục tiêu, tiêu chí nghiệm thu, lệnh kiểm tra.
- Không đọc lại toàn repo nếu không cần; không viết lại module đang hoạt động chỉ để đẹp.
- Không thêm Redis/Kafka/RabbitMQ/K8s.
- Không đổi stack đã chốt.
- Sau mỗi phase: test + diff + ghi đã làm/chưa làm/lỗi/cách chạy.
- **Graphify**: sau Phase 1; cập nhật sau thay đổi cấu trúc lớn, không chạy mỗi chỉnh nhỏ; không trỏ vào backup relay.
- **Taste Skill**: định hướng/soát UI; 0 FAIL 1440/768/390 là điều kiện cần, không đủ; vẫn phải test luồng, phân quyền, loading/empty/error, a11y.
- **Playwright**: luồng người dùng; không thay unit/integration test.
- **ESLint/Prettier/Vitest/Go test**: chuẩn code; không chứng minh production an toàn.

---

## 16. Phụ lục

### 16.1. Biến môi trường (tên)
```
NODE_ENV
TZ=Asia/Ho_Chi_Minh
APP_TIMEZONE=Asia/Ho_Chi_Minh
MYSQL_TIMEZONE=+00:00
PORT=4000
MYSQL_HOST
MYSQL_PORT
MYSQL_DATABASE
MYSQL_APP_USER
MYSQL_APP_PASSWORD
MYSQL_RUNTIME_DSN
SESSION_SECRET
APP_ENC_KEY
INTERNAL_HMAC_SECRET
GO_INTERNAL_URL
CASTER_PORT=1509
RELAY_IMPORT_PATH
RELAY_IMPORT_IDS
NTRIP_TEST_HOST
NTRIP_TEST_PORT
NTRIP_TEST_VERSION
NTRIP_TEST_USER
NTRIP_TEST_PASS
```

### 16.2. Cổng
Xem mục 4.2.

### 16.3. Tham chiếu
- Yêu cầu gốc: `docs/0/XÂY DỰNG HỆ THỐNG QUẢN LÝ TRẠM CORS.docx`
- Relay tham chiếu: `relayrtcm\backup` (chỉ đọc)
- NTRIP v1/v2; RTCM3 preamble `0xD3` + CRC24Q
- `go-gnss/rtcm`: Apache-2.0, parse-only (xác minh lại license phiên bản thực tế)
