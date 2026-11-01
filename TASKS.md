# TASKS.md

## 1. Tiến độ tổng

| Phase | Tên | Trạng thái | Phụ thuộc |
|---|---|---|---|
| 0 | Chuẩn bị & xác minh | DONE | - |
| 1 | Skeleton & hợp đồng dữ liệu | DONE | Phase 0 |
| 2 | Port relay & test mock | DONE | Phase 1 |
| 3 | Quản trị trạm & relay ổn định | DONE | Phase 2 |
| 3.5 | UI/UX Foundation | DONE | Phase 3 |
| 4 | NTRIP caster & quản lý client | DONE (mock + real allowlist 2 relay/2 station) | Phase 3.5 |
| 5 | Realtime, dashboard, vận hành | DONE (defer Taste auth) | Phase 4 |
| 6 | RTCM Analytics & chất lượng trạm/relay | DONE (mock + real probe; load 50 PASS) | Phase 3.5–5 |
| 7 | Nền tảng UI & Trạm danh sách | DONE (core + nguồn trạm/1005; Playwright 8/8) | Phase 5–6 |
| 8 | Bản đồ & chi tiết trạm | DONE (core + map 1005 + cycle slip/RMS/latency; Sky Plot chờ ephemeris nguồn) | Phase 7 |
| 9 | CORS: NTRIP, mountpoint, caster | DONE (core; import/export defer) | Phase 7–8 |
| 10 | Relay & Hệ thống | DONE (core; relay/role import-export defer) | Phase 7–9 |
| 11 | Cá nhân, cấu hình & báo cáo | DONE (core; notification/config/log defer) | Phase 7–10 |
| 12 | Hardening, load test & release | TODO | Phase 7–11 |

Quy tắc: không chuyển phase nếu checklist của phase hiện tại chưa PASS.

## 1b. P0 vận hành (docs/1)

| Phase | Tên | Trạng thái |
|---|---|---|
| P0.1 | Chi tiết trạm `/stations/:id` 5 tab | DONE |
| P0.2 | Mountpoint Explorer | DONE |
| P0.3 | Bản đồ vận hành hợp nhất `/map` | DONE |
| P0.4 | System Health `/system/health` | DONE |
| P0.5 | Dashboard vận hành & alert impact | DONE |
| P0.6 | Menu, route, deep link | DONE |
| P0 chốt UX | Regression Phase 7 | DONE |
| UI/UX review | STT, màu, filter thu gọn, hot reload 1s | DONE |
| P0.7 + P0.12 | Provision hệ cũ | DONE |
| P0.8 | HTTPS/domain/reverse proxy | TODO |
| P0.9 | Load test 67–100 relay job | TODO |
| P0.10 | Backup/restore/rollback | TODO |
| P0.11 | Auth password-only | DONE |
| P0.13 | Cutover & theo dõi | TODO |

Chi tiết bằng chứng: `docs/1/02_CAC_BUOC_THUC_HIEN_P0.md` mục 6.

## 1c. P1 vận hành (docs/1)

| Phase | Tên | Trạng thái |
|---|---|---|
| P1.0 | Baseline, backup, Graphify, Unicode audit | DONE |
| P1.1 | Schema và dữ liệu nền | DONE |
| P1.2 | RBAC tenant và menu | DONE |
| P1.3 | DataTable selection, BulkActionBar, MultiSelect | DONE |
| P1.4 | Dashboard counts và layout | DONE |
| P1.5 | Trạm: form/view/source/Geoapify/uptime | DONE |
| P1.6 | Mountpoint gộp Explorer + Listener | DONE |
| P1.7 | NTRIP listener ACL + caster sourcetable | DONE |
| P1.8 | Relay form + JSON import | DONE |
| P1.9 | Unicode, history, hiển thị | DONE |
| P1.10 | Regression và bàn giao P1 | DONE |
| P1.10.1 | Khắc phục trạm/kết nối/tọa độ/geo | DONE |
| P1.11 | Bản đồ vận hành | DEFER |

Chi tiết bằng chứng: `docs/1/03_CAC_BUOC_THUC_HIEN_P1.md` mục 11.

## 1d. Kế hoạch 04 — Realtime CRUD entity

