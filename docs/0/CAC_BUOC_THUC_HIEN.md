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
| 0 | Chuẩn bị & xác minh | DONE |
| 1 | Skeleton & hợp đồng dữ liệu | DONE |
| 2 | Port relay & test mock | DONE |
| 3 | Quản trị trạm & relay ổn định | DONE |
| 3.5 | UI/UX Foundation | DONE |
| 4 | NTRIP caster & quản lý client | DONE |
| 5 | Realtime, dashboard, vận hành | TODO |
| 6 | RTCM Analytics & chất lượng trạm/relay | TODO |

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
- [x] Stations/mountpoints CRUD; bỏ `stations.mountpoint`
- [x] Relay job CRUD + soft delete
- [x] `owner_web_user_id` + `created_by`; scope all/subtree/own
- [x] NTRIP account CRUD (tách web) + owner + ACL placeholder
- [x] Web user/role CRUD; field allowlist; chống nâng quyền
- [x] Audit redaction; append-only

### B. Import
- [x] Script import chạy trên Windows host (hoặc mount read-only)
- [x] `--dry-run`, `--ids`, `--force`; transaction; idempotent
- [x] Mặc định disabled; `source_sha256`; không log secret
- [x] Chỉ import 2–3 job test

### C. Reconcile
- [x] Node lưu config + tăng `desired_revision` trong transaction
- [x] Gọi `POST /internal/reconcile`
- [x] Go đọc revision, áp dụng, ghi `applied_revision/runtime_state/last_error`
- [x] Node phân biệt “đã lưu” vs “đã áp dụng”
- [x] Retry khi Go down; idempotent
- [x] UI hiển thị trạng thái pending/streaming/error

### D. History & cleanup
- [x] Sessions/events/hourly; retention
- [x] Xóa job: dừng, đóng socket, `close_reason='deleted'`, giữ history
- [x] Prune theo batch; không xóa session mở

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
| 3-T1 | RBAC scope | API/UI | đúng | PASS | admin mountpoints=3, user1=1; rbac tests 9/9 |
| 3-T2 | Field allowlist | API | 403 | PASS | Vitest rbac 9/9 |
| 3-T3 | Import dry-run | script | khớp | PASS | selected=2, created=2, dryRun=true |
| 3-T4 | Import disabled | DB | enabled=false | PASS | import-demo-01: enabled=0, has_sha=1, creds v1 |
| 3-T5 | Reconcile | API/DB | applied cập nhật | PASS | desired=2, applied=2 |
| 3-T6 | Go down/up | stop/start | pending→applied | PASS | stop gnss → enable → start → applied=2 |
| 3-T7 | Soft delete | API/DB | history còn | PASS | unit test close_reason=deleted |
| 3-T8 | Audit redaction | DB | 0 secret | PASS | audit ntrip_account leak=0 |

## 3.5. Ghi chú
- Không bật job thật trong phase này.
- Không xóa audit; không cascade history khi soft delete.
- UI Relay/Mountpoint/TK NTRIP đã build PASS; browser smoke chưa tự động.
- Retention integration PASS: row cũ bị xóa, row mới + session mở giữ lại.

---

# PHASE 3.5 — UI/UX Foundation

**Mục tiêu:** sửa UI hiện có trước Phase 4: shell cố định, CRUD dialog/drawer,
phân trang server-side, icon lucide, trạng thái/a11y. Chi tiết:
`docs/0/UI_UX_PLAN.md`.

**Phụ thuộc:** Phase 3 DONE. Phase 4/5/6 dùng lại foundation.

## 3.5.1. Công việc

### A. Shell & tokens
- [x] `framed-sheet`: sidebar 228px + topbar 48px cố định; chỉ content cuộn
- [x] Mobile <1024px: sidebar drawer; topbar menu; content full width
- [x] Tokens màu/type/spacing/radius; IBM Plex Sans/Mono self-host
- [x] Dark mode `system/light/dark`; token dark; `color-scheme`; chống FOUC
- [x] Active nav neutral; một accent; không gradient/glass/shadow ở rest

