# TASKS.md

## 1. Tiến độ tổng

| Phase | Tên | Trạng thái | Phụ thuộc |
|---|---|---|---|
| 0 | Chuẩn bị & xác minh | DONE | - |
| 1 | Skeleton & hợp đồng dữ liệu | DONE | Phase 0 |
| 2 | Port relay & test mock | DONE | Phase 1 |
| 3 | Quản trị trạm & relay ổn định | TODO | Phase 2 |
| 4 | NTRIP caster & quản lý client | TODO | Phase 3 |
| 5 | Realtime, dashboard, vận hành | TODO | Phase 4 |

Quy tắc: không chuyển phase nếu checklist của phase hiện tại chưa PASS.

---

## 2. Phase 0 — Chuẩn bị & xác minh

**Mục tiêu:** chốt tài liệu, baseline relay, quy ước làm việc. Không viết code.

### P0-01 Tài liệu v2
- [x] `docs/0/KE_HOACH_CHI_TIET.md` (v2)
- [x] `docs/0/CAC_BUOC_THUC_HIEN.md` (v2)

### P0-02 Baseline relay (read-only)
- [x] Xác nhận đường dẫn backup đọc được
- [x] Inventory tính năng + bằng chứng file:line
- [x] Hash baseline main.go/history.go/go.mod/config.json
- [x] Xác nhận không thay đổi file backup

### P0-03 Quy ước làm việc
- [x] `AGENTS.md`
- [x] `TASKS.md`
- [x] `SESSION.md`
- [x] `README.md`
- [x] `.env.example`
- [x] `.gitignore`

### P0-04 Kiểm tra cuối
- [x] Không secret trong repo
- [x] Không có code ứng dụng
- [x] Không docker/package mới
- [x] Báo cáo PASS/FAIL

**Nghiệm thu Phase 0:** đủ 6 file, không secret, relay backup nguyên vẹn,
không có mã nguồn ứng dụng.

---

## 3. Phase 1 — Skeleton & hợp đồng dữ liệu

**Mục tiêu:** khung chạy end-to-end; chốt auth, schema, ownership, API contract
trước CRUD lớn.

### P1-01 Hạ tầng
- [x] Docker Compose: MySQL 8, Node, Go, FE (dev), network nội bộ
- [x] MySQL volume + healthcheck; `default-time-zone=+00:00`
- [x] `TZ=Asia/Ho_Chi_Minh`, `APP_TIMEZONE=Asia/Ho_Chi_Minh` cho Node/Go
- [x] Ports: FE 5173/3000, Node 4000, Go 7080, MySQL 3307->3306
- [x] Không public MySQL/Go internal
- [x] `.env.example` + `.env.local`
- [x] Bật Docker Desktop

### P1-02 Database & ownership
- [x] `db/migrations/admin/`, `db/migrations/runtime/`
- [x] `schema_migrations(scope, version)`; hai version riêng
- [x] `cors_admin`, `cors_runtime`
- [x] User `cors_app`, `cors_relay` đúng quyền
- [x] Bảng RBAC: `roles`, `permissions`, `role_permissions`, `web_users`, `web_sessions`
- [x] Bảng nghiệp vụ: `stations` (không mountpoint), `mountpoints`, `ntrip_accounts`
- [x] `owner_web_user_id`, `created_by`
- [x] Seed role `super_admin` 100, `admin` 50, `user` 10
- [x] Seed permission + scope `none`
- [x] Seed super_admin đầu tiên
- [x] Go kiểm tra schema runtime version

### P1-03 Auth & RBAC nền
- [x] Session cookie server-side + CSRF
- [x] Argon2id; `HttpOnly`, `SameSite=Lax`, `Secure` khi HTTPS
- [x] Thu hồi session khi khóa/đổi mật khẩu
- [x] `auth/me` trả role + permission/scope
- [x] `requirePermission(module, action)` + scope filter
- [x] Chống nâng quyền; field allowlist
- [x] Audit redaction

### P1-04 API contract
- [x] Chốt endpoint (docs v2 mục 8)
- [x] Không dùng lẫn `/api/relay-jobs` và `/api/relay/jobs`
- [x] Chuẩn lỗi JSON, status code, pagination
- [x] `docs/api.md`

### P1-05 Go service
- [x] `cmd/corsd` + `/health`
- [x] Kết nối MySQL runtime + ping + schema check
- [x] Graceful shutdown
- [x] Chưa cần NTRIP

### P1-06 Frontend
- [x] React + Vite + TS + Router + TanStack Query
- [x] Menu Phase 1: Dashboard, Trạm, Người dùng web, Vai trò & quyền
- [x] Login, Dashboard shell, Stations list/detail
- [x] Web users + Roles (ma trận quyền + scope)
- [x] Loading/empty/error; ẩn/hiện nút theo `auth/me`
- [x] Design tokens cơ bản; Taste gate đầy đủ để Phase 5