| Bước | Tên | Trạng thái |
|---|---|---|
| 1 | Baseline, backup và chốt môi trường test | DONE |
| 2 | Chuẩn bị reset dữ liệu test | DONE |
| 3 | Migration 023–024 | DONE |
| 4 | Bỏ station code, mountpoint tự sinh, field bắt buộc | DONE |
| 5 | CRUD trạm, ma trận trạng thái, xóa cascade | DONE |
| 6 | CRUD mountpoint, immutable, pause relay | DONE |
| 7 | CRUD NTRIP account, managed account, ngắt online | DONE |
| 8 | Reconcile tập trung và entity.changed | DONE |
| 9 | Go caster targeted disconnect, race, max_connections | DONE |
| 10 | Relay pause ownership station/mountpoint | DONE |
| 11 | Probe fingerprint, listener/source reconcile | DONE |
| 12 | UI realtime, form, row action | DONE |
| 13 | Flow mock end-to-end | DONE |
| 14 | Race/load/toggle leak | PARTIAL — real streaming BLOCKED (chưa có endpoint allowlist) |
| 15 | Regression, docs, release | DONE (Playwright 31/31, server 53/53, Go test/vet/race) |

Bổ sung 2026-11-01: trạng thái streaming `online | offline | no data | —`;
`relay_caster` lấy từ relay runtime. Chi tiết: `docs/1/04_KE_HOACH_REALTIME_CRUD.md`.

## 1e. Kế hoạch 05 — Công ty nhiều admin

| Bước | Tên | Trạng thái |
|---|---|---|
| P05-1 | Schema companies + company_id + backfill | DONE |
| P05-2 | RBAC company, peer admin, listener global | DONE |
| P05-3 | API companies/users/resources/audit | DONE |
| P05-4 | UI Companies, cột/filter công ty | DONE (form tạo trạm/relay/MP/NTRIP chọn company: follow-up) |
| P05-5 | Test matrix 05-T1..T19, regression, rollout | DONE (server 61/61, Playwright 6/6, Go test/vet; còn follow-up UI company trong form tạo) |

Chi tiết: `docs/1/05_KE_HOACH_CONG_TY_NHIEU_ADMIN.md`.

## 1f. Kế hoạch 06 — Nâng cấp bản đồ

| Bước | Tên | Trạng thái |
|---|---|---|
| P06-0 | Chuẩn bị, xác minh provider, fixture | DONE (server+browser reach 4 tile host; `tileMode=proxy`; Geoapify reverse/forward OK; fixture 480/481/482; backup DB) |
| P06-1 | Nền tảng tile + toạ độ | DONE (tile proxy + config GET, overview coordSource/filter/field-gate, MapCanvas, form toạ độ dự phòng; server 71/71, FE build, Playwright smoke PASS) |
| P06-2 | Bộ lọc, tìm kiếm, tương tác | DONE (MapFilterPanel, URL state, fit/flyTo, legend, 3 mode, AddressSearch Geoapify, xoá StationMap/OnlineMap; Playwright map-upgrade 2/2) |
| P06-3 | Cấu hình map super admin | DONE (settings map.config, GET/PUT/test, audit redacted, trang `/system/map-config`, menu theo `settings.edit`; Playwright map-config 2/2) |
| P06-4 | Test & rollout | DONE (server 71/71, FE tsc/build, Go test/vet, Playwright 15/15, tile/geo/config/RBAC, graphify 3233 nodes) |

Chi tiết: `docs/1/06_KE_HOACH_NANG_CAP_BAN_DO.md`.

## 1g. Kế hoạch 06 bổ sung — P06-5 layout hybrid

| Bước | Tên | Trạng thái |
|---|---|---|
| P06-5.0 | Baseline & chốt kế hoạch | DONE (baseline map 4/4; commit `ee402e5`) |
| P06-5.1 | Full-bleed + MapToolbar | DONE (bỏ `.map-side`, icon rail, overlay state, map full; smoke 1440/390 PASS) |
| P06-5.2 | Filter/legend/search nổi | DONE (popover/sheet, Esc/outside/focus, legend desktop-on/mobile-off, MapSearchBox gộp trạm+địa chỉ, badge, RBAC option; smoke 3/3) |
| P06-5.3 | StationListDrawer + deep link | DONE (drawer/sheet, list+summary, marker không mở drawer, ?station mở drawer, fit/reset giữ mode; smoke 2/2) |
| P06-5.4 | Responsive/dark/a11y/rollout | TODO |