### B. Component layer
- [x] `Button/IconButton`, `Field/Input/Select/Switch`, `PageHeader`
- [x] `Dialog` + `Drawer` + `AlertDialog` (Radix), focus trap/Esc/restore
- [x] `Toast`, `StatusBadge`, `Tabs`, `EmptyState/Skeleton/ErrorState`
- [x] `ThemeToggle` (Sun/Moon) + lưu lựa chọn; theo `prefers-color-scheme`
- [x] `lucide-react` 16–20px, stroke 1.5, currentColor; không icon màu/tinted chip

### C. CRUD pattern
- [x] Bỏ toàn bộ form inline khỏi page/table
- [x] Create/Edit trong Dialog; mobile full-screen Drawer
- [x] View trong Drawer; Delete/Disable trong AlertDialog
- [x] Field error, dirty guard, submit disabled khi lưu; toast sau mutation

### D. Table & pagination
- [x] DataTable: sticky header, row 48px, số căn phải, action cột cuối
- [x] Server pagination 20 (10/20/50); `page/pageSize/q/status` lưu URL
- [x] Search debounce 300ms; filter; empty/loading/error có action/retry
- [x] Mobile: row 2 dòng; ẩn cột phụ; không tràn ngang

### E. Refactor màn hình hiện có
- [x] Dashboard: KPI strip + quick actions + recent activity
- [x] Stations/Mountpoints: table + dialog/drawer + phân trang
- [x] Relay: state/applied revision + detail drawer + actions menu
- [x] TK NTRIP: CRUD dialog + ACL drawer/tab
- [x] WebUsers/Roles: dialog + role matrix drawer; bỏ `window.confirm`

### F. A11y, motion, QA
- [x] Keyboard/focus/aria/contrast cả light/dark; reduced-motion
- [x] Dark mode: system default, toggle persist, không FOUC; table/form/chart rõ
- [x] Playwright: login → CRUD → search/page → delete confirm; light + dark
- [x] `inspect.mjs --app` 0 FAIL tại 1440/768/390
- [x] Không hồi quy API/RBAC/reconcile; cập nhật SESSION/TASKS

## 3.5.2. Yêu cầu cần đạt
- Không còn form inline/`window.confirm`; CRUD dialog/drawer.
- Mọi bảng phân trang server-side; URL giữ page/filter; không `pageSize=100`.
- Shell cố định; chỉ content cuộn; mobile drawer.
- Icon monochrome; loading/empty/error/toast đầy đủ; keyboard/a11y.
- Dark mode system/toggle; không FOUC; contrast AA cả 2 theme.
- Không hồi quy API/RBAC/reconcile.

## 3.5.3. Checklist test
- [x] 3.5-T1 Shell không cuộn menu; mobile drawer
- [x] 3.5-T2 Create/Edit dialog; View drawer; Delete AlertDialog
- [x] 3.5-T3 Pagination/search/filter/URL
- [x] 3.5-T4 Icon lucide monochrome, không icon màu
- [x] 3.5-T5 Loading/empty/error/toast
- [x] 3.5-T6 Keyboard/focus/aria/contrast/reduced-motion
- [x] 3.5-T7 Responsive 1440/768/390; bảng không tràn
- [x] 3.5-T8 Playwright CRUD flow
- [x] 3.5-T9 `inspect.mjs --app` 0 FAIL
- [x] 3.5-T10 Không gây lỗi hồi quy API/RBAC/reconcile
- [x] 3.5-T11 Dark mode system/toggle/persist, không FOUC, contrast AA

## 3.5.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 3.5-T1 | Shell | browser | menu cố định | PASS | Playwright |
| 3.5-T2 | CRUD dialog | browser | không form inline | PASS | Playwright |
| 3.5-T3 | Pagination | browser/API | URL state | PASS | Playwright |
| 3.5-T4 | Icon | inspect | monochrome | PASS | lucide currentColor |
| 3.5-T5 | States | browser | đủ loading/empty/error | PASS | DataTable/toast |
| 3.5-T6 | A11y | keyboard | focus/aria | PASS | Radix + labels |
| 3.5-T7 | Responsive | inspect | 3 width | PASS | screenshots |
| 3.5-T8 | Playwright | script | CRUD PASS | PASS | 2/2 |
| 3.5-T9 | Taste app | inspect | 0 FAIL | PASS | login 0 FAIL; auth screenshots |
| 3.5-T10 | Regression | test | API/RBAC PASS | PASS | Go/Node |
| 3.5-T11 | Dark mode | browser | system/toggle, AA | PASS | Playwright |

