# CÁC BƯỚC THỰC HIỆN (v2)
## Hệ thống quản lý trạm CORS / NTRIP / RTCM (MVP)

> **Phiên bản 2** — cập nhật theo review kỹ thuật. Thay thế v1.
> Mỗi phase gồm: giải thích · công việc · yêu cầu cần đạt · checklist test · kết quả test · ghi chú.
>
> **Bảo mật:** Không ghi credential thật vào tài liệu/log/git. Dùng `.env.local` (gitignore).

---

## 0. Cách dùng

### 0.1. Trạng thái
| Ký hiệu | Ý nghĩa |
|---|---|
| `TODO` | Chưa bắt đầu |
| `DOING` | Đang làm |
| `DONE` | Hoàn thành, có bằng chứng test |
| `BLOCKED` | Bị chặn |
| `SKIP` | Bỏ qua có lý do |

### 0.2. Quy tắc test
- Điền `PASS/FAIL/BLOCKED/NOT RUN` + bằng chứng (log, screenshot, commit).
- Không đánh `PASS` khi chưa chạy.
- `docker compose up` thành công **không** đủ chứng minh hệ thống đúng.
- Test NTRIP thật chỉ sau khi mock đạt và endpoint được phép.

### 0.3. Tiến độ
| Phase | Tên | Trạng thái |
|---|---|---|
| 0 | Chuẩn bị & xác minh | DOING |
| 1 | Skeleton & hợp đồng dữ liệu | TODO |
| 2 | Port relay & test mock | TODO |
| 3 | Quản trị trạm & relay ổn định | TODO |
| 4 | NTRIP caster & quản lý client | TODO |
| 5 | Realtime, dashboard, vận hành | TODO |

---

# PHASE 0 — Chuẩn bị & xác minh (read-only)

**Mục tiêu:** Chốt tài liệu, inventory, quyết định; không viết code ứng dụng.

**Giải thích:** Phase này giảm rủi ro hiểu sai. Relay cũ chỉ được đọc; không chạy test thật.

## 0.1. Công việc
- [x] `docs/0/KE_HOACH_CHI_TIET.md` (v2)
- [x] `docs/0/CAC_BUOC_THUC_HIEN.md` (v2)
- [ ] `AGENTS.md` (quy tắc, lệnh test, cấu trúc)
- [ ] `TASKS.md` (backlog theo phase)
- [ ] `SESSION.md` (trạng thái phiên)
- [ ] `README.md` (cách chạy)
- [ ] `.env.example` (tên biến; `TZ`/`APP_TIMEZONE`; không giá trị thật)
- [ ] `.gitignore` (`node_modules`, `.env*`, `graphify-out`, `.taste-skill`, `dist`, `*.db`)
- [ ] Inventory relay cũ (đọc-only): tính năng, config, test hiện có
- [ ] Danh sách quyết định còn thiếu (auth, ownership, API, timezone, import)

## 0.2. Yêu cầu cần đạt
- Tài liệu không mâu thuẫn; có revision log.
- Không có secret trong repo.
- Không sửa/dừng relay cũ.

## 0.3. Checklist test
- [ ] `git status` không có `.env.local`
- [ ] Grep repo không có credential thật
- [ ] Tài liệu mở đúng encoding
- [ ] Relay cũ không bị thay đổi (so sánh mtime/hash)

## 0.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 0-T1 | Tài liệu v2 | `ls docs/0` | 2 file .md | NOT RUN | |
| 0-T2 | Không lộ secret | grep | 0 match | NOT RUN | |
| 0-T3 | Relay cũ nguyên vẹn | hash/mtime | không đổi | NOT RUN | |

## 0.5. Ghi chú
- Không tạo file rỗng chỉ để “đủ kiến trúc”.
- Không test thật ở phase này.

---

# PHASE 1 — Skeleton & hợp đồng dữ liệu

**Mục tiêu:** Dựng khung chạy end-to-end; chốt auth, schema, ownership, API contract trước CRUD lớn.

