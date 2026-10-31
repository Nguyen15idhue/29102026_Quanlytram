# SESSION.md

## 1. Thông tin phiên

- Thời điểm: 2026-10-30 21:00 (Asia/Ho_Chi_Minh, +07:00)
- Phase hiện tại: P1.10.1 — Khắc phục trạm/kết nối/tọa độ/geo DONE; P1.11 map defer
- Trạng thái P1.0: DONE (backup/restore PASS, graphify 2364 nodes, Playwright 15/15)
- Trạng thái P1.1: DONE (migration 014–017, station_sources 39, tenant scope)
- Trạng thái P1.2: DONE (tenant RBAC, migration 018–019, server 53/53, P1 RBAC 3/3)
- Trạng thái P1.3: DONE (DataTable selection, bulk APIs, multiselect, P1 bulk 3/3)
- Trạng thái P1.4: DONE (KPI mới, counts tenant, 2 cột, P1 dashboard 2/2)
- Trạng thái P1.5: DONE (form trạm, station_sources, geo reverse, uptime, P1 station 1/1)
- Trạng thái P1.6: DONE (mountpoint tối giản, drawer, impact, listener mapping, P1 mountpoint 2/2)
- Trạng thái P1.7: DONE (account listener ACL, effective mountpoints, Go sourcetable, P1 ACL 1/1)
- Trạng thái P1.8: DONE (form relay đầy đủ, JSON import dry-run/idempotent, P1 relay 1/1)
- Trạng thái P1.9: DONE (utf8mb4, repair station notes, sạch mojibake, P1 unicode 1/1)
- Trạng thái P1.10: DONE (server 53/53, Go test/vet, Playwright 29/29, backup/restore 39/39)
- Trạng thái P1.10.1: DONE (source listener/GGA, tọa độ động, geo fallback, uptime direction, Playwright 30/30)
- Trạng thái P0 Phase 1: DONE (drawer 5 tab, API connections/history/metadata)
- Trạng thái P0 Phase 2: DONE (API list/detail, filter, drawer chuỗi)
- Trạng thái P0 Phase 3: DONE (`/map`, API overview, layer/filter, redirect cũ)
- Trạng thái P0 Phase 4: DONE (`/system/health`, 4 card, cache 12s, fallback mock)
- Trạng thái P0 Phase 5: DONE (`/api/ops/dashboard`, alert impact, 4 vùng)
- Trạng thái P0 Phase 6: DONE (menu 7 nhóm, title/active, deep link, Esc/focus)
- Trạng thái P0 Phase 7: DONE (Playwright 14/14, server 48/48, Go test/vet)
- Trạng thái P0 Phase 8: DONE (auth password-only, migration 013, Go/UI/audit PASS)
- Trạng thái P0 Phase 9: DONE (39 station/39 mountpoint, 36 password_only, 32 mapping, caster 0 fail)
- Trạng thái UI/UX review: DONE (STT, filter thu gọn, màu action/zone, hot reload Docker)
- Trạng thái Phase 0: DONE
- Trạng thái Phase 1: DONE
- Trạng thái Phase 2: DONE
- Trạng thái Phase 3: DONE
- Trạng thái Phase 3.5: DONE (UI/UX Foundation)
- Trạng thái Phase 4: DONE (mock + real allowlist 2 relay/2 station)
- Trạng thái Phase 5: DONE (realtime/dashboard/history/alerts/ops + audit)
- Trạng thái Phase 6: DONE (mock + real probe; load 50 PASS; Taste auth defer)
- Trạng thái Phase 7: DONE core + rework nguồn trạm/1005 (Playwright 8/8)
- Trạng thái Phase 8–11: DONE core (rà soát Playwright, còn defer đã ghi)
- Trạng thái Phase 12: TODO (chưa commit hardening)
- Người thực hiện: OpenCode

## 2. Trạng thái

### Đã làm
- Phase 0: tài liệu, AGENTS/TASKS/SESSION/README, `.env.example`, `.gitignore`,
  baseline relay read-only.
- Phase 1: Docker Compose, MySQL hai schema/migration, Node auth + RBAC,
  CRUD stations/mountpoints/web-users/roles, Go health, React frontend,
  API contract, seed dữ liệu test.
- Phase 2: schema relay admin/runtime, Node API relay-jobs + actions + audit,
  Go relay bridge/NTRIP/RTCM/NMEA/SOCKS5/TLS, loop guard, reconcile theo
  revision, runtime writer buffer, mock caster/rover/source + fixtures,
  test mock 2-T1..2-T9 và E2E Node -> Go -> mock.
- Phase 3: NTRIP account CRUD + ACL placeholder, import relay, retention,
  reconcile saved/applied, UI Relay/Mountpoint/TK NTRIP; xem mục 8.
- Phase 3.5: triển khai UI/UX Foundation (shell, dark mode, dialog/drawer,
  pagination, lucide, toast, a11y); xem mục 8.7.
- Phase 4: caster listener 1509/1508, auth/ACL/max conn, fan-out, slow client,
  runtime connections, UI Caster; xem mục 8.8.
- Phase 5: realtime Socket.IO, dashboard, history, alerts/ack, backup/restore,
  load test mock, ops doc; xem mục 8.9.
- Phase 6: parser/analyzer/store quality, migrations admin006/runtime004,
  REST/RBAC/socket, panel nhúng popup trạm/relay; xem mục 8.11.
- P0 Phase 1: `/stations/:id`, drawer 5 tab, transport/quality/metadata status
  độc lập, reliability, API connections/history/metadata; Playwright PASS.
- P0 Phase 2: `/mountpoints/explorer`, API list/detail join relay/listener/ACL/
  online/quality/alert, filter trạm/trạng thái/owner/alert, RBAC scope.
- P0 Phase 3: `/map` hợp nhất, marker chỉ từ 1005, layer/filter URL, panel +
  mở drawer trạm, redirect hai bản đồ cũ.
- P0 Phase 4: `/system/health`, metric Node/Host/MySQL/Go, cache 12s, fallback
  Go/MySQL down và network không hỗ trợ.
- P0 Phase 5: dashboard 4 vùng + `/api/ops/dashboard` + alert impact
  desired/applied, click mở đúng relay/trạm.
- P0 Phase 6: menu 7 nhóm, title/active menu, deep link `/stations/:id` và
  `/map?station=`, Esc/focus, mobile drawer.
- P0 Phase 7: full regression PASS (Playwright 14/14, server 48/48, Go test/vet,
  build Docker, health Node/Go).
- P0 Phase 8: `auth_mode=password_only`, hash Argon2id, Go nhận username rỗng,
  API/UI/audit không lộ hash; Go unit + API + caster thật + Playwright PASS.
- P0 Phase 9: `importLegacyCaster` dry-run/commit, 36 station/mountpoint legacy,
  password-only legacy không hash, listener 1508/1509, 32 mapping; 32 cặp
  SOURCE/POST/rover PASS.
- UI/UX review: STT toàn bộ bảng, filter thu gọn + filter backend, nút action
  có màu, Dashboard 4 vùng màu, bổ sung thông tin bảng; Docker web/server
  hot reload 1s. Playwright 15/15, server test 48/48. Chi tiết:
  `docs/1/02_CAC_BUOC_THUC_HIEN_P0.md` mục 6.