## 3.5.5. Ghi chú
- Không đổi API/DB; chỉ sửa UI + bug UI nhỏ.
- Phase 3.5 phải xong trước Phase 4; Phase 5/6 dùng lại component.
- Không dùng icon màu/tinted chip; màu chỉ cho trạng thái/dữ liệu.
- Playwright 2/2 PASS; ảnh light/dark/mobile trong `frontend/test-results`.
- `inspect.mjs --app` login 0 FAIL; trang sau đăng nhập kiểm bằng Playwright
  screenshot vì inspect không hỗ trợ auth.
- Defer: dirty guard, filter nâng cao, recent activity; không chặn Phase 4.

---

# PHASE 4 — NTRIP caster & quản lý client

**Mục tiêu:** Caster tự phát mountpoint; quản lý NTRIP account/ACL/giới hạn; mock trước khi mở cổng thật.

**Giải thích:** Source đẩy dữ liệu lên mountpoint; rover kết nối vào. Cần v1 legacy/v1 auth/v2, fan-out, slow-client policy.

## 4.1. Công việc
- [x] Listener mặc định **1509** (source + rover), tùy chỉnh; không 2101/8081
- [x] `caster_listeners` + `caster_listener_mountpoints` many-to-many
- [x] Một mountpoint có thể nghe nhiều port (A,B,C→1509; A,C→1508)
- [x] Parse `SOURCE` (v1), `POST` (v2), `GET` (rover); phân biệt ngữ cảnh response
- [x] `ICY 200` / `HTTP 200` / `SOURCETABLE 200` đúng ngữ cảnh
- [x] Auth Basic; no-auth chỉ khi cấu hình rõ ràng
- [x] Fan-out + queue giới hạn + drop slow client
- [x] ACL + max connections
- [x] NTRIP account RBAC (`ntrip_accounts.*`) + owner scope
- [x] `connections` runtime; disconnect chủ động
- [x] RTCM monitor; counters
- [x] API/UI quản lý listener + gắn mountpoint
- [x] Mock caster/rover cho caster mới
- [ ] Integration allowlist Q10: 1 upstream + 1 downstream, credential ngoài repo, cleanup (defer)

## 4.2. Yêu cầu cần đạt
- Mock: v1 legacy/v1 auth/v2; multi-client; ACL; max conn; slow client.
- Listener 1509 + nhóm 1508 đúng; một mountpoint có thể nằm trên nhiều listener.
- Không để client chậm làm nghẽn.
- Byte passthrough nguyên vẹn.
- Chỉ mở cổng thật sau khi mock pass.

## 4.3. Checklist test
- [x] v1 legacy / v1 auth / v2 auth
- [x] Source uplink + rover
- [x] 3 rover cùng mountpoint
- [x] Sai mountpoint 404; sai auth 401; sai ACL 403
- [x] Vượt max conn bị từ chối
- [x] Slow client bị drop, client khác OK
- [x] Admin disconnect
- [x] CRC sai không crash
- [x] NTRIP account không login web
- [x] Listener 1509 + nhóm 1508; một mountpoint trên nhiều listener

## 4.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 4-T1 | v1 legacy | mock rover | ICY 200 | PASS | Go test + E2E |
| 4-T2 | v1 auth | mock | 200 | PASS | Go test |
| 4-T3 | v2 auth | mock | 200 | PASS | Go test |
| 4-T4 | Multi-client | 3 rover | cùng data | PASS | Go test |
| 4-T5 | ACL/max | mock | 403/từ chối | PASS | Go test |
| 4-T6 | Slow client | mock | không nghẽn | PASS | Go test |
| 4-T7 | Disconnect | API | rớt | PASS | Go test |
| 4-T8 | Web/NTRIP chéo | API | 401 | PASS | existing tests |
| 4-T9 | Listener groups | mock | 1509 + 1508 đúng | PASS | Go test |