### P1-07 Dữ liệu test
- [x] Seed 2–3 trạm; 2–3 mountpoint
- [x] Seed 1 super_admin, 1 admin, 2 user (subtree) để test scope

**Nghiệm thu Phase 1:** Compose Up, health OK, login/session OK, CRUD trạm/
mountpoint/web user/role OK, RBAC đúng scope, web/NTRIP tách biệt,
timezone UTC/+07 nhất quán, API contract thống nhất.

**Ghi chú Phase 1:**
- Menu Relay/Mountpoints/TK NTRIP/Kết nối/Nhật ký/Cấu hình để Phase 2+.
- Web account dùng để xác thực NTRIP: chưa test được vì caster ở Phase 4.
- Taste gate 0 FAIL đầy đủ để Phase 5; Phase 1 mới có token/layout cơ bản.

---

## 4. Phase 2 — Port relay & test mock

**Mục tiêu:** port relay bridge sang Go, chứng minh byte-exact bằng mock.
Chưa chạm dịch vụ thật.

### P2-01 Data model & API
- [x] `relay_credentials`, `relay_jobs`, `relay_job_state`
- [x] `relay_sessions`, `relay_events`, `relay_hourly`
- [x] `desired_revision`, `applied_revision`, `runtime_state`, `last_error`
- [x] Unique index `(external_key)`, `(upstream_key, downstream_key)`
- [x] `deleted_at`
- [x] API CRUD + actions enable/disable/restart/test
- [x] Không trả secret; chỉ `hasSecret` + `username`

### P2-02 Go bridge
- [x] GET upstream, POST downstream, `ICY 200`, chunked
- [x] SOCKS5 proxy, TLS, backoff, byte counters, last-data
- [x] NMEA GGA/GSA/RMC + jitter + device UA
- [x] `downstream_mode=auto`: POST -> fallback SOURCE
- [x] RTCM monitor: preamble/len/CRC24Q; buffer giới hạn + resync
- [x] Ghi runtime MySQL theo batch; buffer giới hạn
- [x] Đọc config RO; reconcile theo revision

### P2-03 Mock & fixtures
- [x] Mock caster (v1/v2), mock rover, mock source
- [x] Fixtures RTCM3 hợp lệ + CRC sai
- [x] Script byte-exact, mảnh read, nhiều frame/read
- [x] Script slow client

### P2-04 Loop guard
- [x] Key endpoint: `scheme + host + port + mount` chuẩn hóa
- [x] Self-loop + DFS cycle nội bộ
- [x] Unique index; Go kiểm tra lại khi load
- [x] Ghi rõ giới hạn với hệ thống ngoài

### P2-05 Test mock
- [x] Byte-in == byte-out
- [x] Reconnect/backoff/timeout
- [x] Chunked; nhiều frame/read; CRC sai
- [x] Slow client không làm nghẽn
- [x] Go restart: session cũ đóng `service_restart`
- [x] DB down/up: buffer giới hạn; không chặn RTCM
- [x] Không chứa secret trong log

**Nghiệm thu Phase 2:** mock PASS toàn bộ; byte-exact; monitor không ảnh
hưởng tốc độ; reconcile rõ ràng; loop guard hoạt động.

**Ghi chú Phase 2 (2026-10-30):**

- Migration `002_relay.sql` + `002_relay_runtime.sql`; schema admin/runtime = 2.
- Go test PASS: `relay` (2-T1..2-T9, manager, writer, loop guard, backoff),
  `ntrip` (v1 ICY, v2 chunked, POST/SOURCE/auto, 401, SOURCETABLE, TLS),
  `rtcm`, `nmea`, `secret`, `proxy` (SOCKS5 no-auth).
- Node: `tsc --noEmit` sạch; Vitest 19/19; list relay scope admin/user1 OK.
- E2E mock PASS: Node login -> tạo job -> Go GET upstream -> SOURCE downstream
  -> capture byte-exact -> state `streaming` -> action `test` OK -> disable ->
  soft-delete ẩn khỏi API.
- Mock/fixtures: `scripts/mock-ntrip`, `scripts/fixtures/rtcm3-valid.hex`,
  `scripts/fixtures/rtcm3-badcrc.hex`, `scripts/e2e-relay-mock.ps1`.
- Loop guard chỉ phát hiện self-loop/cycle nội bộ theo endpoint key; không
  phát hiện vòng đi qua hệ thống ngoài (giới hạn đã ghi ở `docs/api.md`).
- Không chạy relay cũ, không dùng cổng `8081`/`2101`, không chạm backup.

---