**Giải thích:** Đây là “hợp đồng” giữa frontend/backend/Go. Sai ở đây sẽ phải sửa nhiều lần.

## 1.1. Công việc

### A. Hạ tầng
- [ ] `docker-compose.yml`: MySQL 8, Node, Go, FE (dev), network nội bộ
- [ ] MySQL volume + healthcheck; `default-time-zone=+00:00`
- [ ] `TZ=Asia/Ho_Chi_Minh`, `APP_TIMEZONE=Asia/Ho_Chi_Minh` cho Node/Go (hiển thị/log)
- [ ] Ports: FE 5173/3000, Node 4000, Go 7080, MySQL 3307→3306
- [ ] Không public MySQL/Go internal ra ngoài
- [ ] `.env.example` + `.env.local`
- [ ] Bật Docker Desktop

### B. Database & ownership
- [ ] Hai tập migration: `db/migrations/admin/`, `db/migrations/runtime/`
- [ ] `schema_migrations(scope, version)`; hai version riêng
- [ ] Tạo `cors_admin`, `cors_runtime`
- [ ] User `cors_app` (RW admin, RO runtime), `cors_relay` (RW runtime, RO admin)
- [ ] Bảng RBAC: `roles`, `permissions`, `role_permissions`, `web_users`, `web_sessions`
- [ ] Bảng nghiệp vụ: `stations` (không có `mountpoint`), `mountpoints`, `ntrip_accounts`
- [ ] Trường sở hữu: `owner_web_user_id`, `created_by` trên các bảng nghiệp vụ
- [ ] Seed role: `super_admin` 100, `admin` 50, `user` 10
- [ ] Seed permission `view/add/edit/delete` + scope `none`
- [ ] Seed super_admin đầu tiên (đổi mật khẩu lần đầu)
- [ ] Go kiểm tra schema `runtime` version

### C. Auth & RBAC nền
- [ ] **Session cookie** server-side + CSRF (không JWT)
- [ ] Argon2id; `HttpOnly`, `SameSite=Lax`, `Secure` khi HTTPS
- [ ] Thu hồi session khi khóa/đổi mật khẩu; timeout
- [ ] `auth/me` trả role + permission/scope matrix
- [ ] Middleware `requirePermission(module, action)` + resolve scope
- [ ] Filter dữ liệu theo scope trong query
- [ ] Chống nâng quyền; field allowlist khi tự sửa
- [ ] Audit redaction (không secret)

### D. API contract
- [ ] Chốt bảng endpoint (mục 8 tài liệu kế hoạch)
- [ ] Không dùng hai kiểu `/api/relay-jobs` và `/api/relay/jobs`
- [ ] Chuẩn lỗi JSON; status code; pagination
- [ ] OpenAPI/Swagger hoặc `docs/api.md` ngắn

### E. Go service
- [ ] `cmd/corsd` + `/health`
- [ ] Kết nối MySQL runtime + ping + schema check
- [ ] Graceful shutdown; chưa cần NTRIP

### F. Frontend
- [ ] React + Vite + TS + Router + TanStack Query
- [ ] Menu: Dashboard · Trạm · Relay · Mountpoints · TK NTRIP · Người dùng web · Vai trò & quyền · Kết nối · Nhật ký · Cấu hình
- [ ] Login, Dashboard shell, Stations list/detail
- [ ] Web users + Roles (ma trận quyền + scope)
- [ ] Loading/empty/error; ẩn/hiện nút theo `auth/me`
- [ ] Design tokens (taste, app screen)

### G. Dữ liệu test
- [ ] Seed 2–3 trạm; 2–3 mountpoint (không import 65)
- [ ] Seed 1 super_admin, 1 admin, 2 user (subtree) để test scope

## 1.2. Yêu cầu cần đạt
- `docker compose up` OK; health Node/Go OK.
- Login/logout/session hoạt động; sai mật khẩu 401.
- CRUD trạm/mountpoint/web user/role hoạt động.
- RBAC đúng: super_admin full; admin subtree, không quản lý super_admin; user own.
- Tài khoản web ≠ NTRIP account.
- Timezone: lưu UTC, hiển thị +07.
- API contract thống nhất.