### Đang làm
- Không có.

### Tiếp theo
- P1 đã đóng. Việc tiếp theo: P1.11 bản đồ vận hành (defer, cần đọc lại
  `docs/1/02` Phase 3 và cập nhật map contract trước khi làm).

### Blocker
- Không có. `go test -race` chưa chạy được vì môi trường Windows không bật
  cgo/C compiler; đã chạy `go test ./...` và `go vet ./...`.

## 3. Baseline relay (read-only)

Đường dẫn: `F:\3.Laptrinh\1. Project\1. GNSS\relayrtcm\backup`

- Go 1.24.5, module `relayrtcm`; deps `x/net`, `modernc.org/sqlite`.
- Bản chất: NTRIP **bridge** GET upstream -> POST downstream, không phải caster.
- Bằng chứng: `main.go:690`, `main.go:724`, `main.go:1071`.
- Monitor cổng `8081`; history SQLite; không có RTCM framing/caster/ACL.
- `config.json`: 65 job, 64 bật; không đọc/in credential.
- SHA256 baseline: main.go, history.go, go.mod, config.json đã ghi ở Phase 0
  và không thay đổi.

## 4. Phase 1 — Kết quả

### 4.1. Hạ tầng
- Docker Compose: MySQL 8, migrate, Node, Go, Nginx/FE.
- MySQL `default-time-zone=+00:00`; Node/Go `TZ=Asia/Ho_Chi_Minh`.
- MySQL bind `127.0.0.1:3307`; Go internal `127.0.0.1:7080`; Node `127.0.0.1:4000`.
- Web `http://localhost:3000` (Nginx proxy `/api` -> server:4000).

### 4.2. Database
- `cors_admin`, `cors_runtime`.
- `schema_migrations(scope, version)`; admin version 1, runtime version 1.
- RBAC: `roles`, `permissions`, `role_permissions`, `web_users`, `web_sessions`.
- Nghiệp vụ: `stations` (không mountpoint), `mountpoints`, `ntrip_accounts`.
- Audit: `audit_logs` với JSON đã redact.
- Seed 3 role, 29 permission, 4 web user, 3 trạm, 3 mountpoint, 2 NTRIP account.

### 4.3. Kết quả test

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Compose up + fresh volume | PASS | MySQL healthy, migrate exit 0, server/gnss healthy |
| Node health | PASS | `{"status":"ok","db":"ok","schemaVersion":1}` |
| Go health | PASS | `{"db":"ok","schemaVersion":1,"status":"ok"}` |
| Web/Nginx | PASS | `GET :3000` 200; login qua proxy 200 |
| Login đúng/sai | PASS | đúng 200; sai 401 |
| Session logout | PASS | logout 204/200; `/api/auth/me` sau đó 401 |
| CSRF | PASS | thiếu header 403; sai header 403; fresh session |
| RBAC station scope | PASS | super=3, admin=3, user1=1; station ngoài subtree không lọt |
| RBAC web user scope | PASS | admin=3, user1=1 |
| Admin không quản lý super | PASS | PATCH super -> 403 |
| Admin tạo user level >= | PASS | 403 |
| User chỉ xem mình | PASS | GET super -> 404; list=1 |
| User add/delete | PASS | POST station -> 403; self role edit -> 403 |
| Field allowlist | PASS | user self display_name -> 200; role_id -> 403 |
| Session thu hồi khi khóa | PASS | lock -> `/me` 401 |
| Session thu hồi khi đổi mật khẩu | PASS | đổi pass -> `/me` 401 |
| CRUD web user | PASS | create/lock/unlock/delete |
| CRUD station | PASS | create/update/delete |
| CRUD mountpoint | PASS | create/update/delete |
| CRUD role + permission matrix | PASS | create role, PUT scope, GET lại, delete |
| Audit redaction | PASS | `password_hash` trong audit = `***` |
| NTRIP account không login web | PASS | 401 |
| Web account xác thực NTRIP | DEFERRED | Caster ở Phase 4 |
| Timezone DB | PASS | MySQL global/session `+00:00`; UTC timestamp |
| Timezone UI | PASS | Dashboard dùng `Asia/Ho_Chi_Minh`; build chứa timezone |
| Server unit test | PASS | Vitest 7/7 |
| Go test | PASS | `go test ./...` OK |

### 4.4. Lệnh chạy

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:7080/health
# UI: http://localhost:3000
```

Tài khoản seed nằm trong `.env.local` (không commit):
`superadmin`, `admin`, `user1`, `user2`.

### 4.5. Hạn chế / khác biệt so với checklist

- Frontend Phase 1 chỉ có Dashboard/Trạm/Web users/Roles; các menu Relay,
  Mountpoints, TK NTRIP, Kết nối, Nhật ký, Cấu hình để Phase 2+.
- Web account dùng xác thực NTRIP chưa test được vì caster ở Phase 4.
- Taste gate 0 FAIL đầy đủ để Phase 5; Phase 1 có token/layout cơ bản.
- Không import 65 trạm; chỉ seed 3 trạm test.
- Không chạm relay cũ, không chạy relay, không dùng cổng 8081/2101.

### 4.6. Rà soát Phase 1 (2026-10-30)

Rà soát toàn bộ `server/`, `gnss/`, `frontend/`, `db/`, `docker-compose.yml`
bằng Graphify + đọc mã. Đã tìm và sửa các lỗi sau:

| # | Lỗi | Sửa |
|---|---|---|
| 1 | Tạo/sửa web user với email rỗng hoặc bỏ trống trả 400 (`zod .optional().default('')` vẫn validate email) | Dùng union `'' \| email` (`lib/validation.ts`); test hồi quy |
| 2 | Có thể hạ cấp `super_admin` cuối cùng qua `PATCH /api/web-users/:id {role_id}` | Guard `LAST_SUPER_ADMIN` 409 |
| 3 | Non-super tạo/tách user bằng `parent_user_id: null` ra ngoài subtree | Trả 403 `FORBIDDEN` |
| 4 | Thiếu kiểm tra cấp bậc khi PUT/PATCH/DELETE role (nguy cơ nâng quyền) | `assertCanManageRole` cho mọi thao tác role |
| 5 | Lưu `role_permissions` (DELETE + INSERT) không transaction | Bọc `withTransaction` |
| 6 | Audit/session ghi IP của nginx thay vì client | `app.set('trust proxy', 1)` |
| 7 | `mountpoints` không kiểm tra `owner_web_user_id` tồn tại | Trả 400 `INVALID_OWNER` |

Bằng chứng kiểm tra sau sửa:

| Mục | Kết quả |
|---|---|
| `server` tsc build | PASS |
| Vitest | PASS 9/9 (thêm test email) |
| `frontend` `npm run build` | PASS |
| `go test ./...` | PASS |
| Rebuild + restart `server` (Compose) | PASS; health `ok`, schema 1 |
| Tạo web user email rỗng | PASS 201 (trước đó 400) |
| Tạo web user bỏ trống email | PASS 201 |
| Hạ cấp super_admin cuối | PASS 409; role giữ `super_admin` |
| Admin tạo user `parent_user_id=null` | PASS 403 |
| Mountpoint owner không tồn tại | PASS 400 `INVALID_OWNER` |
| Admin list stations (subtree) | PASS total=3 |
| Secret trong repo | Không có (`git grep`) |

Không chạm relay backup, không dùng cổng 8081/2101.

## 5. Quyết định đã chốt

- D1–D24 giữ nguyên theo `docs/0/KE_HOACH_CHI_TIET.md`.
- Auth web: session cookie + CSRF; không JWT.
- MySQL only; hai schema; Go ghi runtime, Node ghi admin.
- Timezone: lưu UTC; hiển thị +07.
- RBAC mặc định super_admin/admin/user; custom role level 1–99.
- Web account và NTRIP account tách biệt.

## 6. Rủi ro đang theo dõi

- Phase 2 cần mock-first; không chạm caster thật.
- Secret trong `.env.local` phải giữ ngoài git.
- NTRIP account vs web account cần test đầy đủ khi có caster.
- Docker image build lần đầu khá lâu; nên build trên CI/máy local.

## 7. Phase 2 — Kết quả

### 7.1. Data model & API
- Migration `db/migrations/admin/002_relay.sql`: `relay_credentials`,
  `relay_jobs` (unique `external_key`, unique cặp endpoint, soft-delete,
  `desired_revision`).
- Migration `db/migrations/runtime/002_relay_runtime.sql`: `relay_job_state`,
  `relay_sessions`, `relay_events`, `relay_hourly`; `runtime_meta=2`.
- API Node `/api/relay-jobs`: list/detail/create/patch/soft-delete +
  enable/disable/restart/test; audit redacted; không trả secret.
- Internal API Go: reconcile/test/snapshot, ký HMAC + timestamp + nonce.
- Reconcile theo `desired_revision`; Go ghi `applied_revision`,
  `runtime_state`, `last_error`.
- Endpoint key chuẩn hóa `scheme://host:port/mount`; self-loop + DFS cycle.