Chi tiết: mục 13 của `docs/1/06_KE_HOACH_NANG_CAP_BAN_DO.md`.

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
- [x] Field error, submit disabled khi lưu; toast sau mutation; dirty guard form chính

### U-04 Table & pagination
- [x] DataTable: sticky header, row 48px, số căn phải, action cột cuối
- [x] Server pagination 20 (10/20/50); `page/pageSize/q/status` lưu URL
- [x] Search debounce 300ms; empty/loading/error có action/retry; filter nâng cao chuyển Phase 7
- [x] Mobile: row 2 dòng; ẩn cột phụ; không tràn ngang

### U-05 Refactor màn hình hiện có
- [x] Dashboard: KPI strip + quick actions + recent audit activity
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
Đã bổ sung dirty guard form chính, recent audit activity. Filter nâng cao
chuyển Phase 7 (theo menu/field mới); không chặn Phase 4.

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
- [x] Integration allowlist Q10: 2 relay + 2 station thật, credential ngoài repo, giữ cấu hình

**Nghiệm thu Phase 4:** mock PASS v1/v1-auth/v2, multi-client, ACL, max conn,
slow client; listener 1509 và nhóm 1508 đúng; chỉ mở cổng thật sau khi mock đạt.

**Ghi chú Phase 4 (2026-10-30):** migration admin 004 + runtime 003 đã apply;
Go caster tests 7 PASS; E2E source/rover 1509 byte-exact PASS; Caster UI +
Playwright route PASS; health Node 4 / Go 3. Q10 real allowlist đã chạy với
2 relay + 2 station thật, credential ngoài repo. Hot reload Vite polling 1s đã bật.

---

## 7. Phase 5 — Realtime, dashboard, vận hành

**Mục tiêu:** realtime đúng quyền; dashboard/history/alert; backup/restore;
load test; tài liệu vận hành.

### P5-01 Realtime
- [x] Socket auth bằng session cookie
- [x] Room `user:<id>`; room tài nguyên sau kiểm tra quyền
- [x] Không dùng room role cho dữ liệu nhạy cảm
- [x] Lọc payload theo scope
- [x] Đổi role/ownership -> cập nhật/ngắt socket
- [x] Throttle ~1 s; payload có `ts`
- [x] `/api/snapshot` + reconnect

### P5-02 Dashboard/UI (dùng foundation Phase 3.5)
- [x] Dashboard tổng trạm/relay/client/alert
- [x] History sessions/events/timeline
- [x] Alert + ack
- [x] Role UI nâng cao + audit (sửa role; API `/api/audit-logs`; tab Audit)
- [x] Loading/empty/error; confirm thao tác nguy hiểm
- [ ] Taste `inspect.mjs --app` 0 FAIL 1440/768/390 (defer; inspect không auth)
- [x] Test luồng + phân quyền + a11y

### P5-03 Ops/hardening
- [x] Rate limit login/API; body size limit
- [x] OWASP cơ bản; secret scan
- [x] Backup/restore MySQL + kiểm chứng
- [x] Health check + log rotation
- [x] Tài liệu vận hành
- [x] Load test mock 20 job + 20 rover (Q9=20; không endpoint thật)
- [x] Xác minh license thư viện thực tế

**Nghiệm thu Phase 5:** realtime < 2 s; reconnect snapshot đúng; không lộ dữ
liệu ngoài scope; backup/restore OK; load test không crash; UI đạt 0 FAIL +
test chức năng.

**Ghi chú Phase 5 (2026-10-30):** migration admin 005 (alerts/settings);
Socket.IO session cookie, room + scope filter, polling 1 s; API snapshot/alerts/
history; UI Dashboard realtime, Cảnh báo, Lịch sử; backup/restore ngoài repo;
load test mock 20/20 streaming; Node Vitest 29/29, Playwright realtime 2/2,
Go test/vet PASS. Đã bổ sung Role UI sửa role + audit API/tab Audit.
Defer: Taste inspect sau auth.

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
- [x] Thêm `github.com/go-gnss/rtcm` (Apache-2.0), package `rtcm3`
- [x] Parse frame/type: 1005/1006/1007/1008/1033, MSM 1074–1077,
      1084–1087, 1094–1097, 1104–1107, 1114–1117, 1124–1127, 1230