## 1.3. Checklist test
- [ ] Compose Up, health 200
- [ ] Login đúng/sai; session thu hồi khi logout
- [ ] CSRF: request thiếu token bị chặn
- [ ] super_admin full; admin subtree; user own
- [ ] admin sửa/xóa super_admin → 403
- [ ] admin tạo user level ≥ mình → 403
- [ ] user tự sửa `role_id`/`status` → 403
- [ ] Dữ liệu trả về không chứa bản ghi ngoài scope
- [ ] Web/NTRIP auth chéo → 401
- [ ] Timezone: DB UTC; UI +07
- [ ] API contract khớp frontend/backend

## 1.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 1-T1 | Compose/health | docker/curl | Up, 200 | NOT RUN | |
| 1-T2 | Login/session | UI/curl | 200, cookie | NOT RUN | |
| 1-T3 | CSRF | curl thiếu token | 403 | NOT RUN | |
| 1-T4 | super_admin | API/UI | full | NOT RUN | |
| 1-T5 | admin subtree | API/UI | đúng scope | NOT RUN | |
| 1-T6 | admin vs super | API | 403 | NOT RUN | |
| 1-T7 | user own | API/UI | chỉ mình | NOT RUN | |
| 1-T8 | field allowlist | API | 403 field nhạy cảm | NOT RUN | |
| 1-T9 | Dữ liệu ngoài scope | API | không xuất hiện | NOT RUN | |
| 1-T10 | Web/NTRIP chéo | API/NTRIP | 401 | NOT RUN | |
| 1-T11 | Timezone | DB/UI | UTC/+07 | NOT RUN | |
| 1-T12 | API contract | review | thống nhất | NOT RUN | |

## 1.5. Ghi chú
- Không làm relay/caster.
- Auth chốt session cookie; không đổi giữa chừng.
- UI chưa cần hoàn thiện; design ở Phase 5.

---

# PHASE 2 — Port relay & test mock

**Mục tiêu:** Port relay bridge sang Go; chứng minh byte-exact và các hành vi bằng mock. **Chưa chạm dịch vụ thật.**

**Giải thích:**
- Bridge: GET upstream (rover) → ghi nguyên byte → POST/SOURCE downstream (source).
- Mock caster + mock rover cho phép test lặp lại, không ảnh hưởng production.
- RTCM monitor chỉ parse để đếm; không sửa byte.

## 2.1. Công việc

### A. Data model & API
- [ ] `relay_credentials`, `relay_jobs` (config), `relay_job_state` (runtime)
- [ ] `relay_sessions`, `relay_events`, `relay_hourly`
- [ ] `desired_revision`, `applied_revision`, `runtime_state`, `last_error`
- [ ] Unique index `(external_key)`, `(upstream_key, downstream_key)`
- [ ] `deleted_at` (soft delete)
- [ ] API CRUD `/api/relay-jobs` + actions enable/disable/restart/test
- [ ] Không trả secret; chỉ `hasSecret` + `username`

### B. Go bridge
- [ ] GET upstream, POST downstream, `ICY 200`, chunked
- [ ] SOCKS5 proxy, TLS, backoff, byte counters, last-data
- [ ] NMEA GGA/GSA/RMC + jitter + device UA
- [ ] `downstream_mode=auto`: POST → fallback `SOURCE`
- [ ] RTCM monitor: preamble/len/CRC24Q; counters; buffer giới hạn + resync
- [ ] Ghi runtime MySQL theo batch; buffer giới hạn
- [ ] Đọc config RO; reconcile theo revision

### C. Mock & fixtures
- [ ] Mock caster (v1/v2), mock rover, mock source
- [ ] Fixtures RTCM3 hợp lệ + CRC sai
- [ ] Script test byte-exact, mảnh read, nhiều frame/read
- [ ] Script slow client