## 4.5. Ghi chú
- Không sửa 1005/VRS trong MVP.
- Không mở cổng public khi chưa có firewall/rate limit.
- Migration admin 004 + runtime 003 đã apply; health Node 4 / Go 3.
- Go caster tests 7 PASS; E2E source/rover 1509 byte-exact PASS.
- Q10 integration allowlist chưa chạy (defer); không dùng credential thật.
- Hot reload Vite polling 1s đã bật cho Windows.

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

# PHASE 6 — RTCM Analytics & chất lượng trạm/relay

**Mục tiêu:** dùng `go-gnss/rtcm` parse RTCM3 để đánh giá chất lượng cho
**trạm thường** (`station`, `ingest`) và **trạm relay** (`relay_job`,
`upstream`/`downstream`); có API + realtime + FE quản trị. Chi tiết:
`docs/0/RTCM_QUALITY_PLAN.md`.

**Phụ thuộc:** Phase 3; P6-03 cần Phase 4 cho caster ingest (hoặc station probe
GET-only sớm hơn); P6-04/P6-05 cần realtime Phase 5.
P6-01/P6-02 có thể bắt đầu sau Phase 3.

## 6.1. Công việc

### A. Parser & analyzer
- [ ] Thêm `github.com/go-gnss/rtcm` (Apache-2.0), package `rtcm3`
- [ ] Parse frame/type 1005/1006/1007/1008/1033, MSM 1074–1077,
      1084–1087, 1094–1097, 1104–1107, 1114–1117, 1124–1127, 1230
- [ ] Queue giới hạn; drop sample có counter; không chặn relay/caster
- [ ] Không serialize/sửa byte; byte-in == byte-out
- [ ] Fixtures valid/CRC sai/truncated/unknown/mảnh read/nhiều frame

### B. Quality model & score dùng chung
- [ ] Migration `runtime/<next>_rtcm_quality.sql`
- [ ] Migration `admin/<next>_quality_permissions.sql` (`quality.view`, `quality.ack`, `station_probes`)
- [ ] Bảng `rtcm_message_stats`, `quality_samples`, `quality_alerts` dùng chung
      `target_type ENUM('station','relay_job')` + `target_id` + `mountpoint_id`
      (relay=0) + `direction`
- [ ] Bảng `quality_alert_acks` (admin); không FK xuyên schema
- [ ] Score 0–100: transport/integrity/MSM/metadata/signal/latency
- [ ] Station score theo `ingest`; relay score upstream/downstream + `parity`
- [ ] Baseline MSM 10 phút; relay job score = min(upstream, downstream)
- [ ] Retention: sample 60 s/30 ngày, hourly 90 ngày, alert 90 ngày

### C. Nguồn chất lượng trạm thường
- [ ] Caster ingest (Phase 4): phân tích luồng SOURCE/POST theo mountpoint/station
- [ ] Station probe GET-only cho trạm ngoài hệ thống; mặc định disabled
- [ ] `station_probes` (admin): station/mountpoint, interval, credential ref
- [ ] Không tạo downstream; chỉ endpoint được phép; mock-first
- [ ] Tránh trùng nguồn ingest/probe; ưu tiên ingest nếu cả hai bật
- [ ] Trạm không có nguồn chất lượng → trạng thái `unknown`, không báo sai

### D. API & realtime BE
- [ ] Internal `GET /internal/rtcm/snapshot`, `/internal/rtcm/health`
- [ ] REST `/api/quality/overview` (station + relay)
- [ ] REST `/api/stations/:id/quality`, `/api/stations/:id/rtcm/messages`
- [ ] REST `/api/stations/:id/probes`, `/api/station-probes/:id` (CRUD/enable/disable)
- [ ] REST `/api/relay-jobs/:id/quality`, `/api/relay-jobs/:id/rtcm/messages`
- [ ] REST `/api/quality/alerts`, `/:id/ack`, `/api/quality/export`
- [ ] RBAC scope all/subtree/own cho cả station và relay
- [ ] Socket.IO `quality.snapshot/updated/alert/ack`; room `station:<id>`/`relay:<id>`
- [ ] Throttle ~1 s; reconnect snapshot; đổi quyền cập nhật socket