- [x] Queue parse giới hạn; drop sample có counter; không chặn relay/caster
- [x] Byte-in == byte-out; không serialize/sửa byte
- [x] Fixtures valid/CRC sai/truncated/unknown/mảnh read/nhiều frame

### P6-02 Quality model & score dùng chung
- [x] Migration `runtime/<next>_rtcm_quality.sql`
- [x] Migration `admin/<next>_quality_permissions.sql` (`quality.view`, `quality.ack`, `station_probes`)
- [x] `rtcm_message_stats`, `quality_samples`, `quality_alerts` dùng chung
      `target_type ENUM('station','relay_job')` + `target_id` + `mountpoint_id`
      (relay=0) + `direction`
- [x] `quality_alert_acks` (admin); không FK xuyên schema
- [x] Score 0–100: transport/integrity/MSM/metadata/signal/latency
- [x] Station score theo `ingest`; relay score upstream/downstream + `parity`
- [x] Baseline MSM 10 phút; relay job score = min(upstream, downstream)
- [x] Retention: sample 60 s/30 ngày, hourly 90 ngày, alert 90 ngày

### P6-03 Nguồn chất lượng trạm thường
- [x] Caster ingest (Phase 4): phân tích luồng SOURCE/POST theo mountpoint/station
- [x] Station probe GET-only cho trạm ngoài hệ thống; mặc định disabled
- [x] `station_probes` (admin): station/mountpoint, interval, credential ref
- [x] Không tạo downstream; chỉ endpoint được phép; mock-first
- [x] Tránh trùng nguồn ingest/probe; ưu tiên ingest nếu cả hai bật
- [x] Trạm không có nguồn chất lượng → trạng thái `unknown`, không báo sai

### P6-04 API & realtime BE
- [x] Internal `GET /internal/rtcm/snapshot`, `/internal/rtcm/health`
- [x] REST `/api/quality/overview` (station + relay)
- [x] REST `/api/stations/:id/quality`, `/api/stations/:id/rtcm/messages`
- [x] REST `/api/stations/:id/probes`, `/api/station-probes/:id` (CRUD/enable/disable)
- [x] REST `/api/relay-jobs/:id/quality`, `/api/relay-jobs/:id/rtcm/messages`
- [x] REST `/api/quality/alerts`, `/:id/ack`, `/api/quality/export`
- [x] Event type + level gán theo mô hình D49 (critical/major/minor/info)
      để sau này giao tiếp với notification center Phase 7
- [x] RBAC scope all/subtree/own cho cả station và relay
- [x] Socket.IO `quality.snapshot/updated/alert/ack`; room `station:<id>`/`relay:<id>`
- [x] Throttle ~1 s; reconnect snapshot; đổi quyền cập nhật socket

### P6-05 FE quản trị realtime (dùng foundation Phase 3.5)
- [x] Không có menu/trang Chất lượng riêng
- [x] Nhúng panel chất lượng vào popup chi tiết trạm; nút **Sửa** mở popup sửa riêng
- [x] Nhúng panel chất lượng vào popup chi tiết relay; tab upstream/downstream
- [x] Panel trạm: score, message type/rate, sat/cell, CNR, metadata, ARP
- [x] Panel relay: upstream/downstream, parity, chart score/sat/cell/CNR/age/gap
- [x] Chart vẽ theo quyết định chart lib của Phase 7 (D45 đã chốt: component
      SVG/dot-grid tự vẽ, zero-dep, không thêm dep)
- [x] Alert list/ack; loading/empty/error; responsive 1440/768/390
- [x] Playwright kiểm tra menu không còn, panel trong popup, nút Sửa tách riêng

### P6-06 Alerts, retention, export
- [x] Alert debounce 3 cửa sổ; first/last/resolved
- [x] Ack lưu admin + audit; không auto-disable job/probe
- [x] Export CSV giới hạn dòng + audit (Phase 11 bổ sung `.xlsx`/`exceljs`)
- [x] Prune sample/alert theo retention; không xóa alert đang mở
- [x] Cảnh báo kiểu caster/rover (login fail 7 biến thể, GGA out-of-range,
      GGA age/interval, out-of-zone, exit đột ngột) sinh event từ Go; Node
      tổng hợp — kế hoạch chi tiết ở Phase 10 P10-05 sau khi P6-04 có type/level