### 7.2. Go bridge
- `internal/ntrip`: NTRIP v1 ICY, v2 HTTP/chunked, GET, POST, SOURCE,
  auto fallback, Basic auth, TLS (RootCAs injectable), SOURCETABLE reject.
- `internal/relay`: bridge byte-copy, metrics, backoff/jitter, NMEA,
  loop guard, manager, bounded runtime writer, `service_restart`.
- `internal/rtcm`: CRC24Q, resync, bounded buffer, counts only (không sửa byte).
- `internal/proxy`: SOCKS5 (no-auth + auth config), lỗi không lộ credential.
- `internal/secret`: AES-256-GCM `v1:nonce:cipher:tag`.
- `internal/api`: HMAC, ±60s, nonce replay 2 phút, health schema >= 2.

### 7.3. Mock & E2E
- `scripts/mock-ntrip`: caster/source/rover, chunked, fragment, delay,
  repeat, capture; bind mặc định loopback.
- Fixtures: `rtcm3-valid.hex`, `rtcm3-badcrc.hex`.
- `scripts/e2e-relay-mock.ps1`: login superadmin -> tạo job có credential ->
  Go stream mock -> capture byte-exact -> state streaming -> test action ->
  disable -> soft-delete; kiểm tra API không lộ secret.

### 7.4. Bằng chứng kiểm thử

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Migration SQL fresh (temp schema) | PASS | admin 12 bảng, runtime 5 bảng, `runtime_meta=2` |
| Migration idempotent (Compose) | PASS | `[migrate] done admin=0 runtime=0` |
| Node health | PASS | `schemaVersion=2`, `db=ok` |
| Go health | PASS | `schemaVersion=2`, `db=ok` |
| Node tsc | PASS | `npx tsc --noEmit` sạch |
| Node Vitest | PASS | 19/19 (relay 10 + rbac 9) |
| Go test | PASS | relay/ntrip/rtcm/nmea/secret/proxy/config |
| Go vet | PASS | `go vet ./...` sạch |
| Go TLS handshake | PASS | `TestGetTLS` với CA cục bộ |
| Go SOCKS5 | PASS | `TestSOCKS5NoAuthDial` |
| Byte-exact 1KB/1MB | PASS | `Test2T1ByteExactSource/Post` |
| Mảnh read / nhiều frame | PASS | `Test2T2`, `Test2T3` |
| Slow client | PASS | `Test2T5` (4MB, client chậm không chặn job khác) |
| Reconnect/backoff/timeout | PASS | `Test2T4`, `backoff_test` |
| Go restart `service_restart` | PASS | `Test2T6` |
| DB down/up không chặn RTCM | PASS | `Test2T7`, `writer_test` |
| Loop/self-loop | PASS | `Test2T8`, `loopguard_test` |
| Không lộ secret | PASS | `Test2T9`, E2E kiểm tra response/log |
| Streaming state | PASS | `TestOnFirstByteFiresOnce`, E2E `state=streaming` |
| Disable không bị ghi đè | PASS | `TestDisabledStateNotOverwrittenByStopped` |
| E2E mock | PASS | job 5/6/7: capture byte-exact, streaming, test OK, disable + soft-delete |
| RBAC list relay scope | PASS | admin subtree + user1 own list 200; sửa cột owner bị ambiguous khi JOIN credential |
| Compose rebuild | PASS | migrate/server/gnss rebuilt, containers healthy |

### 7.5. Lệnh chạy

```bash
cd gnss && go test ./... && go vet ./...
cd server && npx tsc --noEmit && npm test
docker compose build migrate server gnss
docker compose run --rm migrate
docker compose up -d --force-recreate server gnss
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-relay-mock.ps1
```

### 7.6. Ghi chú / hạn chế

- `APP_ENC_KEY` cũ trong `.env.local` không giải mã đủ 32 byte; đã xoay sang
  key base64 32 byte (chỉ `.env.local`, không commit). Credential cũ (nếu có)
  sẽ không giải mã được với key mới.
- E2E dùng `host.docker.internal:2102`; không dùng cổng `8081`/`2101`.
- Mock chỉ kiểm tra byte/handshake, không mô phỏng đầy đủ RTCM message semantics.
- Loop guard chỉ phát hiện vòng nội bộ theo endpoint key; không phát hiện vòng
  qua hệ thống ngoài.
- `go test -race` chưa chạy do thiếu cgo/C compiler trên Windows.
- Job/credential E2E đã dọn khỏi DB test; audit giữ lại.

### 7.7. Bổ sung kế hoạch Phase 6 (2026-10-30)

- Thêm kế hoạch **RTCM Analytics & chất lượng trạm/relay**:
  `docs/0/RTCM_QUALITY_PLAN.md`.
- Dùng `github.com/go-gnss/rtcm` (Apache-2.0, package `rtcm3`) để parse-only.
- Chất lượng dùng chung theo `target_type` + `target_id` + `direction`:
  - `station` + `ingest`: trạm thường, từ caster ingest hoặc station probe GET-only.
  - `relay_job` + `upstream/downstream`: trạm relay, thêm chỉ số `parity`.