### D. Loop guard
- [ ] Key endpoint: `scheme + host + port + mount` chuẩn hóa
- [ ] Self-loop + DFS cycle nội bộ
- [ ] Unique index; Go kiểm tra lại khi load
- [ ] Ghi rõ giới hạn: không phát hiện cycle ngoài hệ thống

### E. Test mock (bắt buộc)
- [ ] Byte-in == byte-out
- [ ] Reconnect/backoff/timeout
- [ ] Chunked; nhiều frame/read; CRC sai
- [ ] Slow client không làm nghẽn
- [ ] Go restart: session cũ đóng `service_restart`; tự reconnect
- [ ] DB down/up: buffer giới hạn; không chặn RTCM

## 2.2. Yêu cầu cần đạt
- Mock pass toàn bộ; không cần dịch vụ thật.
- Byte-exact; monitor không ảnh hưởng tốc độ.
- Reconcile desired/applied rõ ràng.
- Loop guard hoạt động; giới hạn được ghi rõ.

## 2.3. Checklist test
- [ ] Byte-exact 1 KB/1 MB
- [ ] Mảnh read 1 byte/frame; nhiều frame/read
- [ ] CRC sai → counter tăng, byte vẫn pass
- [ ] Dữ liệu rác/mất đồng bộ → parser resync, không treo/không tăng RAM vô hạn
- [ ] Reconnect sau đóng socket
- [ ] Slow client bị drop/queue, không nghẽn
- [ ] Go restart khi đang stream
- [ ] DB down 30 s rồi up; buffer không unbounded
- [ ] Self-loop/cycle bị chặn
- [ ] Log không secret

## 2.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 2-T1 | Byte-exact | mock | in==out | NOT RUN | |
| 2-T2 | Fragmented/multi | mock | đúng frame | NOT RUN | |
| 2-T3 | CRC sai | mock | counter tăng | NOT RUN | |
| 2-T4 | Reconnect | mock | tự nối lại | NOT RUN | |
| 2-T5 | Slow client | mock | không nghẽn | NOT RUN | |
| 2-T6 | Go restart | kill/start | session đóng đúng | NOT RUN | |
| 2-T7 | DB down/up | stop/start | không chặn RTCM | NOT RUN | |
| 2-T8 | Loop guard | self/cycle | chặn | NOT RUN | |
| 2-T9 | Secret log | grep | 0 match | NOT RUN | |

## 2.5. Ghi chú
- Không dùng rtktk hay bất kỳ caster thật ở phase này.
- Nếu mock chưa đạt, **không** chuyển Phase 3.

---

# PHASE 3 — Quản trị trạm & relay ổn định

**Mục tiêu:** Hoàn thiện CRUD, import có kiểm soát, RBAC scope, reconcile Node–Go, soft-delete, history. Chưa cần caster.

**Giải thích:** Đây là phần “quản trị” thực sự: ai được thấy gì, sửa gì; cấu hình đã lưu có được Go áp dụng chưa; xóa job có giữ lịch sử không.

## 3.1. Công việc

### A. CRUD & RBAC
- [ ] Stations/mountpoints CRUD; bỏ `stations.mountpoint`
- [ ] Relay job CRUD + soft delete
- [ ] `owner_web_user_id` + `created_by`; scope all/subtree/own
- [ ] NTRIP account CRUD (tách web) + owner + ACL placeholder
- [ ] Web user/role CRUD; field allowlist; chống nâng quyền
- [ ] Audit redaction; append-only

### B. Import
- [ ] Script import chạy trên Windows host (hoặc mount read-only)
- [ ] `--dry-run`, `--ids`, `--force`; transaction; idempotent
- [ ] Mặc định disabled; `source_sha256`; không log secret
- [ ] Chỉ import 2–3 job test

### C. Reconcile
- [ ] Node lưu config + tăng `desired_revision` trong transaction
- [ ] Gọi `POST /internal/reconcile`
- [ ] Go đọc revision, áp dụng, ghi `applied_revision/runtime_state/last_error`
- [ ] Node phân biệt “đã lưu” vs “đã áp dụng”
- [ ] Retry khi Go down; idempotent
- [ ] UI hiển thị trạng thái pending/streaming/error

