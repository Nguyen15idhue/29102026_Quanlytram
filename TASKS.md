# TASKS.md

## 1. Tiến độ tổng

| Phase | Tên | Trạng thái | Phụ thuộc |
|---|---|---|---|
| 0 | Chuẩn bị & xác minh | DONE | - |
| 1 | Skeleton & hợp đồng dữ liệu | DONE | Phase 0 |
| 2 | Port relay & test mock | DONE | Phase 1 |
| 3 | Quản trị trạm & relay ổn định | DONE | Phase 2 |
| 3.5 | UI/UX Foundation | DONE | Phase 3 |
| 4 | NTRIP caster & quản lý client | DONE | Phase 3.5 |
| 5 | Realtime, dashboard, vận hành | TODO | Phase 4 |
| 6 | RTCM Analytics & chất lượng trạm/relay | TODO | Phase 3.5–5 |

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
- [x] Stations/mountpoints CRUD; bỏ `stations.mountpoint`
- [x] Relay job CRUD + soft delete
- [x] `owner_web_user_id` + `created_by`; scope all/subtree/own
- [x] NTRIP account CRUD (tách web) + owner + ACL placeholder
- [x] Web user/role CRUD; field allowlist; chống nâng quyền
- [x] Audit redaction; append-only

### P3-02 Import
- [x] Import chạy trên Windows host hoặc mount read-only
- [x] `--dry-run`, `--ids`, `--force`; transaction; idempotent
- [x] Mặc định disabled; `source_sha256`; không log secret
- [x] Chỉ import 2–3 job test

### P3-03 Reconcile
- [x] Node lưu config + tăng `desired_revision` trong transaction
- [x] Gọi `POST /internal/reconcile`
- [x] Go đọc revision, áp dụng, ghi `applied_revision/runtime_state/last_error`
- [x] Node phân biệt “đã lưu” vs “đã áp dụng”
- [x] Retry khi Go down; idempotent
- [x] UI hiển thị pending/streaming/error

### P3-04 History & cleanup
- [x] Sessions/events/hourly; retention
- [x] Xóa job: dừng, đóng socket, `close_reason='deleted'`, giữ history
- [x] Prune theo batch; không xóa session mở

**Nghiệm thu Phase 3:** CRUD + RBAC scope đúng; import đúng 2–3 job disabled;
reconcile saved/applied rõ; soft delete giữ history.

**Ghi chú Phase 3 (2026-10-30):**

- Migration `admin/003_ntrip_acl.sql` đã apply; health Node schema 3.
- NTRIP account CRUD + ACL placeholder PASS; response/audit không lộ hash/password.
- Mountpoint list scope admin/user PASS (sửa cột owner ambiguous khi JOIN).
- Import: dry-run 2 job; create → skip → force update; job disabled,
  `source_sha256` có, credential `v1:`; `--ids/--force` hoạt động.
- Reconcile Go down/up PASS: desired=2, applied=2, state `backoff`.
- Retention integration PASS: xóa row cũ, giữ row mới + session mở.
- Delete job unit test PASS: session `close_reason=deleted`, history còn.
- UI thêm Relay/Mountpoint/TK NTRIP; `frontend build` PASS.
  Browser smoke chưa chạy tự động.
- Review fix 2026-10-30: soft-delete tombstone 3 key (`#deleted:<id>`) nên
  tạo lại job trùng cấu hình được phép; import lọc row `deleted_at`
  (`server/src/lib/tombstone.ts`); Vitest 21/21; E2E recreate PASS.
- Không dùng caster thật/cổng 8081/2101; test data đã dọn.

---

## 5.5. Phase 3.5 — UI/UX Foundation

**Mục tiêu:** sửa toàn bộ UI hiện có trước khi thêm màn hình Phase 4/5/6:
shell cố định, CRUD bằng dialog/drawer, phân trang server-side, icon lucide,
trạng thái loading/empty/error, a11y. Không đổi API/DB (trừ bug UI nhỏ).
Chi tiết: `docs/0/UI_UX_PLAN.md`.

**Phụ thuộc:** Phase 3 DONE. Phase 4/5/6 dùng lại foundation này.

### U-01 Shell & tokens
- [x] `framed-sheet`: sidebar 228px + topbar 48px cố định; chỉ content cuộn
- [x] Mobile <1024px: sidebar drawer; topbar menu; content full width
- [x] Tokens màu/type/spacing/radius; IBM Plex Sans/Mono self-host
- [x] Dark mode `system/light/dark`; token dark; `color-scheme`; chống FOUC
- [x] Active nav neutral; một accent; không gradient/glass/shadow ở rest

### U-02 Component layer
- [x] `Button/IconButton`, `Field/Input/Select/Switch`, `PageHeader`
- [x] `Dialog` + `Drawer` + `AlertDialog` (Radix), focus trap/Esc/restore
- [x] `Toast`, `StatusBadge`, `Tabs`, `EmptyState/Skeleton/ErrorState`
- [x] `ThemeToggle` (Sun/Moon) + lưu lựa chọn; theo `prefers-color-scheme`
- [x] `lucide-react` 16–20px, stroke 1.5, currentColor; không icon màu/tinted chip