- Có backend tổng hợp, API, Socket.IO realtime và FE quản trị hai tab Trạm/Relay.
- Không sửa byte RTCM, không lưu raw payload, không auto-disable job/probe.
- Đã cập nhật `KE_HOACH_CHI_TIET.md`, `TASKS.md`, `CAC_BUOC_THUC_HIEN.md`,
  `docs/api.md`, `AGENTS.md`, `README.md`.
- Chưa triển khai code Phase 6; chỉ chốt kế hoạch/task.

## 8. Phase 3 — Kết quả

### 8.1. Đã làm
- NTRIP account CRUD + lock/unlock + owner scope + ACL placeholder
  (`account_mountpoint_acl`); API/UI tách khỏi web account.
- Sửa scope list mountpoint bị ambiguous khi JOIN stations.
- Import relay: `server/src/db/importRelay.ts`; `--dry-run/--ids/--force`,
  transaction, idempotent, disabled, `source_sha256`, không log secret.
- Retention Go: prune sessions/events/hourly theo batch, không xóa session mở.
- Reconcile saved/applied: UI Relay hiển thị state + applied/desired; Go down/up.
- UI thêm Relay, Mountpoint, TK NTRIP; menu Phase 3.
- Migration `admin/003_ntrip_acl.sql`; health Node schema 3.

### 8.2. Bằng chứng test

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Node tsc | PASS | `npx tsc --noEmit` |
| Node Vitest | PASS | 21/21 |
| Frontend build | PASS | `npm run build` |
| NTRIP API + ACL | PASS | create/list/ACL/lock/unlock/delete; adminMp=3, userMp=1 |
| Audit redaction | PASS | audit ntrip_account leak=0 |
| Import dry-run | PASS | selected=2, created=2 |
| Import create/skip/force | PASS | created=1 → skipped=1 → updated=1; enabled=0; sha; creds `v1:` |
| Reconcile Go down/up | PASS | desired=2, applied=2, state=backoff |
| Retention integration | PASS | `TestPruneOnceMySQL`: old deleted, new/open kept |
| Delete close reason | PASS | `TestDeleteClosesSessionWithDeletedReason` |
| Go test/vet | PASS | `go test ./...`, `go vet ./...` |
| Migration | PASS | `[migrate] admin 003_ntrip_acl.sql applied` |

### 8.3. Ghi chú
- Không test caster thật, không dùng cổng 8081/2101.
- Browser smoke UI chưa tự động; chỉ build PASS.
- Import dùng fixture `scripts/fixtures/relay-config.sample.json`.
- Test data import/reconcile/NTRIP đã dọn; audit giữ lại.

### 8.4. Fix review 2026-10-30 (soft-delete re-tạo job)
- Lỗi 1: unique index `external_key` + `(upstream_key, downstream_key)` chặn
  tạo lại job trùng cấu hình sau soft-delete (tái hiện `ERROR 1062
  uq_relay_jobs_endpoints`). Fix: khi soft-delete, Node đổi 3 key thành
  `…#deleted:<id>` (lib `tombstone.ts`, dùng chung DELETE route + import).
- Lỗi 2: import `--force` UPDATE nhầm row đã soft-delete. Fix:
  `importRelay.ts` lọc `deleted_at IS NULL` và tombstone row cũ trước INSERT.
- docs/api.md mục 10 ghi rõ hành vi giải phóng key sau DELETE.
- Bằng chứng: Vitest 21/21 (+2 test tombstone); SQL probe trên `relay_jobs`
  thật: recreate OK; E2E API `scripts/e2e-softdelete-recreate.ps1`:
  create id=14 → delete → recreate id=15 OK; probe đã dọn khỏi DB.

### 8.5. Bổ sung kế hoạch UI/UX Phase 3.5 (2026-10-30)

- Đánh giá UI hiện tại: form CRUD inline, không icon, không phân trang, shell
  cuộn cùng menu, dùng `window.confirm`, thiếu drawer/detail/toast/a11y.
- Chốt hướng **`framed-sheet`** (seed 973367273): shell cố định, white sheet,
  IBM Plex Sans/Mono, `lucide-react` monochrome, một accent.
- Chốt pattern: Dialog/Drawer/AlertDialog, DataTable + server pagination,
  search debounce + URL state, loading/empty/error/toast, keyboard/a11y.
- Dark mode: `system` mặc định + toggle `light/dark`; token dark, `color-scheme`,
  chống FOUC; test contrast cả 2 theme.
- Phase 3.5 làm trước Phase 4; Phase 4/5/6 dùng lại foundation.
- Chi tiết: `docs/0/UI_UX_PLAN.md`; đã cập nhật KE_HOACH/TASKS/CAC_BUOC/AGENTS.

### 8.6. Phê duyệt triển khai & đổi port caster (2026-10-30)

- Đã duyệt: Q1–Q7, Q11; Q8 backup path
  `F:\3.Laptrinh\1. Project\1. GNSS\Backup`; Q9 load test 20; Q10 allowlist
  endpoint thật (credential chỉ dùng ngoài repo); Q3 đồng ý go-rtcm.
- Đổi mặc định caster: **1509** cho source + rover, tùy chỉnh theo listener;
  nhóm mountpoint many-to-many (ví dụ A,B,C→1509; A,C→1508).
- Không dùng 2101/8081; migration Phase 6 admin phải đổi số vì 003 đã dùng.
- Đã cập nhật `KE_HOACH`, `TASKS`, `CAC_BUOC`, `docs/api.md`, `README`,
  `AGENTS`, `.env.example`; chưa chạy code/test.
- Q10 credential/endpoint không ghi vào repo/docs/log.

### 8.7. Phase 3.5 — Kết quả triển khai (2026-10-30)

- Shell `framed-sheet` cố định; sidebar 228px + topbar 48px; content scroll;
  mobile drawer.
- Dark mode `system/light/dark` + token + chống FOUC + toggle lưu localStorage.
- Component layer: Button/IconButton, Field/Input/Select, Modal/Drawer,
  AlertDialog, Toast, DataTable, Pagination, SearchInput, StatusBadge.
- Refactor Stations/Mountpoints/Relay/NTRIP/WebUsers/Roles/Dashboard:
  bỏ form inline + `window.confirm`; CRUD dialog/drawer; server pagination + URL.
- Icon lucide monochrome; IBM Plex Sans/Mono self-host.

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Frontend build | PASS | `npm run build` |
| Playwright | PASS | 2/2: CRUD light/dark + mobile drawer |
| inspect login | PASS | 0 FAIL; WARN hero-void/tiny-text (login compact) |
| Auth pages | PASS | screenshot light/dark/mobile trong `frontend/test-results` |
| Server regression | PASS | tsc + Vitest 21/21 |
| Go regression | PASS | `go test ./...`, `go vet ./...` |
| Docker web | PASS | rebuild + health 200 |

- Defer: dirty guard, filter nâng cao, recent activity; không chặn Phase 4.
- `inspect.mjs` không hỗ trợ auth; trang sau đăng nhập kiểm bằng Playwright.

### 8.8. Phase 4 — Kết quả (2026-10-30)