## 5. Phase 3 — Quản trị trạm & relay ổn định

**Mục tiêu:** CRUD, import có kiểm soát, RBAC scope, reconcile Node–Go,
soft-delete, history. Chưa cần caster.

### P3-01 CRUD & RBAC
- [ ] Stations/mountpoints CRUD; bỏ `stations.mountpoint`
- [ ] Relay job CRUD + soft delete
- [ ] `owner_web_user_id` + `created_by`; scope all/subtree/own
- [ ] NTRIP account CRUD (tách web) + owner + ACL placeholder
- [ ] Web user/role CRUD; field allowlist; chống nâng quyền
- [ ] Audit redaction; append-only

### P3-02 Import
- [ ] Import chạy trên Windows host hoặc mount read-only
- [ ] `--dry-run`, `--ids`, `--force`; transaction; idempotent
- [ ] Mặc định disabled; `source_sha256`; không log secret
- [ ] Chỉ import 2–3 job test

### P3-03 Reconcile
- [ ] Node lưu config + tăng `desired_revision` trong transaction
- [ ] Gọi `POST /internal/reconcile`
- [ ] Go đọc revision, áp dụng, ghi `applied_revision/runtime_state/last_error`
- [ ] Node phân biệt “đã lưu” vs “đã áp dụng”
- [ ] Retry khi Go down; idempotent
- [ ] UI hiển thị pending/streaming/error

### P3-04 History & cleanup
- [ ] Sessions/events/hourly; retention
- [ ] Xóa job: dừng, đóng socket, `close_reason='deleted'`, giữ history
- [ ] Prune theo batch; không xóa session mở

**Nghiệm thu Phase 3:** CRUD + RBAC scope đúng; import đúng 2–3 job disabled;
reconcile saved/applied rõ; soft delete giữ history.

---

## 6. Phase 4 — NTRIP caster & quản lý client

**Mục tiêu:** caster tự phát mountpoint; quản lý NTRIP account/ACL/giới hạn;
mock trước khi mở cổng thật.

### P4-01 Caster
- [ ] Listener 2101 (configurable)
- [ ] Parse `SOURCE` (v1), `POST` (v2), `GET` (rover); đúng ngữ cảnh
- [ ] `ICY 200` / `HTTP 200` / `SOURCETABLE 200`
- [ ] Auth Basic; no-auth chỉ khi cấu hình rõ ràng
- [ ] Fan-out + queue giới hạn + drop slow client
- [ ] ACL + max connections
- [ ] NTRIP account RBAC + owner scope
- [ ] `connections` runtime; disconnect chủ động
- [ ] RTCM monitor; counters
- [ ] Mock caster/rover cho caster mới

**Nghiệm thu Phase 4:** mock PASS v1/v1-auth/v2, multi-client, ACL, max conn,
slow client; chỉ mở cổng thật sau khi mock đạt.

---

## 7. Phase 5 — Realtime, dashboard, vận hành

**Mục tiêu:** realtime đúng quyền; dashboard/history/alert; backup/restore;
load test; tài liệu vận hành.

### P5-01 Realtime
- [ ] Socket auth bằng session cookie
- [ ] Room `user:<id>`; room tài nguyên sau kiểm tra quyền
- [ ] Không dùng room role cho dữ liệu nhạy cảm
- [ ] Lọc payload theo scope
- [ ] Đổi role/ownership -> cập nhật/ngắt socket
- [ ] Throttle ~1 s; payload có `ts`
- [ ] `/api/snapshot` + reconnect

### P5-02 Dashboard/UI
- [ ] Dashboard tổng trạm/relay/client/alert
- [ ] History sessions/events/timeline
- [ ] Alert + ack
- [ ] Role UI nâng cao + audit
- [ ] Loading/empty/error; confirm thao tác nguy hiểm
- [ ] Taste `inspect.mjs --app` 0 FAIL 1440/768/390
- [ ] Test luồng + phân quyền + a11y

### P5-03 Ops/hardening
- [ ] Rate limit login/API; body size limit
- [ ] OWASP cơ bản; secret scan
- [ ] Backup/restore MySQL + kiểm chứng
- [ ] Health check + log rotation
- [ ] Tài liệu vận hành
- [ ] Load test 50–100 job + 50 rover
- [ ] Xác minh license thư viện thực tế

**Nghiệm thu Phase 5:** realtime < 2 s; reconnect snapshot đúng; không lộ dữ
liệu ngoài scope; backup/restore OK; load test không crash; UI đạt 0 FAIL +
test chức năng.

---

## 8. Ghi chú điều phối

- Không chuyển phase nếu checklist chưa PASS.
- Mỗi task cập nhật trạng thái vào file này.
- Mọi thay đổi kiến trúc phải cập nhật docs v2 trước.
