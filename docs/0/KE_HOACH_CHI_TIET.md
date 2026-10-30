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

**Dữ liệu:** `config.json` có **65 job (64 bật)**, phần lớn mountpoint CORS Việt Nam + 2 quốc tế; hiện không bật SSL/proxy.

**Test sẵn có:** `chunked_test.go`, `history_test.go`.

### 3.3. Môi trường dev

| Thành phần | Trạng thái |
|---|---|
| Node / npm | v22.16.0 / 10.9.2 |
| Go | Đã cài |
| Docker/Compose | Đã cài, daemon đang tắt |
| MySQL | Chưa cài (dùng container) |
| Cổng 3306/3307/2101/4000/5173/7080/8081 | Trống |
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
   └─ RTCM monitor (parse-only)
```

### 4.1. Ranh giới trách nhiệm

- Node **không** nằm trên đường byte RTCM.
- Node ghi `cors_admin`; Go ghi `cors_runtime`.
- Go **chỉ đọc** cấu hình (`relay_jobs`, `relay_credentials`, `stations`, `mountpoints`, `ntrip_accounts`).
- Go **không** sửa cấu hình; Node **không** ghi trạng thái runtime.
- Trạng thái chạy của job nằm ở `cors_runtime.relay_job_state`.
- Live metrics nằm RAM của Go; Node lấy snapshot qua internal API.

### 4.2. Cổng

| Thành phần | Port | Ghi chú |
|---|---|---|
| Frontend dev/prod | 5173 / 3000 | |
| Node API + Socket.IO | 4000 | |
| Go internal HTTP | 7080 | bind loopback/docker network |
| NTRIP caster | 2101 | Phase 4 |
| MySQL | 3307→3306 | không public |
| Relay cũ | 8081 | không đụng |

### 4.3. Cấu trúc thư mục

```
AGENTS.md  TASKS.md  SESSION.md  README.md  .env.example  .gitignore
docker-compose.yml
docs/0/  docs/architecture.md  docs/relay-parity.md  docs/test-plan.md
frontend/        React + Vite + TS
server/          Node + Express + TS + Socket.IO
gnss/            Go: caster + bridge + monitor
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

-- NTRIP account (khác web account)
ntrip_accounts(
  id, username UNIQUE, password_hash, enabled, max_connections,
  owner_web_user_id FK, created_by, created_at, updated_at
)
account_mountpoint_acl(account_id, mountpoint_id)
connections(id, mountpoint_id, account_id, remote_addr, user_agent,
            start_ts, end_ts, bytes_sent, bytes_received, disconnect_reason)

-- Khác
alerts(id, severity, source_type, source_id, message, created_at, acknowledged_at)
audit_logs(id, actor_web_user_id, action, entity_type, entity_id,
           before_redacted JSON, after_redacted JSON, ip, created_at)
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

Áp dụng cho: `web_users`, `stations`, `mountpoints`, `relay_jobs`, `relay_credentials`, `ntrip_accounts`, `connections` (qua mountpoint/station), `audit` (theo actor).

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

- NTRIP v1 legacy, v1 auth, v2.
- Source uplink + rover client; multi-client/mountpoint.
- Queue giới hạn; **drop slow client**; không để một client làm nghẽn.
- ACL + max connections.
- RTCM passthrough; monitor parse-only; buffer giới hạn, resync khi mất đồng bộ, không chặn vòng relay.
- Test mock trước; chỉ mở cổng thật khi mock đạt.

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
| POST | `/internal/events` | HMAC + nonce |
| POST | `/internal/reconcile` | Áp dụng revision |

**Socket.IO:** `snapshot`, `station.updated`, `relay.updated`, `relay.session`, `connection.updated`, `alert.created`.

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
| Audit | redaction secret; append-only |
| Timezone | lưu UTC; hiển thị +07; bucket/ngày giờ |
| API/FE | vitest + supertest + Playwright; loading/empty/error; a11y |

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
| R15 | License | Xác minh license phiên bản thực tế trước phân phối |
| R16 | MVP quá rộng | Phase 0–5, tiêu chí từng phase |

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

---

## 14. Lộ trình phase

| Phase | Nội dung | Kết quả |
|---|---|---|
| 0 | Chuẩn bị & xác minh (đọc-only) | Tài liệu, inventory, quyết định |
| 1 | Skeleton & hợp đồng dữ liệu | Compose, schema, auth, API contract, RBAC nền |
| 2 | Port relay & test mock | Bridge parity, mock tests, chưa chạm dịch vụ thật |
| 3 | Quản trị trạm & relay ổn định | CRUD, import có kiểm soát, RBAC scope, reconcile, soft-delete |
| 4 | NTRIP caster & quản lý client | Mock trước, sau đó cổng thật |
| 5 | Realtime, dashboard, vận hành | Socket, history, alert, backup, load test |

Chi tiết: `docs/0/CAC_BUOC_THUC_HIEN.md`.

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
CASTER_PORT=2101
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