- Caster Go: listener 1509/1508, SOURCE/POST/GET, v1/v2, chunked,
  SOURCETABLE, Basic auth Argon2, ACL, max connections, fan-out,
  slow-client drop, source conflict, disconnect, runtime connections.
- Migration `admin/004_caster.sql` + `runtime/003_caster_runtime.sql` applied;
  seed listener 1509; health Node 4 / Go 3.
- Node API `/api/caster` + `/api/connections`; UI Caster (listener,
  mountpoint mapping, connections) dùng foundation Phase 3.5.
- Hot reload Vite: `usePolling=true`, interval 1000ms cho Windows.
- Test: Go caster 7 test PASS; E2E source/rover 1509 byte-exact PASS;
  Node tsc + Vitest 21/21; frontend build; Playwright 2/2.
- Q10 integration allowlist chưa chạy (defer); không dùng credential thật.
- Docker Compose publish 1509/1508 cho caster.

### 8.9. Phase 5 — Kết quả (2026-10-30)

- Migration `db/migrations/admin/005_alerts_settings.sql`: `alerts`, `settings`,
  permission `alerts.view`/`alerts.ack`; admin schema 5.
- Realtime: `server/src/realtime/*`, Socket.IO path `/socket.io`, auth session
  cookie, room `user:<id>`, subscribe `relay:<id>`/`caster` có kiểm tra quyền;
  poll Go internal 1 s; payload lọc scope; sự kiện `snapshot`, `relay.updated`,
  `relay.session`, `connection.updated`, `alert.created`, `auth.revoked`.
- API: `GET /api/snapshot`, `GET /api/alerts`, `POST /api/alerts/:id/ack`,
  `GET /api/history/{sessions,events,hourly}`; RBAC + pagination/filter.
- Alert polling: relay `backoff`/`error`, Go/caster unavailable; cooldown 5 phút;
  không auto-disable.
- UI: Dashboard realtime (KPI + trạng thái relay), trang Cảnh báo + ack,
  trang Lịch sử (3 tab), nav Phase 5; Vite/Nginx proxy `/socket.io`.
- Ops: `scripts/backup-mysql.ps1`, `scripts/restore-mysql.ps1` (path
  `F:\3.Laptrinh\1. Project\1. GNSS\Backup`), `scripts/load-test-mock.ps1`
  (20 job + 20 rover mock, cổng 2102); `docs/OPS.md`; log rotation Docker;
  rate limit login 10/phút, API 300/phút; body limit 256 KB.

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Node tsc | PASS | `server: npx tsc --noEmit` |
| Node Vitest | PASS | 29/29 (realtime 8 + rbac 9 + relay 12) |
| Frontend build | PASS | `frontend: npm run build` |
| Go regression | PASS | `go test ./...`, `go vet ./...` |
| Migration | PASS | `[migrate] admin 005_alerts_settings.sql applied`; health Node 5 |
| Socket unauth | PASS | `connect_error UNAUTHENTICATED` |
| Socket auth/reconnect | PASS | snapshot + reconnect snapshot; room `relay:40` OK |
| Scope payload | PASS | super stations=3, user1 stations=1; relay/alert ngoài scope ẩn |
| Role change | PASS | user1 role user→super_admin: socket stations 1→3; đã revert |
| Logout/revoke | PASS | socket nhận `auth.revoked` sau logout |
| alert.created | PASS | insert alert → socket event đúng id (đã dọn) |
| Alert create/ack | PASS | backoff tạo alert; super ack 200; user1 ack 403 |
| History API | PASS | sessions/events/hourly total 26/6/21; filter jobId OK (đã dọn job/alert test sau kiểm chứng) |
| Playwright | PASS | realtime.spec.ts 2/2 (reconnect offline + user scope) |
| Backup/restore | PASS | backup zip SHA256; restore -Force; health Node/Go OK |
| Load test | PASS | 20/20 relay streaming trên mock 2102 |
| Secret scan | PASS | không có secret/dump trong diff repo |

- Lệnh kiểm tra chính:

```bash
cd server && npx tsc --noEmit && npm test
cd frontend && npm run build
cd frontend && npx playwright test tests/realtime.spec.ts
cd gnss && go test ./... && go vet ./...
docker compose run --rm migrate
docker compose up -d --force-recreate server web
powershell -File scripts/backup-mysql.ps1
powershell -File scripts/restore-mysql.ps1 -BackupFile <zip> -Force
powershell -File scripts/load-test-mock.ps1 -Jobs 20
```

- Defer: Role UI nâng cao/audit API; Taste `inspect.mjs` sau đăng nhập;
  Q10 allowlist thật. Phase 6 đã triển khai mock, xem mục 8.11.
- Không dùng endpoint thật/credential thật; không bind 2101/8081; không commit
  dump backup.

### 8.10. Khảo sát CGBAS & cập nhật kế hoạch (2026-10-30)

- Khảo sát đối chiếu tính năng CGBAS (CORS management platform 上海华测导航
  技术股份有限公司, Trung Quốc) → báo cáo tổng hợp trong hội thoại; không thêm code.
- Kết luận: UI foundation (3.5) đã đạt chuẩn app-screen; khoảng cách là
  **nội dung nghiệp vụ** (bản đồ, biểu đồ, notification center, dictionary
  trạm, export/import, log viewer), không phải khung UX.
- Thêm **Phase 7–12 — hoàn thiện theo CGBAS** (roadmap):
  - A quick win: export Excel `.xlsx` (`exceljs`), log viewer, user center,
    brand runtime, dirty-guard.
  - B (đè P6): notification center + event config (không làm expression
    engine), cảnh báo caster/rover, dictionary trạm, statistical graph.
  - C đã chốt mở (bổ sung cùng phiên): D45 chart lib=(a), D46 map+tiles=(a),
    D47 i18n=(đóng).
  - D roadmap xa: VRS/NRTK, storage file thô, displacement monitor, Open API.
- Thêm quyết định D44–D49 vào
  `KE_HOACH_CHI_TIET.md` §2; thêm §7.11 + dòng Phase 7 ở §14 lộ trình.
- `TASKS.md`: bảng phase + checklist Phase 7–12; P6-04/P6-05/P6-06 ghi chú
  giao tiếp với Phase 9/11 (type/level alert, chart/export dùng chung).
- `CAC_BUOC_THUC_HIEN.md`: bảng phase + gate G7–G12 (NOT RUN).
- `RTCM_QUALITY_PLAN.md`: mục 12 ghi phụ thuộc Phase 9/11.
- Không học từ CGBAS: password plaintext, i18n lệch menu/route,
  trang có bundle không menu.
- **Chốt quyết định (2026-10-30 16:10):** D45=(a) chart tự vẽ SVG zero-dep;
  D46=(a) `leaflet` + tile OSM công cộng (attribution bắt buộc, không key
  thương mại), map tách Phase 8 (P8-01); D47=(đóng) i18n postpone,
  reopen khi có khách EN. Nhóm C mở trong Phase 7–8. `AGENTS.md` §3 bổ sung dòng
  Chart + Map để khớp quy ước "lib mới phải qua quyết định".