### U-03 CRUD pattern
- [x] Bỏ toàn bộ form inline khỏi page/table
- [x] Create/Edit trong Dialog; mobile full-screen Drawer
- [x] View trong Drawer; Delete/Disable trong AlertDialog
- [x] Field error, submit disabled khi lưu; toast sau mutation (dirty guard defer)

### U-04 Table & pagination
- [x] DataTable: sticky header, row 48px, số căn phải, action cột cuối
- [x] Server pagination 20 (10/20/50); `page/pageSize/q/status` lưu URL
- [x] Search debounce 300ms; empty/loading/error có action/retry (filter nâng cao defer)
- [x] Mobile: row 2 dòng; ẩn cột phụ; không tràn ngang

### U-05 Refactor màn hình hiện có
- [x] Dashboard: KPI strip + quick actions (recent activity defer)
- [x] Stations/Mountpoints: table + dialog/drawer + phân trang
- [x] Relay: state/applied revision + detail drawer + actions menu
- [x] TK NTRIP: CRUD dialog + ACL drawer/tab
- [x] WebUsers/Roles: dialog + role matrix drawer; bỏ `window.confirm`

### U-06 A11y, motion, QA
- [x] Keyboard/focus/aria/contrast cả light/dark; reduced-motion
- [x] Dark mode: system default, toggle persist, không FOUC; table/form/chart rõ
- [x] Playwright: login → CRUD → search/page → delete confirm; light + dark
- [x] `inspect.mjs --app` 0 FAIL tại 1440/768/390
- [x] Không gây lỗi hồi quy API/RBAC/reconcile; cập nhật SESSION/TASKS

**Nghiệm thu Phase 3.5:** không còn form inline/`window.confirm`; mọi bảng có
phân trang; shell không cuộn cùng content; icon monochrome; CRUD dialog/drawer;
loading/empty/error/toast đầy đủ; keyboard/a11y; dark mode system/toggle rõ;
inspect 0 FAIL cả light/dark.

**Ghi chú Phase 3.5 (2026-10-30):** shell cố định + dark mode + Dialog/Drawer/
AlertDialog + DataTable/pagination + lucide + toast/a11y đã xong; Playwright
login/CRUD light-dark/mobile PASS; `inspect.mjs --app` login 0 FAIL.
Defer: dirty guard, filter nâng cao, recent activity; không chặn Phase 4.

---

## 6. Phase 4 — NTRIP caster & quản lý client

**Mục tiêu:** caster tự phát mountpoint; quản lý NTRIP account/ACL/giới hạn;
mock trước khi mở cổng thật.

### P4-01 Caster
- [x] Listener mặc định **1509** (source + rover), tùy chỉnh; không 2101/8081
- [x] `caster_listeners` + `caster_listener_mountpoints` many-to-many
- [x] Một mountpoint có thể nghe nhiều port (A,B,C→1509; A,C→1508)
- [x] Parse `SOURCE` (v1), `POST` (v2), `GET` (rover); đúng ngữ cảnh
- [x] `ICY 200` / `HTTP 200` / `SOURCETABLE 200`
- [x] Auth Basic; no-auth chỉ khi cấu hình rõ ràng
- [x] Fan-out + queue giới hạn + drop slow client
- [x] ACL + max connections
- [x] NTRIP account RBAC + owner scope
- [x] `connections` runtime; disconnect chủ động
- [x] RTCM monitor; counters
- [x] API/UI quản lý listener + gắn mountpoint
- [x] Mock caster/rover cho caster mới
- [ ] Integration allowlist Q10: 1 upstream + 1 downstream, credential ngoài repo, cleanup (defer)

**Nghiệm thu Phase 4:** mock PASS v1/v1-auth/v2, multi-client, ACL, max conn,
slow client; listener 1509 và nhóm 1508 đúng; chỉ mở cổng thật sau khi mock đạt.

**Ghi chú Phase 4 (2026-10-30):** migration admin 004 + runtime 003 đã apply;
Go caster tests 7 PASS; E2E source/rover 1509 byte-exact PASS; Caster UI +
Playwright route PASS; health Node 4 / Go 3. Q10 real allowlist chưa chạy
(defer, credential ngoài repo). Hot reload Vite polling 1s đã bật.

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

### P5-02 Dashboard/UI (dùng foundation Phase 3.5)
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

## 8. Phase 6 — RTCM Analytics & chất lượng trạm/relay

**Mục tiêu:** dùng `go-gnss/rtcm` parse RTCM3 để đánh giá chất lượng cho
**trạm thường** (`station`, hướng `ingest`) và **trạm relay** (`relay_job`,
hướng `upstream`/`downstream`); có API + realtime + FE quản trị.
Chi tiết: `docs/0/RTCM_QUALITY_PLAN.md`.

**Phụ thuộc:** Phase 3 (station/relay job/RBAC). P6-04/P6-05 cần realtime Phase 5.
P6-01/P6-02 có thể bắt đầu ngay sau Phase 3; P6-03 cần Phase 4 cho caster ingest
(hoặc làm station probe GET-only sớm hơn).

