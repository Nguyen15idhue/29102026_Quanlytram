# SESSION.md

## 1. Thông tin phiên

- Thời điểm: 2026-10-30 09:34 (Asia/Ho_Chi_Minh, +07:00)
- Phase hiện tại: Phase 1 — Skeleton & hợp đồng dữ liệu
- Trạng thái Phase 0: DONE
- Trạng thái Phase 1: DONE
- Người thực hiện: OpenCode

## 2. Trạng thái

### Đã làm
- Phase 0: tài liệu, AGENTS/TASKS/SESSION/README, `.env.example`, `.gitignore`,
  baseline relay read-only.
- Phase 1: Docker Compose, MySQL hai schema/migration, Node auth + RBAC,
  CRUD stations/mountpoints/web-users/roles, Go health, React frontend,
  API contract, seed dữ liệu test.

### Đang làm
- Không có (Phase 1 đã đóng).

### Tiếp theo
- Phase 2 — Port relay & test mock.

### Blocker
- Không có.

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

## 7. Nhật ký thay đổi

| Giai đoạn | File/khu vực | Ghi chú |
|---|---|---|
| Phase 0 | AGENTS/TASKS/SESSION/README/.env.example/.gitignore | Đã commit |
| Phase 1 | `docker-compose.yml`, `db/`, `server/`, `gnss/`, `frontend/` | Skeleton + RBAC |
| Phase 1 | `docs/api.md`, `.env.example`, `.gitattributes` | API contract, env, LF |
| Phase 1 | `server/src/routes/webUsers.ts`, `roles.ts`, `mountpoints.ts`, `app.ts`, `lib/validation.ts` | Rà soát + sửa 7 lỗi |

## 8. Cập nhật lần cuối

- 2026-10-30 09:56 +07:00