### P6-07 Test & hardening
- [x] Unit parser/quality/score; mock stream; DB down/up; restart (DB down/up PASS 2026-10-30)
- [x] Byte-exact khi analyzer chạy; queue đầy không block
- [x] Station ingest + station probe GET-only; relay upstream/downstream/parity
- [x] API/RBAC/socket/scope; không raw payload/secret trong log
- [x] Load 50 job mock: 50/50 streaming PASS; license go-rtcm Apache-2.0
- [x] Aggregate satellite/signal/cell theo chòm; constellation breakdown
- [x] Probe runner Go GET-only cho station_probes; real 2 trạm streaming
- [x] Tài liệu vận hành + cập nhật SESSION

**Nghiệm thu Phase 6:** parse đúng type chính; byte-exact; chất lượng đúng cho
cả trạm thường và trạm relay; score/alert đúng ngưỡng; realtime < 2 s;
không lộ dữ liệu ngoài scope. Đã PASS unit/Go, API/RBAC/socket Node,
Playwright UI, load 50 job, real probe 2 trạm. Taste inspect sau auth defer.

---

## 9. Phase 7–12 — Hoàn thiện phần mềm theo CGBAS (2026-10-30)

**Mục tiêu:** đưa sản phẩm từ “CRUD + realtime + quality” thành phần mềm quản
trị CORS dùng được hằng ngày: dữ liệu trạm đầy đủ, IA rõ, vận hành trạm/caster,
thông báo, quản trị hệ thống, báo cáo và hardening.

**Nguồn đối chiếu:** graphify repo hiện tại (1734 nodes/4486 edges/112
communities) và graphify CGBAS (3453 nodes/8619 edges/267 communities); mã
nguồn CGBAS tại `F:\3.Laptrinh\1. Project\1. GNSS\CGBAS\...`; ảnh UI người
dùng cung cấp. Chi tiết khảo sát/gap: `docs/0/PHASES_7_12_PLAN.md`.

**Ngoài phạm vi (không làm trong 7–12):** VRS/subnet/grid division/transfer/
subscribe; storage task dữ liệu thô (obs_type/sample rate/FTP-SFTP cron);
displacement monitor/RTK engine; expression engine kiểu SpEL; Open API khách.
CGBAS chỉ dùng để tham chiếu IA, cách tổ chức thông tin và trường dữ liệu.

### P7-00 Hotfix nhất quán (đã làm)
- [x] Đổi default port trạm/relay/DB/seed sang **1509** (form, API, schema,
      migration `admin/007_port_defaults.sql`)
- [x] `CASTER_PORT=1509` trong `.env.local`; không dùng 2101 cho caster
- [x] Bỏ menu/trang Chất lượng riêng; panel quality nằm trong popup trạm/relay

### Menu chốt
```text
Dashboard
Trạm: Bản đồ trạm | Danh sách trạm
CORS: Bản đồ online | Danh sách online | Tài khoản NTRIP | Mountpoint | Caster
Relay
Hệ thống: Phân quyền | Người dùng | Lịch sử | Cảnh báo
(Ẩn) Trang cá nhân — mở bằng avatar/tên người dùng
```

### Phase 7 — Nền tảng UI & Trạm danh sách
**Mục tiêu:** shell/menu mới + shared list/import/export + hồ sơ trạm + danh sách trạm.

- [x] P7-01 Shell/IA: menu nhóm mới; breadcrumb; topbar tên sản phẩm + user;
      bỏ footer dev; mobile drawer; entry trang cá nhân.
- [x] P7-02 Shared list framework: pagination server-side **mặc định 10**,
      luôn hiển thị; filter/page lưu URL; loading/empty/error.
- [x] P7-03 Import/export `.xlsx` bằng **`exceljs`** (D50): template, preview,
      lỗi theo dòng, transaction, audit; không export secret/password.