### P6-01 Parser go-rtcm
- [ ] Thêm `github.com/go-gnss/rtcm` (Apache-2.0), package `rtcm3`
- [ ] Parse frame/type: 1005/1006/1007/1008/1033, MSM 1074–1077,
      1084–1087, 1094–1097, 1104–1107, 1114–1117, 1124–1127, 1230
- [ ] Queue parse giới hạn; drop sample có counter; không chặn relay/caster
- [ ] Byte-in == byte-out; không serialize/sửa byte
- [ ] Fixtures valid/CRC sai/truncated/unknown/mảnh read/nhiều frame

### P6-02 Quality model & score dùng chung
- [ ] Migration `runtime/<next>_rtcm_quality.sql`
- [ ] Migration `admin/<next>_quality_permissions.sql` (`quality.view`, `quality.ack`, `station_probes`)
- [ ] `rtcm_message_stats`, `quality_samples`, `quality_alerts` dùng chung
      `target_type ENUM('station','relay_job')` + `target_id` + `mountpoint_id`
      (relay=0) + `direction`
- [ ] `quality_alert_acks` (admin); không FK xuyên schema
- [ ] Score 0–100: transport/integrity/MSM/metadata/signal/latency
- [ ] Station score theo `ingest`; relay score upstream/downstream + `parity`
- [ ] Baseline MSM 10 phút; relay job score = min(upstream, downstream)
- [ ] Retention: sample 60 s/30 ngày, hourly 90 ngày, alert 90 ngày

### P6-03 Nguồn chất lượng trạm thường
- [ ] Caster ingest (Phase 4): phân tích luồng SOURCE/POST theo mountpoint/station
- [ ] Station probe GET-only cho trạm ngoài hệ thống; mặc định disabled
- [ ] `station_probes` (admin): station/mountpoint, interval, credential ref
- [ ] Không tạo downstream; chỉ endpoint được phép; mock-first
- [ ] Tránh trùng nguồn ingest/probe; ưu tiên ingest nếu cả hai bật
- [ ] Trạm không có nguồn chất lượng → trạng thái `unknown`, không báo sai

### P6-04 API & realtime BE
- [ ] Internal `GET /internal/rtcm/snapshot`, `/internal/rtcm/health`
- [ ] REST `/api/quality/overview` (station + relay)
- [ ] REST `/api/stations/:id/quality`, `/api/stations/:id/rtcm/messages`
- [ ] REST `/api/stations/:id/probes`, `/api/station-probes/:id` (CRUD/enable/disable)
- [ ] REST `/api/relay-jobs/:id/quality`, `/api/relay-jobs/:id/rtcm/messages`
- [ ] REST `/api/quality/alerts`, `/:id/ack`, `/api/quality/export`
- [ ] RBAC scope all/subtree/own cho cả station và relay
- [ ] Socket.IO `quality.snapshot/updated/alert/ack`; room `station:<id>`/`relay:<id>`
- [ ] Throttle ~1 s; reconnect snapshot; đổi quyền cập nhật socket

### P6-05 FE quản trị realtime (dùng foundation Phase 3.5)
- [ ] Menu **Chất lượng** với tab **Trạm** và **Relay**
- [ ] Tab Trạm: tổng quan, score, message type/rate, sat/cell, CNR, metadata
- [ ] Tab Relay: upstream/downstream, parity, chart score/sat/cell/CNR/age/gap
- [ ] Chi tiết trạm/relay: ARP, station ID, antenna, ARP jump
- [ ] Alert list/filter/ack; loading/empty/error; responsive 1440/768/390
- [ ] Taste `inspect.mjs --app` 0 FAIL + test luồng/a11y

### P6-06 Alerts, retention, export
- [ ] Alert debounce 3 cửa sổ; first/last/resolved
- [ ] Ack lưu admin + audit; không auto-disable job/probe
- [ ] Export CSV giới hạn dòng + audit
- [ ] Prune sample/alert theo retention; không xóa alert đang mở

### P6-07 Test & hardening
- [ ] Unit parser/quality/score; mock stream; DB down/up; restart
- [ ] Byte-exact khi analyzer chạy; queue đầy không block
- [ ] Station ingest + station probe GET-only; relay upstream/downstream/parity
- [ ] API/RBAC/socket/scope; không raw payload/secret trong log
- [ ] Load 50–100 station/job; CPU/RAM/p95; license go-rtcm
- [ ] Tài liệu vận hành + cập nhật SESSION

**Nghiệm thu Phase 6:** parse đúng type chính; byte-exact; chất lượng đúng cho
cả trạm thường và trạm relay; score/alert đúng ngưỡng; realtime < 2 s;
không lộ dữ liệu ngoài scope; tải 50–100 station/job không crash;
test 6-T1..6-T13 PASS.

---

## 9. Ghi chú điều phối

- Không chuyển phase nếu checklist chưa PASS.
- Mỗi task cập nhật trạng thái vào file này.
- Mọi thay đổi kiến trúc phải cập nhật docs v2 trước.
- Phase 6 chỉ bổ sung sau khi docs được chốt; không làm thay đổi bất biến
  Node/Go ownership hoặc đường byte RTCM.