### D. History & cleanup
- [ ] Sessions/events/hourly; retention
- [ ] Xóa job: dừng, đóng socket, `close_reason='deleted'`, giữ history
- [ ] Prune theo batch; không xóa session mở

## 3.2. Yêu cầu cần đạt
- CRUD + RBAC scope đúng; dữ liệu trả về không ngoài scope.
- Import đúng 2–3 job disabled; không mất field kết nối.
- Reconcile thấy rõ saved vs applied; retry khi Go down.
- Xóa job không mất history; session đóng đúng.

## 3.3. Checklist test
- [ ] admin subtree; user own; super full
- [ ] admin không quản lý super_admin
- [ ] user field allowlist
- [ ] Import dry-run khớp số job; job disabled
- [ ] Sửa job → desired_revision tăng → applied_revision cập nhật
- [ ] Go down → UI pending; Go up → applied
- [ ] Soft delete → history còn; session close_reason=deleted
- [ ] Audit không chứa password/hash/token

## 3.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 3-T1 | RBAC scope | API/UI | đúng | NOT RUN | |
| 3-T2 | Field allowlist | API | 403 | NOT RUN | |
| 3-T3 | Import dry-run | script | khớp | NOT RUN | |
| 3-T4 | Import disabled | DB | enabled=false | NOT RUN | |
| 3-T5 | Reconcile | API/DB | applied cập nhật | NOT RUN | |
| 3-T6 | Go down/up | stop/start | pending→applied | NOT RUN | |
| 3-T7 | Soft delete | API/DB | history còn | NOT RUN | |
| 3-T8 | Audit redaction | DB | 0 secret | NOT RUN | |

## 3.5. Ghi chú
- Không bật job thật trong phase này.
- Không xóa audit; không cascade history khi soft delete.

---

# PHASE 4 — NTRIP caster & quản lý client

**Mục tiêu:** Caster tự phát mountpoint; quản lý NTRIP account/ACL/giới hạn; mock trước khi mở cổng thật.

**Giải thích:** Source đẩy dữ liệu lên mountpoint; rover kết nối vào. Cần v1 legacy/v1 auth/v2, fan-out, slow-client policy.

## 4.1. Công việc
- [ ] Listener 2101 (configurable)
- [ ] Parse `SOURCE` (v1), `POST` (v2), `GET` (rover); phân biệt ngữ cảnh response
- [ ] `ICY 200` / `HTTP 200` / `SOURCETABLE 200` đúng ngữ cảnh
- [ ] Auth Basic; no-auth chỉ khi cấu hình rõ ràng
- [ ] Fan-out + queue giới hạn + drop slow client
- [ ] ACL + max connections
- [ ] NTRIP account RBAC (`ntrip_accounts.*`) + owner scope
- [ ] `connections` runtime; disconnect chủ động
- [ ] RTCM monitor; counters
- [ ] Mock caster/rover cho caster mới

## 4.2. Yêu cầu cần đạt
- Mock: v1 legacy/v1 auth/v2; multi-client; ACL; max conn; slow client.
- Không để client chậm làm nghẽn.
- Byte passthrough nguyên vẹn.
- Chỉ mở cổng thật sau khi mock pass.

## 4.3. Checklist test
- [ ] v1 legacy / v1 auth / v2 auth
- [ ] Source uplink + rover
- [ ] 3 rover cùng mountpoint
- [ ] Sai mountpoint 404; sai auth 401; sai ACL 403
- [ ] Vượt max conn bị từ chối
- [ ] Slow client bị drop, client khác OK
- [ ] Admin disconnect
- [ ] CRC sai không crash
- [ ] NTRIP account không login web

## 4.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 4-T1 | v1 legacy | mock rover | ICY 200 | NOT RUN | |
| 4-T2 | v1 auth | mock | 200 | NOT RUN | |
| 4-T3 | v2 auth | mock | 200 | NOT RUN | |
| 4-T4 | Multi-client | 3 rover | cùng data | NOT RUN | |
| 4-T5 | ACL/max | mock | 403/từ chối | NOT RUN | |
| 4-T6 | Slow client | mock | không nghẽn | NOT RUN | |
| 4-T7 | Disconnect | API | rớt | NOT RUN | |
| 4-T8 | Web/NTRIP chéo | API | 401 | NOT RUN | |

