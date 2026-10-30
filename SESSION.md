# SESSION.md

## 1. Thông tin phiên

- Thời điểm: 2026-10-30 11:00 (Asia/Ho_Chi_Minh, +07:00)
- Phase hiện tại: Phase 2 — DONE; chuẩn bị Phase 3
- Trạng thái Phase 0: DONE
- Trạng thái Phase 1: DONE
- Trạng thái Phase 2: DONE
- Trạng thái Phase 6: PLANNED (kế hoạch, chưa triển khai)
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

### Đang làm
- Không có (Phase 2 đã đóng).

### Tiếp theo
- Phase 3 — Quản trị trạm & relay ổn định.
- Phase 6 (bổ sung) — RTCM Analytics & chất lượng trạm/relay; xem mục 7.7.

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

## 8. Nhật ký thay đổi

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

## 9. Cập nhật lần cuối

- 2026-10-30 11:00 +07:00