### 8.11. Phase 6 — Kết quả (2026-10-30)

- Triển khai parser/analyzer/store quality Go, migration `admin/006`,
  `runtime/004`, REST/RBAC/socket Node, panel quality FE.
- **Sửa theo yêu cầu UI:** bỏ menu/route `/quality`; nhúng `QualityPanel`
  vào popup chi tiết trạm/relay. Bấm trạm → popup có quality; bấm **Sửa**
  → popup sửa riêng. Xóa `frontend/src/pages/Quality.tsx`.
- Rebuild web Docker; health Node `schemaVersion=6`.
- Test: `go test ./...` PASS; `npm test` server 33/33 PASS; Playwright 5/5
  PASS (quality embedded, edit tách, mobile/dark mode).
- Đã bổ sung: probe runner Go, aggregate chòm sao, audit API/tab Audit,
  load 50 job PASS, real 2 relay/2 station streaming, DB down/up PASS.
- Còn defer: Taste `inspect.mjs` sau auth (Phase 8 UI).

### 8.12. Khảo sát CGBAS lần 2 & roadmap 7–12 (2026-10-30)

- Cập nhật graphify repo: **1734 nodes / 4486 edges / 112 communities**
  (code-only; docs semantic chưa chạy).
- Đối chiếu graphify CGBAS: **3453 nodes / 8619 edges / 267 communities**;
  trích route/menu và trường dữ liệu từ chunk `station-manage`,
  `station-overview`, `data-inspect`, `station-control`, `notification-center`,
  `dictionary`, `user-manage`, `operate-log`, `user-center`, `broadcast-*`.
- Kết luận: UI hiện tại sơ sài do **dữ liệu trạm quá mỏng + IA phẳng**, không
  chỉ do CSS. CGBAS có hồ sơ trạm đầy đủ, menu nhóm, notification center,
  dictionary/custom fields, log viewer, user center, map/online user.
- Đã sửa ngay: default port trạm/relay/DB/seed/API/form → **1509**; thêm
  `db/migrations/admin/007_port_defaults.sql`; `.env.local` CASTER_PORT=1509.
- Tài liệu mới: `docs/0/PHASES_7_12_PLAN.md` (audit + gap + **đặc tả UI/field
  theo nhóm** + roadmap).
- Menu chốt: Dashboard; Trạm (Bản đồ trạm, Danh sách trạm); CORS (Bản đồ
  online, **Danh sách online**, Tài khoản NTRIP, Mountpoint, Caster); Relay;
  Hệ thống (Phân quyền, Người dùng, Lịch sử, Cảnh báo); trang cá nhân ẩn menu.
- Quyết định mới: D50 `exceljs` cho `.xlsx`; D51 online map chỉ marker tài
  khoản có toạ độ + tổng số tài khoản không gửi tọa độ + menu Danh sách online;
  D52 import user không cột password, mật khẩu `123456`; D53 caster listener
  CRUD + tab live/force disconnect.
- Cập nhật `TASKS.md`, `KE_HOACH` §7.11/§14, `CAC_BUOC`, `UI_UX_PLAN`,
  `RTCM_QUALITY_PLAN` §12, `README`, `AGENTS`.
- Đã hoàn thiện tồn đọng Phase 4–6:
  - Probe runner Go đọc `station_probes`, GET-only, feed quality station.
  - Aggregate satellite/signal/cell theo chòm; station 79 = 31 SV, station 80 = 38 SV.
  - Audit API `/api/audit-logs` + tab Audit + recent activity dashboard; sửa role.
  - Load test mock 50 job: 50/50 streaming PASS.
  - Giữ 2 relay + 2 station + 2 probe đang bật; config thật ở `secrets/` (ignored).
- Quyết định UI: drawer trạm 1080px; metric thiếu dữ liệu disabled; Sky Plot
  thật/cycle slip/RMS/latency/neighboring stations chuyển Phase 8–9.
- Chưa triển khai code Phase 7; thứ tự: 7 (UI/list/trạm) → 8 (map/detail/online)
  → 9 (CORS) → 10 (Relay/Hệ thống) → 11 (cá nhân/config/report) → 12 (hardening).

### 8.13. Phase 7 — Kết quả core (2026-10-30)

- Thêm `exceljs`; import/export `.xlsx` cho trạm: preview, lỗi dòng, transaction, audit.
- Migration `admin/008_station_profile.sql`, `admin/009_dictionary_custom_fields.sql` đã apply.
- API trạm v2: owner name, mountpoint count, quality summary, last data; filter q/region/owner/receiver.
- Menu nhóm mới; bỏ footer dev; pagination mặc định 10; dirty guard.
- Form trạm nhóm: Định danh / Vị trí / Thiết bị / Kết nối; select dictionary.
- Test: Go PASS, Node 33/33, Playwright 5/5; export/import dry-run 5 dòng PASS.
- Defer Phase 8: test connection GET-only, bản đồ, drawer 1080, quality UI.

### 8.14. Phase 8 — Kết quả core (2026-10-30)

- Thêm Leaflet + OSM: `/stations/map`, `/online/map`, `/online`.
- Drawer trạm rộng 1080px, tab Tổng quan/Kết nối/Chất lượng; nút Sửa tách riêng.
- Quality panel: KPI score/availability/min, constellation breakdown, metric nâng cao disabled.
- Online map chỉ marker tài khoản có tọa độ; hiển thị tổng số không gửi tọa độ.
- Online list: bảng kết nối, search, force disconnect nếu có quyền.
- Test: Playwright map + quality PASS; Go/Node PASS.
- Defer: Sky Plot thật/cycle slip/RMS/latency/neighboring stations (Phase 8–9).

### 8.15. Phase 9 — Kết quả core (2026-10-30)

- Migration `admin/010_ntrip_mount_profile.sql`: company/contact/email/phone/
  hiệu lực/khu vực/auth method/notes cho NTRIP; service type/position mode/
  satellite systems/caster interval/code protocol/type/description cho mountpoint.
- API NTRIP/mountpoint trả và nhận trường mới; UI form đã bổ sung nhóm trường.
- Caster đã có listener CRUD + tab connections/force disconnect từ Phase 4.
- Test: Go/Node PASS; Playwright 6/6; API NTRIP/mountpoint trả fields mới.
- Defer: import/export `.xlsx` cho NTRIP/mountpoint (Phase 10/11).

### 8.16. Phase 10 — Kết quả core (2026-10-30)

- Migration `admin/011_alerts_event.sql`: event_type/level/unread/read_at.
- Alerts API lọc level/eventType/unread; thêm read-all/read.
- User import/export `.xlsx`: không cột password, mật khẩu mặc định `123456`.
- History đã có Audit; roles đã có sửa role từ Phase 5.
- Test: import dry-run 4 user PASS; alerts trả level/eventType; Playwright 6/6.
- Defer: import/export relay/role; notification center nâng cao/event config.

### 8.17. Phase 11 — Kết quả core (2026-10-30)