## 4.5. Ghi chú
- Không sửa 1005/VRS trong MVP.
- Không mở cổng public khi chưa có firewall/rate limit.

---

# PHASE 5 — Realtime, dashboard, vận hành

**Mục tiêu:** Realtime đúng quyền; dashboard/history/alert; backup/restore; load test; tài liệu vận hành.

**Giải thích:** Go đẩy event sang Node; Node phát Socket.IO. Reconnect tải snapshot. Vận hành phải có bằng chứng.

## 5.1. Công việc

### A. Realtime
- [ ] Socket auth bằng session cookie
- [ ] Room `user:<id>`; room tài nguyên sau kiểm tra quyền
- [ ] Không dùng room role cho dữ liệu nhạy cảm
- [ ] Lọc payload theo scope
- [ ] Đổi role/ownership → cập nhật/ngắt socket
- [ ] Throttle ~1 s; payload có `ts`
- [ ] `/api/snapshot` + reconnect

### B. Dashboard/UI
- [ ] Dashboard tổng trạm/relay/client/alert
- [ ] History sessions/events/timeline
- [ ] Alert + ack
- [ ] Role UI nâng cao + audit
- [ ] Loading/empty/error; confirm thao tác nguy hiểm
- [ ] Taste `inspect.mjs --app` 0 FAIL 1440/768/390
- [ ] Test luồng + phân quyền + a11y (không chỉ 0 FAIL)

### C. Ops/hardening
- [ ] Rate limit login/API; body size limit
- [ ] OWASP cơ bản; secret scan
- [ ] Backup/restore MySQL + kiểm chứng
- [ ] Health check + log rotation
- [ ] Tài liệu vận hành
- [ ] Load test 50–100 job + 50 rover
- [ ] Xác minh license thư viện thực tế

## 5.2. Yêu cầu cần đạt
- Realtime < 2 s; reconnect snapshot đúng.
- Không lộ dữ liệu ngoài scope qua socket.
- Backup/restore thành công; secret scan 0.
- Load test đạt ngưỡng; không crash.
- UI đạt 0 FAIL + test chức năng.

## 5.3. Checklist test
- [ ] Bật/tắt job → UI < 2 s
- [ ] Reconnect → snapshot đúng
- [ ] User không quyền join room → bị từ chối
- [ ] Đổi quyền khi socket mở → dữ liệu cũ không còn
- [ ] Alert mất data
- [ ] Role UI + audit
- [ ] Taste 0 FAIL
- [ ] Backup/restore
- [ ] Secret scan 0
- [ ] Load test không crash

## 5.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 5-T1 | Realtime | UI | <2 s | NOT RUN | |
| 5-T2 | Reconnect | ngắt mạng | snapshot đúng | NOT RUN | |
| 5-T3 | Room ACL | socket | bị từ chối | NOT RUN | |
| 5-T4 | Đổi quyền | role change | mất quyền cũ | NOT RUN | |
| 5-T5 | Alert | ngắt data | alert | NOT RUN | |
| 5-T6 | Role UI/audit | UI/DB | đúng, có audit | NOT RUN | |
| 5-T7 | Taste | inspect | 0 FAIL | NOT RUN | |
| 5-T8 | Backup/restore | script | dữ liệu đúng | NOT RUN | |
| 5-T9 | Secret scan | scan | 0 | NOT RUN | |
| 5-T10 | Load test | script | không crash | NOT RUN | |

## 5.5. Ghi chú
- Không tuyên bố tính năng chưa test.
- VRS/1005 cần thiết kế riêng.
- Graphify cập nhật sau thay đổi cấu trúc lớn.

---

# PHỤ LỤC A — Lệnh thường dùng