### E. FE quản trị realtime
- [ ] Menu **Chất lượng** với tab **Trạm** và **Relay**
- [ ] Tab Trạm: tổng quan, score, message type/rate, sat/cell, CNR, metadata
- [ ] Tab Relay: upstream/downstream, parity, chart score/sat/cell/CNR/age/gap
- [ ] Chi tiết trạm/relay: ARP, station ID, antenna, ARP jump
- [ ] Alert list/filter/ack; loading/empty/error; responsive 1440/768/390
- [ ] Taste `inspect.mjs --app` 0 FAIL + test luồng/a11y

### F. Alert, retention, hardening
- [ ] Alert debounce 3 cửa sổ; first/last/resolved; không auto-disable job/probe
- [ ] Ack lưu admin + audit; export CSV giới hạn dòng + audit
- [ ] Prune sample/alert theo retention; không xóa alert đang mở
- [ ] Load 50–100 station/job; CPU/RAM/p95; license go-rtcm
- [ ] Tài liệu vận hành + cập nhật SESSION

## 6.2. Yêu cầu cần đạt
- Parse đúng type chính; lỗi CRC/parse được đếm, không panic.
- Analyzer không làm thay đổi byte và không chặn relay/caster khi queue đầy.
- Chất lượng đúng cho **station ingest/probe** và **relay upstream/downstream/parity**.
- Score/alert đúng ngưỡng, có baseline + debounce.
- Realtime < 2 s; reconnect snapshot đúng; không lộ dữ liệu ngoài scope.
- Không lưu raw RTCM/payload; không log secret.
- Tải 50–100 station/job không crash; license go-rtcm hợp lệ.

## 6.3. Checklist test
- [ ] 6-T1 Parse 1005/1006/1007/1008/MSM/1230
- [ ] 6-T2 CRC sai/length sai/truncated/unknown
- [ ] 6-T3 Byte-exact khi analyzer chạy
- [ ] 6-T4 Mảnh read/nhiều frame/queue đầy
- [ ] 6-T5 Score đủ/thiếu MSM/CNR/age
- [ ] 6-T6 Station ID mismatch/ARP jump/thiếu metadata
- [ ] 6-T7 Relay upstream vs downstream mất type/rate
- [ ] 6-T8 Station ingest (caster) + station probe GET-only
- [ ] 6-T9 DB down/up + Go restart
- [ ] 6-T10 API/RBAC scope station + relay
- [ ] 6-T11 Socket auth/room/throttle/đổi quyền
- [ ] 6-T12 FE Trạm/Relay realtime/loading/empty/error/a11y/Taste
- [ ] 6-T13 Load/retention/secret scan/license

## 6.4. Kết quả test
| ID | Hạng mục | Cách kiểm | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 6-T1 | Parser type chính | unit | đúng type/field | NOT RUN | |
| 6-T2 | Lỗi frame | unit | đếm lỗi, không panic | NOT RUN | |
| 6-T3 | Byte-exact | mock | byte-in == byte-out | NOT RUN | |
| 6-T4 | Backpressure | mock | không block relay/caster | NOT RUN | |
| 6-T5 | Score | unit | đúng công thức | NOT RUN | |
| 6-T6 | Metadata/ARP | unit | alert đúng | NOT RUN | |
| 6-T7 | Relay parity | mock | phát hiện suy giảm | NOT RUN | |
| 6-T8 | Station ingest/probe | integration | đúng chất lượng trạm | NOT RUN | |
| 6-T9 | DB down/up | integration | không chặn RTCM | NOT RUN | |
| 6-T10 | API/RBAC | API | đúng scope station/relay | NOT RUN | |
| 6-T11 | Socket | FE/socket | <2 s, đúng quyền | NOT RUN | |
| 6-T12 | FE/Taste | inspect | 0 FAIL + luồng đúng | NOT RUN | |
| 6-T13 | Load/license | script | không crash | NOT RUN | |

## 6.5. Ghi chú
- Không tuyên bố PASS khi chưa có bằng chứng.
- Không auto-disable job/probe; chỉ cảnh báo + ack.
- Không lưu raw RTCM/payload; chỉ aggregate/sample cho station + relay.
- Graphify cập nhật sau khi thêm module/schema.

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