- Thêm `/api/profile`: xem/cập nhật hồ sơ, đổi mật khẩu, danh sách phiên.
- Trang `/profile` ẩn menu; mở bằng tên người dùng trên topbar.
- Đổi mật khẩu xóa các phiên khác; audit thao tác.
- Test API profile/sessions PASS; frontend build PASS.
- Defer: notification center nâng cao/event config, dictionary admin,
  system params/brand/logo, log viewer, dashboard report/retention.

### 8.18. Rework Phase 7 — nguồn trạm, 1005/1006 và Playwright (2026-10-30)

- Migration `admin/012_station_source.sql`: thêm `source_type`
  (`relay_caster|caster_ingest|probe_client|manual`), `ntrip_version` (mặc định v1),
  `ntrip_mode` (`v1_noauth|v1_auth|v2_auth|ntrip_client`); suy ra từ relay job
  cho trạm đang được relay cấp dữ liệu.
- API `/api/stations`: trả `relay_job_id/name`, upstream host/port/mount,
  `ntrip_version`, `ntrip_mode`; đọc `arp_x/y/z` từ quality sample 1005/1006,
  chuyển ECEF -> WGS84 bằng `server/src/lib/geo.ts`, tính VN2000 TM 105° và
  ITRF ECEF; không fallback `lat/lon` nhập tay.
- UI trạm: list/detail hiển thị nguồn “NTRIP caster (relay)”, NTRIP version/mode,
  relay job, Relay upstream host read-only; toạ độ WGS84 6 chữ số, VN2000,
  ITRF; form giữ Vĩ độ/Kinh độ nhưng read-only.
- Bản đồ trạm/online dùng `reported_lat/reported_lon`; trạm chưa có 1005
  hiển thị “Chưa có 1005” và không đặt marker.
- CORS: NTRIP account list/detail hiển thị công ty/liên hệ/hiệu lực/khu vực/
  auth method; mountpoint list/detail hiển thị service/position/satellite/
  caster interval/code protocol.
- Alerts: bổ sung filter `level`, `unread`, hiển thị `eventType`/unread và nút
  “Đánh dấu đã đọc”.
- FE tối ưu: lazy-load `StationMap`/`OnlineMap`, tách Leaflet khỏi bundle chính
  (main ~442 kB, Leaflet ~150 kB chunk).
- Fix mojibake toàn bộ chuỗi tiếng Việt trong `WebUsers.tsx`.
- Sửa tên trạm bị mất dấu trong DB (audit qua API): `SLA Mộc Châu`,
  `THA Hậu Lộc`, `Trạm test Hà Nội 01/02`, `Trạm test Đà Nẵng 01`.
- Playwright: `workers: 1` để tránh rate limit login 10/phút; thêm
  `station-source.spec.ts`, `phase7-11.spec.ts`; tổng **8/8 PASS**.

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Migration | PASS | `[migrate] admin 012_station_source.sql applied` |
| Trạm relay | PASS | THA_HauLoc: source `relay_caster`, v2, relay job #93 |
| Toạ độ 1005 | PASS | WGS84 `19.999947, 105.969244`, ITRF/VN2000 có giá trị |
| Server build/test | PASS | tsc + Vitest 35/35 (thêm geo) |
| Go regression | PASS | `go test ./...` |
| Frontend build | PASS | Vite build, không cảnh báo chunk >500 kB |
| Playwright | PASS | 8/8 (map, phase7-11, quality, realtime, station-source, ui) |
| Web rebuild | PASS | container web healthy, UI tiếng Việt đúng |

### 8.19. Bổ sung chỉ số quality nâng cao (2026-10-30)

- Parse MSM4/MSM7 observation (code, phase, lock, half-cycle, CNR) trong Go;
  tính **Latency**, **Cycle slip**, **Code & Phase RMS** từ dữ liệu thực.
- API `/api/stations/:id/quality` và `/api/relay-jobs/:id/quality` trả thêm
  `latencyMs`, `cycleSlips`, `cycleSlipRate`, `codePhaseRmsM`,
  `codePhaseSamples`, `observations`, `skyPlotAvailable`, `skyPlotReason`.
- QualityPanel bỏ 4 nút disabled/“đang để Phase 8–9”; hiển thị số thực:
  - Latency: tuổi dữ liệu + điểm latency.
  - Cycle slip: số slip và % trên observation.
  - Code & Phase RMS: RMS biến thiên code-phase (m).
  - Sky Plot: nếu thiếu ephemeris 1019/1020/1045/1046 thì hiện đúng lý do,
    không vẽ vị trí giả.
- Kiểm chứng real station 80: latency ~0.7 s, cycle slip ~0.7%,
  code-phase RMS ~0.03 m, cửa sổ 300 mẫu RMS.
- Test: Go quality PASS; Node 35/35; frontend build PASS; Playwright
  station-source PASS (gồm assert 4 heading quality nâng cao).

### 8.20. Quét caster `rtktk.online` 1509/1508 (2026-10-31)

- Relay config cập nhật: `db/data/config.json` **67 job (66 bật)**, 67 credential
  upstream, 62 downstream, không SSL.
- Quét NTRIP sourcetable (không dùng credential): 1509 có **26** mountpoint,
  1508 có **6**; gộp không phân biệt hoa/thường được **36 trạm**.
- 5 trạm chỉ có trong relay config (chưa thấy ở sourcetable): `DTP_TanHong`,
  `GLI2`, `HUG_ViThuy`, `PYN_SongHinh`, `YBI_NghiaLo`.
- 4 mountpoint chỉ có trong sourcetable: `BG.TP`, `hauloc`, `MocChautest`,
  `TNN_DaiTu`; `BG.TP` -> station code `BG_TP`.
- Sourcetable động (`BG.TP` lúc có lúc không); toạ độ trả `0.00` nên file import
  để trống lat/lon.
- File: `db/data/caster_stations.xlsx` (import trạm), `caster_stations.csv/json`,
  `caster_mountpoints.csv/xlsx`, `sourcetable_1509/1508.txt`,
  `caster_scan_summary.md`; script `scripts/scan-caster-stations.mjs`.
- Lưu ý: xlsx chỉ tạo station; chưa tạo mountpoint/account/ACL/listener.

### 8.21. Kiểm tra stream `hauloc` và `MocChautest` (2026-10-31)

- Kết nối NTRIP `rtktk.online:1509`, dùng tài khoản được cấp (không lưu
  credential), đọc 60 giây mỗi mountpoint.
- `hauloc`: `ICY 200 OK`; 264 frame, CRC lỗi **0**; 1006/1033 12 frame,
  MSM 1074/1084/1094/1124 mỗi loại 60 epoch; gap epoch **0**.
  1006 st483: `19.999947, 105.969244`, h `-8.87 m`, antenna `0.41 m`.
- `MocChautest`: `ICY 200 OK`; 265 frame, CRC lỗi **0**;
  1006/1033 12 frame, MSM mỗi loại 60 epoch; gap epoch **0**; thêm 1 frame
  proprietary 4063. 1006 st224: `20.846817, 104.639403`, h `804.11 m`,
  antenna `2.46 m`.