```bash
docker compose up -d
docker compose ps

npm run migrate
cd gnss && go test ./...
cd server && npm test
cd frontend && npm test

# Mock NTRIP
go run ./scripts/mock-caster
go run ./scripts/mock-rover

# Timezone
docker compose exec mysql mysql -e "SELECT @@global.time_zone, @@session.time_zone, NOW();"

# Taste
node ~/.config/opencode/skills/design-taste-frontend/scripts/inspect.mjs <url> --app

# Graphify (sau Phase 1, không trỏ backup relay)
graphify update .
```

---

# PHỤ LỤC B — Biến môi trường (tên)

```
TZ=Asia/Ho_Chi_Minh
APP_TIMEZONE=Asia/Ho_Chi_Minh
MYSQL_TIMEZONE=+00:00
NTRIP_TEST_HOST
NTRIP_TEST_PORT
NTRIP_TEST_VERSION
NTRIP_TEST_USER
NTRIP_TEST_PASS
```

> Không commit `.env.local`. Không in giá trị ra log/report.

---

# PHỤ LỤC C — Mẫu báo cáo test

```
Phase:
Ngày:
Người test:
Commit:
Môi trường:

Kết quả:
- 2-T1 PASS — byte-exact 1 MB
- 2-T2 PASS — 10.000 frame, 1 byte/read
...

Lỗi còn tồn:
- ...

Cách chạy lại:
- ...
```

---

# PHỤ LỤC D — Định nghĩa “Done”

1. Yêu cầu cần đạt thoả.
2. Checklist test chạy, có PASS/FAIL + bằng chứng.
3. Không còn FAIL chưa xử lý (hoặc có issue ghi lại).
4. Không secret trong diff.
5. Diff review.
6. Tài liệu cập nhật.

---

# PHỤ LỤC E — Ma trận RBAC mặc định

**Scope:** `all` > `subtree` > `own` > `none`. `subtree` = bản thân + cấp dưới; áp dụng theo `owner_web_user_id`.

| Module | Hành động | super_admin | admin | user |
|---|---|---|---|---|
| `web_users` | view | all | subtree | own |
| `web_users` | add | all | subtree | none |
| `web_users` | edit | all | subtree | own (allowlist) |
| `web_users` | delete | all | subtree | none |
| `roles` | view | all | all | none |
| `roles` | add/edit/delete | all | none | none |
| `ntrip_accounts` | view | all | subtree | own |
| `ntrip_accounts` | add/edit/delete | all | subtree | none |
| `stations` | view | all | subtree | own |
| `stations` | add/edit/delete | all | subtree | none |
| `mountpoints` | view | all | subtree | own |
| `mountpoints` | add/edit/delete | all | subtree | none |
| `relay` | view | all | subtree | own |
| `relay` | add/edit/delete | all | subtree | none |
| `connections` | view | all | subtree | own |
| `connections` | delete | all | subtree | none |
| `settings` | view/edit | all | view | none |
| `audit` | view | all | subtree | none |

**Bất biến**
- `super_admin` không bị admin sửa/xóa/khóa.
- Không tạo/sửa user level ≥ mình (trừ super_admin).
- Không gán role level cao hơn mình.
- Không xóa super_admin cuối cùng; không tự khóa mình.
- Mặc định `none`; audit mọi thay đổi quyền.
- Web account ≠ NTRIP account.

---

# PHỤ LỤC F — Checklist test thật có kiểm soát

Chỉ dùng sau khi Phase 2 mock đạt:
- [ ] Upstream đã được xác nhận quyền đọc (bằng văn bản).
- [ ] Downstream đã được xác nhận quyền ghi (hoặc mock downstream).
- [ ] Không trùng endpoint với relay cũ đang chạy.
- [ ] Chỉ 1 job; tăng dần sau khi đạt.
- [ ] Có thời điểm bắt đầu/kết thúc, người chịu trách nhiệm.
- [ ] Có lệnh cleanup + xác nhận không còn socket/row.
- [ ] Không log credential.
- [ ] Nếu quá 3 lần thất bại liên tiếp → dừng, báo cáo.