- [x] P7-04 Migration `admin/008_station_profile.sql`: `station_type`,
      `receiver_type`, `receiver_sn`, `receiver_firmware`, `antenna_type`,
      `antenna_sn`, `antenna_height`, `elevation_mask`, `contractor`,
      `region`, `address`, `device_id`, `network_type`, `network_mode`,
      `protocol`, `custom_fields JSON`, `enabled`, `last_seen_at`.
- [x] P7-05 Migration `admin/009_dictionary_custom_fields.sql`: `dictionaries`
      + `custom_field_defs`; seed receiver/antenna; select đọc DB.
- [x] P7-06 API trạm v2: owner name, mountpoint count, quality summary,
      last data; filter status/owner/region; audit before/after.
- [x] P7-07 Danh sách trạm: cột trạng thái, mã/tên, receiver/antenna, vị trí,
      mountpoint, dữ liệu cuối, quality; CRUD + quality + import/export.
- [x] P7-08 Form trạm nhóm: Định danh / Vị trí / Thiết bị / Kết nối / Vận hành
      / Custom fields; test connection GET-only.
- [x] P7-09 Test G7: list/pagination 10/import/export/form/menu/a11y.
- [x] P7-10 Rework nguồn trạm/1005: `source_type`, `ntrip_mode`, relay upstream
      read-only, WGS84 6 số/VN2000/ITRF, map chỉ marker 1005; Playwright 8/8.

**Nghiệm thu Phase 7:** menu mới; mọi list có pagination 10 luôn hiển thị;
import/export `.xlsx`; trạm đủ trường; test PASS.

### Phase 8 — Bản đồ & chi tiết trạm
- [x] P8-01 Bản đồ trạm Leaflet/OSM (D46), marker trạng thái, panel danh sách;
      không hiện relay.
- [x] P8-02 Popup chi tiết trạm rộng **1080px**: Tổng quan / Dữ liệu /
      Chất lượng / Lịch sử; header chỉ timestamp + trạng thái; nút Sửa mở
      popup riêng.
- [x] P8-05 Quality UI kiểu onocoy/CGBAS; cycle slip/RMS/latency từ MSM;
      Sky Plot hiện chẩn đoán nếu nguồn không phát ephemeris; neighboring stations Phase 9.
- [x] P8-03 Bản đồ online: marker chỉ tài khoản NTRIP **có gửi toạ độ**;
      badge/tổng “x tài khoản không gửi tọa độ”.
- [x] P8-04 Danh sách online: bảng chi tiết tài khoản online, filter, export;
      force disconnect nếu có quyền.
- [x] P8-06 Test G8: map/marker/popup/online list/responsive/a11y.

### Phase 9 — CORS: NTRIP, mountpoint, caster
- [x] P9-01 Tài khoản NTRIP: company/contact/phone/email/hiệu lực/max conn/
      ACL; reset password; import/export `.xlsx`; drawer phiên online.
- [x] P9-02 Mountpoint: trạm/trạng thái/auth/service type/position mode/
      satellite systems/caster interval/code protocol; import/export.
- [x] P9-03 Caster listener CRUD: name/port/role/enabled/description/mountpoints;
      import/export.
- [x] P9-04 Caster tab live: connections, bytes, uptime, force disconnect.
- [x] P9-05 Test G9: CRUD/ACL/listener/live/force disconnect/RBAC.

### Phase 10 — Relay & Hệ thống
- [x] P10-01 Relay: CRUD, quality/parity, detail 4 tab (Tổng quan / Dữ liệu /
      Chất lượng / Lịch sử), test/restart, import/export.
- [x] P10-02 Phân quyền: role CRUD, permission matrix module×action×scope,
      import/export; role hệ thống khóa.
- [x] P10-03 Người dùng: CRUD, role/parent/status/locked; import Excel **không
      cột password**, mật khẩu mặc định **123456**, audit; export không password.
- [x] P10-04 Lịch sử: Phiên/Sự kiện/Theo giờ, filter, pagination 10, export.
- [x] P10-05 Cảnh báo: level/event type/target/status/unread; filter/ack/read;
      notification center cơ bản.
- [x] P10-06 Test G10: relay/system/import user/alert/RBAC/audit.