- Kết luận: RTCM hợp lệ, không mất epoch/CRC; throughput ~940 B/s và ~770 B/s.
- Lưu ý: caster trả body dạng chunked (`\r\n<size>\r\n`) dù không có header
  `Transfer-Encoding`; probe bỏ qua 420 byte chunk header/60 giây. Nếu đọc raw
  TCP phải dechunk trước khi chuyển tiếp.
- Bằng chứng: `db/data/probes/probe_hauloc.json`,
  `probe_MocChautest.json` (bản timestamp kèm theo).

### 8.22. Tạo tài liệu các bước thực hiện P0 (2026-10-31)

- Thêm `docs/1/02_CAC_BUOC_THUC_HIEN_P0.md`: 13 phase từ baseline, P0.1–P0.6,
  chốt auth P0.11, provision P0.7/P0.12, HTTPS, load test, backup/rollback và
  cutover; mỗi phase có mục tiêu, giải thích đơn giản, việc làm, yêu cầu,
  checklist test và ghi chú.
- Ghi rõ trạng thái hiện tại: P0.1–P0.12 **chưa hoàn tất**; P0.9 mới có load
  test 50 job; P0.1–P0.6 chưa có route/API.
- Thêm `.gitignore` cho `db/data/config.json` (chứa credential relay) để không
  commit nhầm.
- Kiểm tra: server build PASS; Vitest **35/35 PASS**; frontend build PASS;
  `go test ./...` + `go vet ./...` PASS.
- Chưa chạy Playwright trong lần cập nhật này; chưa commit/push.

## 9. Nhật ký thay đổi

| Giai đoạn | File/khu vực | Ghi chú |
|---|---|---|
| Phase 0 | AGENTS/TASKS/SESSION/README/.env.example/.gitignore | Đã commit |
| Phase 1 | `docker-compose.yml`, `db/`, `server/`, `gnss/`, `frontend/` | Skeleton + RBAC |
| Phase 1 | `docs/api.md`, `.env.example`, `.gitattributes` | API contract, env, LF |
| Phase 1 | `server/src/routes/webUsers.ts`, `roles.ts`, `mountpoints.ts`, `app.ts`, `lib/validation.ts` | Rà soát + sửa 7 lỗi |
| Phase 2 | `db/migrations/*/002_*`, `server/src/routes/relayJobs.ts`, `server/src/lib/*` | Schema + API relay |
| Phase 2 | `gnss/internal/{relay,ntrip,rtcm,nmea,secret,proxy,api}`, `cmd/corsd` | Bridge + HMAC |
| Phase 2 | `scripts/mock-ntrip`, `scripts/fixtures`, `scripts/e2e-relay-mock.ps1` | Mock + E2E |
| Phase 6 | `docs/0/RTCM_QUALITY_PLAN.md`, `KE_HOACH`, `TASKS`, `CAC_BUOC`, `api.md` | Kế hoạch chất lượng trạm/relay |
| Phase 3 | `server/src/routes/ntripAccounts.ts`, `db/migrations/admin/003_*` | NTRIP + ACL |
| Phase 3 | `server/src/db/importRelay.ts`, `scripts/fixtures/relay-config.sample.json` | Import relay |
| Phase 3 | `gnss/internal/relay/retention*.go`, `cmd/corsd` | Retention |
| Phase 3 | `frontend/src/pages/{RelayJobs,Mountpoints,NtripAccounts}.tsx` | UI Phase 3 |
| Phase 3 | `server/src/lib/tombstone.ts`, `routes/relayJobs.ts`, `db/importRelay.ts`, `docs/api.md` | Fix soft-delete chặn recreate + import force row xóa |
| Phase 3.5 | `docs/0/UI_UX_PLAN.md`, `KE_HOACH`, `TASKS`, `CAC_BUOC`, `AGENTS` | Kế hoạch UI/UX Foundation |
| Phase 3.5 | `frontend/src/theme`, `components/{ui,Layout,ThemeToggle,ToastProvider}.tsx`, `styles.css` | Shell + dark mode + components |
| Phase 3.5 | `frontend/src/pages/*`, `lib/useListParams.ts` | Refactor CRUD/pagination |
| Phase 3.5 | `frontend/tests/ui.spec.ts`, `playwright.config.ts` | Playwright 2/2 |
| Phase 4 | `db/migrations/{admin/004,runtime/003}_caster*.sql` | Caster schema + listener 1509 |
| Phase 4 | `gnss/internal/caster`, `cmd/corsd`, `internal/api` | Caster Go + internal API |
| Phase 4 | `server/src/routes/caster.ts`, `lib/caster.ts`, `app.ts` | Caster API |
| Phase 4 | `frontend/src/pages/Caster.tsx`, `App.tsx`, `Layout.tsx` | Caster UI |
| Phase 4 | `frontend/vite.config.ts` | Hot reload polling 1s |
| Phase 5 | `db/migrations/admin/005_alerts_settings.sql` | Alerts/settings + permission |
| Phase 5 | `server/src/realtime/*`, `routes/{alerts,history,snapshot}.ts`, `lib/alerts.ts` | Socket.IO + API Phase 5 |
| Phase 5 | `frontend/src/realtime/*`, `pages/{Dashboard,Alerts,History}.tsx`, `Layout/App/types`, proxy | UI realtime/history/alerts |
| Phase 5 | `scripts/{backup,restore,load-test}-*.ps1`, `docs/OPS.md`, `docs/api.md` | Ops + tài liệu |
| Phase 5 | `server/tests/realtime.test.ts`, `frontend/tests/realtime.spec.ts` | Test realtime/scope/socket |
| Phase 6 | `gnss/internal/quality/*`, `db/migrations/{admin/006,runtime/004}_*` | Parser/analyzer/store + schema |
| Phase 6 | `server/src/{routes/quality.ts,lib/quality.ts,lib/csv.ts,realtime/qualityBus.ts}` | REST/RBAC/socket quality |
| Phase 6 | `frontend/src/components/{QualityPanel,charts}.tsx`, `pages/{Stations,RelayJobs}.tsx` | Panel nhúng popup, bỏ menu quality |
| Phase 6 | `frontend/tests/quality.spec.ts`, `server/tests/quality.test.ts` | Test UI embedded + API |
| Hotfix | `frontend/Stations.tsx`, `server/routes/{stations,relayJobs}.ts`, `admin/001,002,007`, `seed.ts`, `.env.local` | Default port 1509 |
| Phase 6 | `gnss/internal/probe/*`, `gnss/cmd/corsd/main.go`, `quality/{analyzer,parse}.go` | Probe runner + aggregate chòm sao |
| Phase 5 | `server/src/routes/audit.ts`, `frontend/src/pages/{History,Dashboard,Roles}.tsx` | Audit API/tab + sửa role + recent activity |
| Test | `scripts/load-test-mock.ps1` 50 job | 50/50 streaming PASS; real 2 relay/2 station |
| Docs | `docs/0/PHASES_7_12_PLAN.md`, `TASKS`, `KE_HOACH`, `CAC_BUOC`, `UI_UX_PLAN`, `RTCM_QUALITY_PLAN`, `README`, `AGENTS`, `SESSION` | Menu/UI field spec + quyết định D50–D53 |

## 10. Cập nhật lần cuối

- 2026-10-31 18:00 +07:00