### Phase 11 — Cá nhân, cấu hình & báo cáo
- [x] P11-01 Trang cá nhân ẩn menu: profile/avatar/email/phone/password/sessions.
- [ ] P11-02 Notification center nâng cao: All/Unread/read-all/event config/
      silence/threshold; email optional.
- [ ] P11-03 Dictionary/custom fields admin, system params, brand/logo,
      log viewer login/operate.
- [ ] P11-04 Dashboard chart/report, retention, backup/restore UI.
- [ ] P11-05 Test G11: user center/notification/config/report/retention.

### Phase 12 — Hardening, load test & release
- [ ] P12-01 Load 50–100 station/job; CPU/RAM/p95; queue/backpressure.
- [ ] P12-02 Security: RBAC scope, CSRF, HMAC, secret scan, rate limit,
      audit redaction; không log secret.
- [ ] P12-03 E2E: login/CRUD/map/station detail/online/caster/relay/system;
      a11y + responsive + dark mode.
- [ ] P12-04 Migration/backup/restore/release runbook; rollback.
- [ ] P12-05 Observability: health, logs, metrics tối thiểu.
- [ ] P12-06 Definition of Done + tag release (không push nếu chưa xác nhận).

**Nghiệm thu Phase 7–12:** mỗi phase có checklist PASS + bằng chứng; không mở
phase sau khi phase trước còn FAIL; không làm các mục ngoài phạm vi ở trên.

---

## 9.1. Cập nhật 2026-11-01 — drawer thống nhất, timeline, quality

- [x] Drawer trạm/relay dùng chung `EntityDetail`: header timestamp + trạng
      thái, 4 tab Tổng quan / Dữ liệu / Chất lượng / Lịch sử.
- [x] Timeline trạng thái: 1h/24h/7d/1m; online/offline/no-data; 10 giây
      no-data sau mất kết nối; kết nối còn nhưng không dữ liệu giữ no-data;
      chưa từng kết nối → offline; số liệu tính ở độ phân giải mịn.
- [x] Danh sách thay đổi trạng thái mới nhất trước, 10 bản ghi/lần + Xem thêm.
- [x] Chart vệ tinh/độ trễ/C/N0 không đứt đoạn, tooltip theo con trỏ; số vệ
      tinh luôn là số nguyên.
- [x] Bảng trạng thái streaming tự refetch 5–10 giây, không phụ thuộc socket.
- [x] Quality: sky plot từ ephemeris, CNR theo băng, điểm 6 thành phần;
      score realtime 5 giây; log warning `<30`, error `=0`, recovery `>=30`.
- [x] Relay: session/timeline, direction status, async downstream writer để
      downstream chậm không chặn đọc upstream; báo lỗi NTRIP rõ hơn.
- [x] NTRIP client trạm: session start/end, GGA an toàn, reconcile tức thời
      khi tắt/bật trạm.

## 9.2. Kế hoạch 07 — Menu Hệ thống & bảo trì (2026-11-01)

- [x] P07-0 Baseline & shell menu/tab: `/system` + tab Sức khỏe/Tối ưu/Tự động hóa;
      `/system/health` redirect; menu 1 mục Hệ thống; Playwright 2/2 PASS.
- [x] P07-1 DB, quyền, cấu hình: 3 bảng `maintenance_*`, 11 job, `system_ops.*`;
      migrate 034, server build, vitest 74/74 PASS.
- [x] P07-2 API Tối ưu: `GET /api/system/optimize`; vitest 80/80 PASS.
- [x] P07-3 API Tự động hóa admin: jobs/settings/runs/run + scheduler;
      vitest 88/88 PASS; runtime prune chờ P07-4.
- [x] P07-4 Go đọc cấu hình DB + retention + internal API; go test PASS;
      runtime dry-run/reconcile 200.
- [x] P07-5 Frontend Tối ưu & Tự động hóa; Playwright system-ops 2/2 PASS.
- [ ] P07-6 Test, docs, graphify, rollout.

## 10. Ghi chú điều phối

- Không chuyển phase nếu checklist chưa PASS.
- Mỗi task cập nhật trạng thái vào file này.
- Mọi thay đổi kiến trúc phải cập nhật docs v2 trước.
- Phase 6 chỉ bổ sung sau khi docs được chốt; không làm thay đổi bất biến
  Node/Go ownership hoặc đường byte RTCM.
