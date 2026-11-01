# 07 — KẾ HOẠCH MENU HỆ THỐNG: SỨC KHỎE / TỐI ƯU / TỰ ĐỘNG HÓA

> Ngày lập: 2026-11-01
> Trạng thái: **KẾ HOẠCH — chưa triển khai**
> Phạm vi: IA menu "Hệ thống", trang `/system` dạng tab, tab Tối ưu chỉ số,
> tab Tự động hóa (dọn dẹp định kỳ + chạy tay), API/quyền/audit liên quan.
> Nguyên tắc: giữ nguyên ranh giới Node↔Go, không thêm dịch vụ ngoài stack,
> không tự ý sửa cấu hình runtime từ UI.
> **Cấu hình bảo trì lưu trong database (`cors_admin`), không dùng ENV.**
> Chuẩn phân quyền tham chiếu bắt buộc: `docs/2/PHAN_QUYEN.md`.

## 1. Kết luận rà soát hiện trạng

### 1.1. Menu & route

- Sidebar đã có nhóm **"Hệ thống"** gồm 7 mục phẳng
  (`frontend/src/components/Layout.tsx:102-122`):
  Sức khỏe, Cấu hình bản đồ, Cảnh báo, Lịch sử, Người dùng, Công ty, Phân quyền.
- "Sức khỏe" trỏ `/system/health` (`Layout.tsx:105-109`), title topbar
  `System Health` (`Layout.tsx:40`).
- Route khai báo tại `frontend/src/App.tsx:60-61`:
  `/system/health` và `/system/map-config`.
- Test menu hiện có assert **7 nav-group** và đúng danh sách label
  (`frontend/tests/navigation.spec.ts:24-32`).

### 1.2. Trang Sức khỏe

- Một trang đơn, **không có tab**: 4 card Node / Host / MySQL / Go runtime
  (`frontend/src/pages/SystemHealth.tsx:143-284`).
- Query `['system-health']`, auto refresh 12 giây (`SystemHealth.tsx:144-148`).
- Backend chỉ có **một endpoint**: `GET /api/system/health`, quyền
  `system_health.view` (`server/src/routes/system.ts:11-17`).
- Cache 12 giây + dedupe inflight, timeout ngắn, không query nặng
  (`server/src/lib/systemHealth.ts:16, 237-251`).
- Số liệu Go lấy qua `/internal/rtcm/health`, `/internal/snapshot`,
  `/internal/caster/connections`, `/internal/caster/listeners`
  (`systemHealth.ts:141-171`).

### 1.3. Dọn dẹp tự động đã có (nhưng chưa quan sát được)

Go đã chạy retention tự động:

| Bảng | Ngưỡng mặc định | Mã |
|---|---|---|
| `relay_sessions` | 90 ngày (`end_ts IS NOT NULL`) | `gnss/internal/relay/retention.go:83-91` |
| `relay_events` | 30 ngày | `retention.go:93-100` |
| `relay_hourly` | 90 ngày | `retention.go:102-109` |
| `quality_samples` | 35 ngày | `gnss/internal/quality/store.go:165-182` |
| `quality_alerts` | 90 ngày (chỉ `resolved_at IS NOT NULL`) | `store.go:176-181` |

Wiring: `gnss/cmd/corsd/main.go:109-126` (`relay.RunRetention`) và
`main.go:170-190` (`runQualityRetention`). Hiện cấu hình qua ENV
(`.env.example:62-66, 101-104`) — kế hoạch này chuyển sang bảng DB.

**Nhưng chưa có** API/UI hiển thị: ngưỡng hiện tại, lần chạy cuối, số dòng đã
xóa, backlog, hay nút chạy tay/dry-run.

### 1.4. Bảng dữ liệu chưa được dọn (tăng vô hạn)

| Bảng | Schema | Ghi chú |
|---|---|---|
| `caster_connections` | `db/migrations/runtime/003_caster_runtime.sql` | 1 dòng/phiên rover |
| `station_source_sessions` | `db/migrations/runtime/006_station_source_sessions.sql` | 1 dòng/phiên nguồn trạm |
| `rtcm_message_stats` | `db/migrations/runtime/004_rtcm_quality.sql` | Aggregate theo giờ |
| `audit_logs` | `db/migrations/admin/001_init.sql:130` | Audit tăng mãi |
| `web_sessions` | `db/migrations/admin/001_init.sql:63` | Có `expires_at`, không dọn |
| `alerts` | `db/migrations/admin/005_alerts_settings.sql` | Alert `acked` cũ |

### 1.5. Ràng buộc kiến trúc bắt buộc

1. **Node chỉ ghi `cors_admin`; Go ghi `cors_runtime`** (AGENTS.md §4).
   ⇒ Dọn bảng runtime **phải do Go**, Node chỉ điều khiển qua internal API.
2. Go hiện chỉ đọc `relay_jobs`, `relay_credentials`, `stations`,
   `mountpoints`, `ntrip_accounts` — **không đọc `settings`**. Kế hoạch này
   thêm quyền đọc `maintenance_jobs`/`maintenance_settings` (vẫn là đọc cấu
   hình, không sửa).
3. Không auto-disable job/probe; không xóa alert đang mở (AGENTS.md §9).
4. Phân quyền hiện có: `system_health.view`, `settings.view/edit`
   (`server/src/db/seed.ts:34-35`); `admin`/`user` bị chặn với
   `settings.*` và `system_health.view` (`server/src/rbac/matrix.ts:9-10`).
5. Không thêm Redis/Kafka/RabbitMQ/K8s, không thêm chart lib, không UI kit mới.
6. Migration chỉ chạy bởi Node/CI; Go fail-fast nếu lệch version.

### 1.6. Quyết định đã chốt với chủ dự án

- Giữ **phương án A**: sidebar còn một mục "Hệ thống" → `/system`, mặc định tab
  Sức khỏe; các trang admin cũ vẫn ở sidebar trong giai đoạn này.
- Cấu hình retention/bảo trì **lưu trong database**, sửa được từ UI (không dùng
  ENV), vì số lượng tham số nhiều và cần chủ động điều chỉnh.
- Có nút **chạy tay + dry-run** cho từng job.

## 2. Mục tiêu và tiêu chí thành công

### 2.1. Mục tiêu

1. Menu "Hệ thống" mở trang `/system` với tab, mặc định **Sức khỏe**.
2. Tab **Tối ưu** trả lời: bảng nào lớn, tăng nhanh, queue nào đầy, đĩa còn
   bao lâu, nên xử lý gì — chỉ đọc và đề xuất.
3. Tab **Tự động hóa** hiển thị toàn bộ job dọn dẹp (admin + runtime), ngưỡng
   hiện tại, lần chạy cuối, số dòng đã xóa, lịch sử chạy; cho phép dry-run và
   chạy tay.
4. Bổ sung dọn các bảng đang tăng vô hạn (§1.4) đúng chủ sở hữu dữ liệu.
5. Không ảnh hưởng relay/caster, không chặn đường byte RTCM, không lộ secret.
6. Deep-link cũ `/system/health` vẫn hoạt động (redirect).

### 2.2. Tiêu chí thành công

- `/system` mở tab Sức khỏe; `/system?tab=optimize` và `?tab=automation` mở
  đúng tab; reload giữ tab; back/forward đúng.
- Menu chỉ còn 1 mục "Hệ thống" (trong nhóm Hệ thống), các mục admin khác
  không đổi.
- Tab Tối ưu hiển thị đủ: dung lượng bảng admin+runtime, tăng trưởng, pool,
  queue Go, đĩa + dự báo, danh sách gợi ý.
- Tab Tự động hóa liệt kê đủ 11 job (3 admin + 8 runtime), đúng ngưỡng đã seed
  trong database.
- Sửa được ngưỡng ngày / batch / interval / bật-tắt / giờ chạy từ UI; lưu DB
  ngay, Go áp dụng không cần restart; mọi thay đổi ghi audit.
- Dry-run không thay đổi dữ liệu; chạy thật có xác nhận, ghi audit, trả số
  dòng đã xóa; chạy lại lần 2 không xóa thêm.
- Không xóa: session/connection đang mở (`end_ts IS NULL`), alert `open`,
  `quality_alerts` chưa resolve, `relay_job_state`.
- `admin`/`user` nhận 403 với toàn bộ API `system_ops`.
- Test Node/Go/Playwright PASS; 1440/768/390 + dark mode + a11y AA.

## 3. Quyết định mặc định

| Mã | Quyết định | Đề xuất |
|---|---|---|
| D07-01 | IA menu | Một mục **"Hệ thống"** → `/system`; tab `health` mặc định |
| D07-02 | Các trang admin cũ | Giữ ở sidebar giai đoạn này; không gộp thành tab |
| D07-03 | Tương thích deep-link | `/system/health` → redirect `/system?tab=health` |
| D07-04 | Component tab | Dùng lại `Tabs` có sẵn (`frontend/src/components/ui.tsx:697-722`) |
| D07-05 | Lưu tab | Query string `?tab=`, không state ẩn |
| D07-06 | Cấu hình retention | **Bảng DB** `admin.maintenance_jobs` + `admin.maintenance_settings`; sửa từ UI |
| D07-07 | Ranh giới dọn dẹp | Node dọn `cors_admin`; Go dọn `cors_runtime` |
| D07-08 | Chạy tay runtime | Node gọi `POST /internal/maintenance/prune` (HMAC) |
| D07-09 | An toàn | Không xóa dữ liệu đang mở; không auto-disable |
| D07-10 | Dry-run | Bắt buộc có; mặc định UI mở dry-run trước khi chạy thật |
| D07-11 | Quyền | Module mới `system_ops` (`view`,`edit`); chỉ `super_admin` |
| D07-12 | Lịch sử chạy | Bảng `admin.maintenance_runs` cho mọi lần chạy từ UI |
| D07-13 | Nguồn cấu hình của Go | Đọc `admin.maintenance_jobs` qua `adminDB` (đã có sẵn), cache 60s + reload khi reconcile |
| D07-14 | Scheduler | `setInterval` trong Node (1 instance), tick mỗi phút; giờ/bật-tắt đọc `maintenance_settings` |
| D07-15 | Chỉ số bảng | `information_schema.TABLES`; `performance_schema` optional |
| D07-16 | Slow query | Nếu `performance_schema` tắt → hiển thị "không khả dụng", không bịa |
| D07-17 | `OPTIMIZE TABLE` | Không tự động; chỉ thủ công + cảnh báo khóa bảng (P07 sau) |
| D07-18 | Batch | `DELETE ... ORDER BY ... LIMIT n` lặp, timeout 60s/job |
| D07-19 | Audit | Mỗi lần chạy ghi `audit_logs` (`maintenance.run`), redact secret |
| D07-20 | Ngưỡng mới (seed) | `caster_connections` 90d, `station_source_sessions` 90d, `rtcm_message_stats` 365d, `audit_logs` 365d, `web_sessions` 7d sau hết hạn, `alerts acked` 180d |
| D07-21 | Không làm | Không chart lib, không partition, không Redis, không dùng `settings` JSON cho retention |
| D07-22 | Test menu | Cập nhật/thêm test `/system` + tab; giữ assert 7 nav-group |
| D07-23 | Ghi cấu hình | Chỉ Node ghi `maintenance_*` (admin); Go chỉ đọc, không sửa |
| D07-24 | Áp dụng thay đổi | PUT xong gọi `POST /internal/maintenance/reconcile` để Go reload ngay; nếu lỗi thì Go tự reload theo TTL 60s |
| D07-25 | Legacy ENV | Bỏ retention khỏi ENV; migration seed giá trị hiện tại; Go không còn đọc `RELAY_*_RETENTION_DAYS`, `QUALITY_*_RETENTION_DAYS` |
| D07-26 | Validate | `retention_days` 1..3650; `batch_size` 100..50000; `interval_sec` 300..86400; giờ 0..23; phút 0..59 |
| D07-27 | Schema check | Go kiểm tra admin schema version ≥ 34 và sự tồn tại `maintenance_jobs`; thiếu → fail-fast |

### 3.1. Bảng job dọn dẹp

| Job key | Scope | Bảng | Điều kiện xóa | Ngưỡng seed (ngày) |
|---|---|---|---|---|
| `relay-sessions` | runtime | `relay_sessions` | `end_ts IS NOT NULL AND end_ts < now-days` | 90 |
| `relay-events` | runtime | `relay_events` | `ts < now-days` | 30 |
| `relay-hourly` | runtime | `relay_hourly` | `hour_start_utc < now-days` | 90 |
| `quality-samples` | runtime | `quality_samples` | `ts < now-days` | 35 |
| `quality-alerts` | runtime | `quality_alerts` | `resolved_at IS NOT NULL AND last_seen < now-days` | 90 |
| `caster-connections` | runtime | `caster_connections` | `end_ts IS NOT NULL AND end_ts < now-days` | 90 |
| `station-sessions` | runtime | `station_source_sessions` | `end_ts IS NOT NULL AND end_ts < now-days` | 90 |
| `rtcm-message-stats` | runtime | `rtcm_message_stats` | `hour_start_utc < now-days` | 365 |
| `web-sessions` | admin | `web_sessions` | `expires_at < now - days` | 7 |
| `audit-logs` | admin | `audit_logs` | `created_at < now-days` | 365 |
| `acked-alerts` | admin | `alerts` | `status='acked' AND acked_at < now-days` | 180 |

Không bao giờ xóa: `relay_job_state`, `schema_migrations`, `runtime_meta`,
`settings`, `web_users`, `roles`, `permissions`, `companies`, `stations`,
`mountpoints`, `ntrip_accounts`, `relay_jobs`, `relay_credentials`.

## 4. Kiến trúc đích

### 4.1. IA menu & tab

```text
Hệ thống (sidebar, icon Settings)
└── /system
    ├── Sức khỏe      (tab=health, mặc định)
    ├── Tối ưu        (tab=optimize)
    └── Tự động hóa   (tab=automation)

Các mục cũ giữ nguyên trong nhóm Hệ thống:
  Cấu hình bản đồ | Cảnh báo | Lịch sử | Người dùng | Công ty | Phân quyền
```

- `Layout.tsx`: thay mục "Sức khỏe" bằng mục "Hệ thống" trỏ `/system`;
  giữ các mục còn lại.
- `titles`: `'/system': 'Hệ thống'`; giữ `'/system/map-config'`.
- `App.tsx`: thêm `/system`; `/system/health` → `<Navigate to="/system?tab=health" replace />`.
- Active menu: `NavLink` `/system` dùng `end` để không active nhầm.

### 4.2. Ranh giới xử lý

```text
UI (/system)
  ├─ GET  /api/system/optimize              → Node tổng hợp (admin + gọi Go)
  ├─ GET  /api/system/maintenance/*         → Node (đọc maintenance_*) + Go status
  ├─ PUT  /api/system/maintenance/jobs/:key → Node UPDATE maintenance_jobs + audit
  │                                          → POST /internal/maintenance/reconcile (Go reload)
  ├─ PUT  /api/system/maintenance/settings  → Node UPDATE maintenance_settings + audit
  └─ POST /api/system/maintenance/run
       ├─ job admin  → Node DELETE trên cors_admin
       └─ job runtime→ Node gọi POST /internal/maintenance/prune (HMAC) → Go DELETE cors_runtime
```

- Node không `DELETE` bảng runtime.
- Go **đọc** cấu hình từ `admin.maintenance_jobs` / `admin.maintenance_settings`
  qua `adminDB` sẵn có (`gnss/internal/db/db.go:18-20`), không sửa cấu hình.
- Go internal bind loopback/docker network, HMAC + timestamp + nonce (dùng
  `callGoInternal` sẵn có: `server/src/lib/internalApi.ts`).

### 4.3. Cấu hình trong database

Không dùng ENV cho retention/bảo trì. Hai bảng trong `cors_admin`:

```text
maintenance_jobs        (1 dòng / job, 11 dòng seed)
  job_key PK, label, scope, table_name,
  retention_days, batch_size, interval_sec, enabled,
  updated_by, updated_at

maintenance_settings    (1 dòng, id = 1)
  id PK, scheduler_enabled, run_hour_local, run_minute_local,
  timezone, updated_by, updated_at
```

Luồng áp dụng:

```text
UI PUT /api/system/maintenance/jobs/:key
  → Node validate + UPDATE maintenance_jobs + audit
  → Node gọi POST /internal/maintenance/reconcile
  → Go reload config ngay (không restart)

Go tự reload theo TTL 60s nếu reconcile lỗi hoặc job tự động.
Go giữ "last known config" nếu DB tạm lỗi; log warning, không crash.
```

- `maintenance_settings.timezone` cố định `Asia/Ho_Chi_Minh` trong kế hoạch này
  (lưu chuỗi để mở rộng sau).
- Go kiểm tra admin schema version ≥ 34 và `maintenance_jobs` tồn tại khi
  khởi động; thiếu → fail-fast (D07-27).
- Legacy ENV `RELAY_*_RETENTION_DAYS`, `QUALITY_*_RETENTION_DAYS`,
  `RELAY_PRUNE_*`, `QUALITY_PRUNE_*` bị bỏ khỏi `.env.example`; migration seed
  đúng giá trị đang dùng để không đổi hành vi.

### 4.4. Lịch sử chạy

- `admin.maintenance_runs`: mọi lần chạy phát sinh từ UI (admin hoặc runtime),
  do Node ghi (đúng chủ sở hữu `cors_admin`).
- Job tự động của Go: chỉ trạng thái RAM qua internal API; UI ghi rõ
  "lần chạy tự động gần nhất (trong RAM, reset khi restart Go)".
- Không tạo bảng runtime mới ở kế hoạch này.

## 5. Thay đổi dữ liệu / migration

### 5.1. `db/migrations/admin/034_maintenance.sql`

```sql
CREATE TABLE IF NOT EXISTS maintenance_jobs (
  job_key VARCHAR(64) NOT NULL,
  label VARCHAR(120) NOT NULL,
  scope ENUM('admin','runtime') NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  retention_days INT UNSIGNED NOT NULL,
  batch_size INT UNSIGNED NOT NULL DEFAULT 1000,
  interval_sec INT UNSIGNED NOT NULL DEFAULT 3600,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (job_key),
  CONSTRAINT fk_maintenance_jobs_user
    FOREIGN KEY (updated_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS maintenance_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  scheduler_enabled TINYINT(1) NOT NULL DEFAULT 1,
  run_hour_local TINYINT UNSIGNED NOT NULL DEFAULT 3,
  run_minute_local TINYINT UNSIGNED NOT NULL DEFAULT 0,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_maintenance_settings_user
    FOREIGN KEY (updated_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO maintenance_settings (id) VALUES (1)
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO maintenance_jobs
  (job_key, label, scope, table_name, retention_days, batch_size, interval_sec, enabled)
VALUES
  ('relay-sessions',      'Phiên relay',              'runtime', 'relay_sessions',           90,  1000, 3600,  1),
  ('relay-events',        'Sự kiện relay',            'runtime', 'relay_events',             30,  1000, 3600,  1),
  ('relay-hourly',        'Tổng hợp giờ relay',       'runtime', 'relay_hourly',             90,  1000, 3600,  1),
  ('quality-samples',     'Mẫu chất lượng RTCM',      'runtime', 'quality_samples',          35,  1000, 21600, 1),
  ('quality-alerts',      'Cảnh báo chất lượng',      'runtime', 'quality_alerts',           90,  1000, 21600, 1),
  ('caster-connections',  'Phiên kết nối caster',     'runtime', 'caster_connections',       90,  1000, 3600,  1),
  ('station-sessions',    'Phiên nguồn trạm',         'runtime', 'station_source_sessions',  90,  1000, 3600,  1),
  ('rtcm-message-stats',  'Thống kê loại bản tin',    'runtime', 'rtcm_message_stats',      365,  1000, 21600, 1),
  ('web-sessions',        'Phiên đăng nhập web',      'admin',   'web_sessions',              7,  1000, 3600,  1),
  ('audit-logs',          'Nhật ký audit',            'admin',   'audit_logs',              365,  1000, 86400, 1),
  ('acked-alerts',        'Cảnh báo đã xác nhận',     'admin',   'alerts',                  180,  1000, 86400, 1)
ON DUPLICATE KEY UPDATE job_key = job_key;

CREATE TABLE IF NOT EXISTS maintenance_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_key VARCHAR(64) NOT NULL,
  scope ENUM('admin','runtime') NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  dry_run TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('running','ok','error') NOT NULL DEFAULT 'running',
  rows_deleted BIGINT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  error VARCHAR(500) NOT NULL DEFAULT '',
  triggered_by BIGINT UNSIGNED NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_maintenance_runs_job (job_key, started_at),
  KEY idx_maintenance_runs_started (started_at),
  CONSTRAINT fk_maintenance_runs_user
    FOREIGN KEY (triggered_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, module, action, description) VALUES
  ('system_ops.view', 'system_ops', 'view', 'Xem tối ưu và tự động hóa hệ thống'),
  ('system_ops.edit', 'system_ops', 'edit', 'Chạy bảo trì và dọn dẹp hệ thống')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action),
  description = VALUES(description);
```

- Cập nhật `server/src/db/seed.ts` thêm 2 permission để cài mới đủ.
- Không thêm migration runtime.
- `schema_migrations` tự ghi nhận version 34 khi chạy `npm run migrate`.
- Seed 11 job + 1 settings row dùng `ON DUPLICATE KEY UPDATE` để chạy lại an toàn,
  không ghi đè giá trị người dùng đã sửa (`retention_days`, `batch_size`,
  `interval_sec`, `enabled` chỉ set khi INSERT lần đầu).

### 5.2. Không đổi schema bảng nghiệp vụ

Không thêm cột vào `stations`, `relay_jobs`, `settings`, `alerts`.
Không dùng `settings` cho retention.

## 6. Thay đổi API

### 6.1. Node — `server/src/routes/system.ts`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/system/health` | `system_health.view` | Giữ nguyên |
| GET | `/api/system/optimize` | `system_ops.view` | Chỉ số tối ưu + gợi ý |
| GET | `/api/system/maintenance/jobs` | `system_ops.view` | Danh sách job + cấu hình + trạng thái |
| PUT | `/api/system/maintenance/jobs/:key` | `system_ops.edit` | Sửa ngưỡng/batch/interval/enabled |
| GET | `/api/system/maintenance/settings` | `system_ops.view` | Cấu hình scheduler |
| PUT | `/api/system/maintenance/settings` | `system_ops.edit` | Sửa scheduler (bật/tắt, giờ, phút) |
| GET | `/api/system/maintenance/runs` | `system_ops.view` | Lịch sử chạy, phân trang |
| POST | `/api/system/maintenance/run` | `system_ops.edit` | Dry-run/chạy tay |
| GET | `/api/system/maintenance/runs/export` | `system_ops.view` | `.xlsx` (tùy chọn, P07-6) |

### 6.2. Hình dạng `GET /api/system/optimize`

```json
{
  "generatedAt": "2026-11-01T00:00:00.000Z",
  "cacheTtlSec": 12,
  "database": {
    "status": "ok",
    "admin": { "sizeBytes": 0, "tables": [{ "name": "", "rows": 0, "dataBytes": 0, "indexBytes": 0, "totalBytes": 0 }] },
    "runtime": { "sizeBytes": 0, "tables": [] },
    "growth": [{ "table": "", "scope": "runtime", "rowsPerDay": 0, "projectedFullDays": null }],
    "pool": { "totalConnections": 0, "freeConnections": 0, "queue": 0, "connectionLimit": 0 },
    "slowQueries": { "available": false, "reason": "performance_schema đang tắt" }
  },
  "go": {
    "reachable": true,
    "quality": { "queueDepth": 0, "queueSize": 0, "dropped": 0, "parseErrors": 0, "storeDrops": 0, "targets": 0, "alertsOpen": 0 },
    "relay": [{ "jobId": 0, "state": "", "monitorDrops": 0, "crcErrors": 0, "retries": 0 }]
  },
  "node": { "heapPercent": 0, "eventLoopLagMs": 0, "rssBytes": 0, "socketClients": 0 },
  "disk": { "usedPercent": 0, "freeBytes": 0, "growthBytesPerDay": null, "projectedFullDays": null },
  "retention": { "jobs": [] },
  "recommendations": [{ "id": "", "level": "warn", "title": "", "detail": "", "actionTab": "automation" }]
}
```

- Cache 12–30 giây dùng chung pattern `systemHealth` để không tải DB.
- `information_schema` chỉ query 2 schema; giới hạn `ORDER BY totalBytes DESC LIMIT 20`.
- `slowQueries` chỉ đọc khi `performance_schema` bật; nếu không → `available:false`.

### 6.3. Hình dạng `GET /api/system/maintenance/jobs`

```json
{
  "generatedAt": "",
  "scheduler": {
    "enabled": true,
    "hourLocal": 3,
    "minuteLocal": 0,
    "timezone": "Asia/Ho_Chi_Minh",
    "lastTickAt": "",
    "updatedAt": ""
  },
  "items": [{
    "key": "relay-sessions",
    "label": "Phiên relay",
    "scope": "runtime",
    "table": "relay_sessions",
    "retentionDays": 90,
    "batchSize": 1000,
    "intervalSec": 3600,
    "configSource": "database",
    "enabled": true,
    "updatedAt": "",
    "lastRunAt": null,
    "lastRunSource": "auto|manual|null",
    "lastRowsDeleted": null,
    "lastStatus": "ok|error|null",
    "nextRunAt": null,
    "backlogRows": null
  }]
}
```

- Job admin: `maintenance_jobs` + `maintenance_runs` (lần chạy cuối).
- Job runtime: `maintenance_jobs` + `GET /internal/maintenance/status`
  (Go trả cấu hình đang áp dụng + lần chạy RAM).
- `retentionDays`, `batchSize`, `intervalSec`, `enabled` sửa được qua
  `PUT /api/system/maintenance/jobs/:key`; `label`, `scope`, `table` read-only.
- `backlogRows` chỉ tính khi `system_ops.view`; query có `LIMIT`/timeout,
  nếu quá tải → `null` (không chặn UI).

### 6.3b. `PUT /api/system/maintenance/jobs/:key`

```json
{ "retentionDays": 90, "batchSize": 1000, "intervalSec": 3600, "enabled": true }
```

- Validate D07-26; từ chối giá trị ngoài khoảng → 400 kèm field lỗi.
- `job_key` phải tồn tại trong `maintenance_jobs`; không nhận `scope/table` từ client.
- Ghi audit `maintenance.config` với before/after (redacted).
- Nếu `scope=runtime`: gọi `POST /internal/maintenance/reconcile` sau khi commit.
- Trả job đã cập nhật.

### 6.3c. `GET/PUT /api/system/maintenance/settings`

```json
{ "schedulerEnabled": true, "hourLocal": 3, "minuteLocal": 0 }
```

- `timezone` read-only `Asia/Ho_Chi_Minh` ở kế hoạch này.
- Validate giờ 0..23, phút 0..59; ghi audit `maintenance.settings`.

### 6.4. `POST /api/system/maintenance/run`

Body:

```json
{ "jobKey": "relay-sessions", "dryRun": true }
```

- Validate `jobKey` thuộc danh sách cho phép (không nhận SQL từ client).
- Nếu `scope=admin` → Node chạy cleanup local.
- Nếu `scope=runtime` → Node gọi `POST /internal/maintenance/prune`
  `{ "jobKey": "...", "dryRun": true }` với HMAC.
- Ghi `maintenance_runs` (status running → ok/error) + `audit_logs` action
  `maintenance.run`, `entity_type=maintenance`, `entity_id=jobKey`.
- Trả `{ runId, jobKey, dryRun, status, rowsDeleted, durationMs }`.
- Khóa đồng thời: nếu job đang chạy → 409.
- Timeout 60 giây; quá hạn → status `error`, message rõ.

### 6.5. Go internal API mới — `gnss/internal/api/server.go`

| Method | Path | Mô tả |
|---|---|---|
| GET | `/internal/maintenance/status` | Cấu hình đang áp dụng + lần chạy cuối (RAM) |
| POST | `/internal/maintenance/prune` | Dry-run hoặc chạy 1 job runtime |
| POST | `/internal/maintenance/reconcile` | Reload cấu hình từ DB ngay |

- Cả ba dùng `requireSignature` như các endpoint internal khác
  (`server.go:92-106`).
- `prune` chỉ nhận `jobKey` trong allowlist; `dryRun` dùng
  `SELECT COUNT(*)` với cùng điều kiện.
- Trả `{ "jobKey": "", "dryRun": true, "rows": 0 }`.
- `reconcile` trả `{ "reloaded": true, "jobs": 11, "version": "..." }`.
- Ghi log `[maintenance] ...` (không log secret/DSN).
- Không chặn goroutine relay/caster: chạy trong request context + timeout.

### 6.6. Go đọc cấu hình DB & retention mở rộng

- Thêm package `gnss/internal/maintenance`:
  - `config.go`: load `maintenance_jobs`/`maintenance_settings` từ `adminDB`,
    validate, cache TTL 60s, `Reload(ctx)`.
  - `retention.go`: prune theo cấu hình từng job (days/batch/interval/enabled).
  - `runner.go`: ticker dùng `interval_sec` mỗi job; skip khi `enabled=0`.
- `gnss/internal/relay/retention.go`: thêm prune `caster_connections`,
  `station_source_sessions` (điều kiện `end_ts IS NOT NULL`).
- `gnss/internal/quality/store.go`: thêm prune `rtcm_message_stats`
  (`hour_start_utc`) — hoặc tách file dùng chung.
- `gnss/internal/config/config.go`: **bỏ** `SessionRetentionDays`,
  `EventRetentionDays`, `HourlyRetentionDays`, `PruneBatch`, `PruneInterval`,
  `QualitySampleDays`, `QualityAlertDays`, `QualityPruneBatch`,
  `QualityPruneInterval` (chuyển sang DB).
- `gnss/cmd/corsd/main.go`: kiểm tra admin schema ≥ 34, load config, chạy
  runner; `OpenAdmin` đã có sẵn (`main.go:31`).
- Nếu DB lỗi tạm thời: giữ config cũ, log warning, không crash.
- Nếu bảng/row thiếu lúc khởi động: fail-fast với thông báo rõ (D07-27).

## 7. Thay đổi frontend

### 7.1. File mới

| File | Vai trò |
|---|---|
| `frontend/src/pages/System.tsx` | Wrapper `/system`, đọc `?tab=`, render `Tabs` |
| `frontend/src/pages/system/HealthTab.tsx` | Chuyển nội dung `SystemHealth.tsx` vào tab |
| `frontend/src/pages/system/OptimizeTab.tsx` | Tab Tối ưu |
| `frontend/src/pages/system/AutomationTab.tsx` | Tab Tự động hóa |
| `frontend/src/components/system/MetricCard.tsx` | Card số liệu dùng chung |
| `frontend/src/components/system/RecommendationList.tsx` | Danh sách gợi ý |
| `frontend/src/components/system/TableSizeTable.tsx` | Bảng dung lượng |
| `frontend/src/components/system/MaintenanceRunsTable.tsx` | Lịch sử chạy |

Giữ `frontend/src/pages/SystemHealth.tsx` làm re-export mỏng hoặc xóa sau khi
chuyển route; ưu tiên xóa để tránh trùng.

### 7.2. Sửa file

- `frontend/src/App.tsx`: thêm route `/system`, redirect `/system/health`.
- `frontend/src/components/Layout.tsx`: đổi mục menu + title.
- `frontend/src/styles.css`: thêm nhóm `.optimize-*`, `.maintenance-*`,
  `.recommendation-*`; tái dùng `.health-card`, `.panel`, `.tabs`, `.badge`.
- `frontend/src/types.ts` (nếu đang gom type): thêm type response.

### 7.3. Hành vi UI

- Tab mặc định `health`; tab không hợp lệ → `health` (replace URL).
- Tab Tối ưu: banner tổng + 4 khối (Database, Retention, Go, Node/Đĩa) +
  danh sách gợi ý có link sang tab Tự động hóa.
- Tab Tự động hóa:
  - Bảng job: key, bảng, scope, ngưỡng ngày, batch, interval, bật/tắt,
    lần chạy cuối, số dòng, trạng thái.
  - Sửa cấu hình **inline trong dialog/drawer** (không form inline trong
    bảng): ngưỡng ngày, batch, interval, enabled; validate theo D07-26;
    lưu qua `PUT` rồi refetch.
  - Card "Lịch chạy": bật/tắt scheduler, giờ, phút (timezone read-only
    `Asia/Ho_Chi_Minh`); lưu qua `PUT /settings`.
  - Nút "Chạy thử" (dry-run) và "Chạy ngay" (AlertDialog xác nhận, nêu rõ
    bảng + ngưỡng + số dòng ước tính).
  - Hiển thị "Cấu hình lưu trong database; Go áp dụng ngay sau khi lưu".
  - Lịch sử chạy: phân trang server-side 10/20/50, filter job/trạng thái.
  - Hiển thị `updatedAt`/`updatedBy` của cấu hình để biết ai đổi gần nhất.
- Không `window.confirm`; dùng `AlertDialog`.
- Loading/empty/error đủ cho từng khối; lỗi Go → hiển thị "không khả dụng"
  kèm lý do, không làm hỏng cả tab.
- A11y: `role="tablist"`, `aria-selected` (đã có trong `Tabs`), focus trap
  cho dialog, `aria-live` cho kết quả chạy, contrast AA, reduced-motion.
- Dark mode dùng token hiện có; không hardcode màu light.

## 8. Tab Tối ưu — đặc tả chỉ số

| Khối | Chỉ số | Nguồn | Fallback |
|---|---|---|---|
| Database | Tổng dung lượng admin/runtime; top 20 bảng theo `data+index`; rows | `information_schema.TABLES` | "Không đọc được" |
| Tăng trưởng | `rowsPerDay`, `projectedFullDays` | So sánh `TABLE_ROWS` theo thời gian hoặc đếm mẫu `created_at` | `null` |
| Pool | total/free/queue/limit, % | `systemHealth` hiện có | — |
| Slow query | digest top 10, thời gian | `performance_schema.events_statements_summary_by_digest` | `available:false` |
| Retention backlog | Số dòng cũ hơn ngưỡng cho từng bảng | `COUNT(*)` có điều kiện + `LIMIT` | `null` |
| Go | queue depth/size, dropped, parseErrors, storeDrops, targets, alertsOpen | `analyzer.Health()` | "Go không phản hồi" |
| Go relay | state, monitorDrops, crcErrors, retries | `/internal/snapshot` | — |
| Node | heap %, event-loop lag, socket clients | `systemHealth` | — |
| Đĩa | % dùng, free, growth, dự báo đầy | `statfs` + growth | "Không đọc được" |

Gợi ý (rule-based, chỉ đọc):

| ID | Điều kiện | Mức | Nội dung |
|---|---|---|---|
| `heap-high` | heap ≥ 80% | warn | Xem xét tăng RAM hoặc giảm cache |
| `loop-lag` | event-loop ≥ 200ms | warn | Kiểm tra tác vụ đồng bộ/query nặng |
| `db-latency` | MySQL latency ≥ 300ms | warn | Kiểm tra tải/khóa bảng |
| `quality-queue-full` | `queueDepth/queueSize ≥ 90%` | warn | Tăng `QUALITY_QUEUE_SIZE` hoặc giảm tải |
| `quality-drops` | `dropped > 0` | warn | Tăng queue/giảm sample |
| `store-drops` | `storeDrops > 0` | warn | Tăng `QUALITY_STORE_QUEUE_SIZE` |
| `table-large` | bảng ≥ 2GB | info | Xem retention/partition (không tự làm) |
| `retention-backlog` | backlog > 10k | info | Chạy job dọn tương ứng |
| `disk-high` | đĩa ≥ 90% | critical | Dọn dữ liệu/backup ra ngoài |
| `expired-sessions` | `web_sessions` hết hạn > 1000 | info | Bật job `web-sessions` |

Không tự sửa tham số, không tự disable job/probe.

## 9. Tab Tự động hóa — hành vi an toàn

1. **Dry-run mặc định**: nút "Chạy ngay" chỉ bật sau khi đã dry-run trong phiên
   hiện tại (hoặc hiển thị số dòng ước tính ngay trong dialog).
2. **Không xóa dữ liệu đang mở**: điều kiện SQL bắt buộc `end_ts IS NOT NULL`
   hoặc `status='acked'` hoặc `resolved_at IS NOT NULL`.
3. **Batch + LIMIT** (D07-18); dừng khi `affected < batch`.
4. **Timeout** 60 giây/job; quá hạn trả lỗi, không treo request.
5. **Một job/lúc**: khóa theo `job_key` (in-process map) → 409 nếu trùng.
6. **Audit**: `maintenance.run` + `maintenance.dry_run`; redact secret.
7. **Scheduler**: tick mỗi phút, chạy khi giờ/phút local = `maintenance_settings`
   và chưa chạy trong ngày; lưu `lastTickAt` RAM; reload settings mỗi 60s.
8. **Không chạy scheduler** nếu `maintenance_settings.scheduler_enabled = 0`.
9. **Không ảnh hưởng RTCM**: job chạy trong request/goroutine riêng, timeout,
   không dùng chung pool với đường byte.
10. **Cảnh báo đa instance**: UI ghi chú scheduler chạy trong tiến trình Node;
    nếu scale nhiều instance cần khóa DB (ngoài phạm vi).

## 10. Kế hoạch theo bước

### P07-0 — Baseline & shell menu/tab

**Mục tiêu:** `/system` + tab, mặc định health, không đổi dữ liệu.

- Thêm `pages/System.tsx`, tách `HealthTab`, route/redirect, menu/title.
- `Tabs` + URL `?tab=`, tab không hợp lệ → health.
- Cập nhật test Playwright cho `/system`.
- **Nghiệm thu:** `/system` mở Sức khỏe; `?tab=optimize` (placeholder) và
  `?tab=automation` (placeholder) mở đúng; `/system/health` redirect;
  menu còn 1 mục "Hệ thống"; 7 nav-group; 1440/768/390 không tràn.

### P07-1 — DB, quyền, cấu hình

- Migration `admin/034_maintenance.sql`: 3 bảng + seed 11 job + settings + 2 quyền.
- Cập nhật `seed.ts` thêm 2 permission (cài mới).
- `rbac/matrix.ts`: `admin`/`user` = `none` cho `system_ops.*`.
- Bỏ retention khỏi `.env.example`; giữ ghi chú migration đã chuyển sang DB.
- **Nghiệm thu:** migrate sạch từ DB 33 → 34; đủ 11 job; permission có trong
  DB; `admin`/`user` 403; không còn phụ thuộc ENV retention.

### P07-2 — Backend Tối ưu

- `server/src/lib/systemOptimize.ts`: thu thập bảng, pool, đĩa, Go, retention,
  rule engine; cache 12–30s.
- `GET /api/system/optimize` + `system_ops.view`.
- **Nghiệm thu:** response đúng schema; DB không hỗ trợ → `available:false`;
  không lộ DSN; thời gian phản hồi < 1s khi cache.

### P07-3 — Backend Tự động hóa (admin)

- `server/src/lib/maintenanceConfig.ts`: đọc/validate/ghi `maintenance_jobs`,
  `maintenance_settings`; cache + invalidate khi ghi.
- `server/src/lib/maintenance.ts`: allowlist job admin, cleanup batch,
  dry-run, khóa job, ghi `maintenance_runs` + audit.
- Scheduler `setInterval` trong `server/src/index.ts` (hoặc module riêng),
  đọc giờ/phút từ `maintenance_settings` mỗi phút.
- API jobs (GET/PUT), settings (GET/PUT), runs, run; gọi Go `reconcile`
  khi sửa job runtime.
- **Nghiệm thu:** dry-run không đổi dữ liệu; chạy thật xóa đúng; lần 2 = 0;
  audit đủ; 409 khi trùng; 403 với admin/user; sửa config áp dụng ngay.

### P07-4 — Go đọc cấu hình DB + retention mở rộng + internal API

- Package `gnss/internal/maintenance`: load/validate/cache config từ `adminDB`.
- Thêm prune 3 bảng runtime; runner theo `interval_sec` từng job.
- `GET /internal/maintenance/status`, `POST /internal/maintenance/prune`,
  `POST /internal/maintenance/reconcile` (HMAC, allowlist, dry-run, timeout).
- Kiểm tra admin schema ≥ 34 + bảng tồn tại khi khởi động; fail-fast nếu thiếu.
- Bỏ các field retention ENV khỏi `config.go`.
- Cập nhật `AGENTS.md` §4/§8: Go được đọc thêm `maintenance_jobs`,
  `maintenance_settings`; cấm ghi.
- Unit test Go cho từng hàm + guard `end_ts IS NULL` + reload config.
- **Nghiệm thu:** `go test ./...` PASS; sửa DB rồi gọi reconcile → Go áp dụng
  ngay; chạy tay qua Node trả đúng số dòng; session đang mở không bị xóa.

### P07-5 — Frontend Tối ưu & Tự động hóa

- `OptimizeTab`, `AutomationTab`, component con, CSS.
- Query keys riêng; refetch thủ công sau khi chạy; toast kết quả.
- **Nghiệm thu:** đủ khối, đủ job, dry-run/chạy thật có xác nhận, lịch sử
  phân trang, empty/error/loading, dark mode, a11y, 390 không tràn.

### P07-6 — Test, docs, graphify, rollout

- Chạy toàn bộ test Node/Go/Playwright; bổ sung test mới.
- Cập nhật `TASKS.md`, `SESSION.md`, `docs/OPS.md` (retention + chạy tay).
- `graphify update .` sau khi cấu trúc ổn định.
- **Nghiệm thu:** DoD §15 PASS; diff review; không secret.

### Ước lượng

| Bước | Công |
|---|---|
| P07-0 | 0.5–1 ngày |
| P07-1 | 0.5 ngày |
| P07-2 | 1–1.5 ngày |
| P07-3 | 2–2.5 ngày |
| P07-4 | 2–2.5 ngày |
| P07-5 | 1.5–2 ngày |
| P07-6 | 1 ngày |
| **Tổng** | **~8.5–11 ngày** |

## 11. Test matrix bắt buộc

| Gate | Nội dung | Công cụ |
|---|---|---|
| T07-1 | Menu `/system`, tab mặc định, deep-link, redirect `/system/health` | Playwright |
| T07-2 | Tab Tối ưu: schema response, fallback `available:false`, cache | Node unit/integration |
| T07-3 | Cleanup admin: dry-run không xóa, batch, guard alert `open`, audit | Node unit + MySQL |
| T07-4 | Cleanup runtime: guard `end_ts IS NULL`, dry-run, allowlist, HMAC | Go unit + integration |
| T07-5 | Chạy trùng job → 409; timeout → error rõ | Node unit |
| T07-6 | Scheduler: tick đúng giờ local, không chạy 2 lần/ngày, disabled flag | Node unit (fake clock) |
| T07-7 | RBAC: `admin`/`user` 403 toàn bộ `system_ops.*`; super_admin OK | Node integration |
| T07-8 | Không lộ secret/DSN trong response/log/audit | Grep + unit |
| T07-9 | Realtime/relay/caster không hồi quy | `go test ./...`, test hiện có |
| T07-10 | A11y/UI: 1440/768/390, dark, focus trap, AA, reduced-motion | Playwright + Taste Skill |
| T07-11 | Migration từ DB hiện tại (33 → 34) không lỗi; rollback | MySQL test |
| T07-12 | `graphify update .` chạy sạch sau thay đổi | graphify |
| T07-13 | Sửa config: validate biên, 400 khi sai, audit before/after, persist | Node unit + MySQL |
| T07-14 | Go reload: reconcile áp dụng ngay; TTL 60s khi không reconcile | Go unit + integration |
| T07-15 | Config DB lỗi/thiếu: Go giữ config cũ hoặc fail-fast đúng D07-27 | Go unit |

## 12. File/khu vực dự kiến

**Mới**

```text
db/migrations/admin/034_maintenance.sql
server/src/lib/systemOptimize.ts
server/src/lib/maintenanceConfig.ts
server/src/lib/maintenance.ts
server/src/lib/maintenanceScheduler.ts
gnss/internal/maintenance/config.go
gnss/internal/maintenance/retention.go
gnss/internal/maintenance/runner.go
frontend/src/pages/System.tsx
frontend/src/pages/system/HealthTab.tsx
frontend/src/pages/system/OptimizeTab.tsx
frontend/src/pages/system/AutomationTab.tsx
frontend/src/components/system/*.tsx
```

**Sửa**

```text
.env.example                  (bỏ retention; ghi chú chuyển sang DB)
server/src/routes/system.ts
server/src/db/seed.ts
server/src/rbac/matrix.ts
server/src/index.ts
server/src/app.ts             (nếu tách router)
gnss/internal/config/config.go
gnss/internal/api/server.go
gnss/internal/relay/retention.go
gnss/internal/quality/store.go
gnss/cmd/corsd/main.go
frontend/src/App.tsx
frontend/src/components/Layout.tsx
frontend/src/styles.css
frontend/src/types.ts
frontend/tests/navigation.spec.ts
AGENTS.md                     (bổ sung bảng Go được đọc)
docs/OPS.md
TASKS.md
SESSION.md
```

**Không chạm**

```text
F:\3.Laptrinh\1. Project\1. GNSS\relayrtcm\backup
```

## 13. Rủi ro và cách xử lý

| Rủi ro | Ảnh hưởng | Xử lý |
|---|---|---|
| `DELETE` khối lớn gây lag | Chậm DB, ảnh hưởng realtime | Batch + `LIMIT`, off-peak, timeout |
| `information_schema` chậm trên DB lớn | Tab Tối ưu chậm | Cache, giới hạn top 20, timeout |
| `performance_schema` tắt | Không có slow query | `available:false` + lý do |
| Nhiều instance Node | Scheduler chạy trùng | Ghi chú; khóa DB ngoài phạm vi |
| Go restart | Mất trạng thái "lần chạy cuối" RAM | Ghi rõ trên UI; lịch sử UI vẫn còn |
| Đổi menu làm fail test cũ | CI đỏ | Cập nhật test trong P07-0 |
| Xóa nhầm alert/session đang mở | Mất dữ liệu vận hành | Guard SQL + unit test bắt buộc |
| Config DB không hợp lệ | Go xóa sai/không dọn | Validate 2 lớp (Node + Go); Go fallback config cũ |
| Go chưa reload sau khi sửa | UI hiển thị mới nhưng chưa áp dụng | Gọi `reconcile` sau PUT; TTL 60s dự phòng |
| Sửa đồng thời 2 super admin | Ghi đè lẫn nhau | `updated_at` optimistic check; audit before/after |
| `OPTIMIZE TABLE` khóa bảng | Gián đoạn dịch vụ | Không tự động; chỉ thủ công có cảnh báo |

## 14. Rollback

1. Revert route/menu: `/system` → `/system/health` (giữ trang cũ nếu chưa xóa).
2. Tắt scheduler: `UPDATE maintenance_settings SET scheduler_enabled = 0;`
   hoặc tắt toàn bộ job: `UPDATE maintenance_jobs SET enabled = 0;`.
3. API mới không ảnh hưởng API cũ; có thể giữ hoặc gỡ route.
4. Migration `034`: 3 bảng + 2 permission. Rollback thủ công:
   `DROP TABLE maintenance_runs; DROP TABLE maintenance_jobs;
    DROP TABLE maintenance_settings;
    DELETE FROM permissions WHERE module='system_ops';`
   và xóa row `schema_migrations` version 34 (chỉ khi thật sự cần).
5. Go retention mới: đặt `enabled=0` hoặc `retention_days` lớn; không cần
   revert schema.
6. Không rollback dữ liệu đã xóa — retention là không hồi phục; dry-run + audit
   là lớp bảo vệ.
7. Khôi phục hành vi cũ (nếu cần): migration seed đúng giá trị ENV trước đây,
   nên chỉ cần rollback Go về bản đọc ENV (không khuyến nghị, vì đã bỏ ENV).

## 15. Definition of Done

1. Tiêu chí §2.2 thoả, có bằng chứng test.
2. Test matrix §11 chạy đủ, ghi PASS/FAIL.
3. Không còn FAIL chưa xử lý (hoặc ghi issue).
4. Không secret trong diff; audit redact.
5. Diff review xong.
6. `SESSION.md` + `TASKS.md` + `docs/OPS.md` cập nhật.
7. `graphify update .` chạy sau thay đổi cấu trúc.
8. Không chạm thư mục relay backup; không chạy `relay.exe`; không chiếm
   cổng 8081/2101.

## 16. Việc để sau (ngoài kế hoạch 07)

- Gộp toàn bộ trang admin (Cảnh báo/Lịch sử/Người dùng/Công ty/Phân quyền)
  thành tab trong `/system`.
- Khóa phân tán cho scheduler khi scale nhiều instance Node.
- Backup/restore UI (Phase 11).
- `OPTIMIZE TABLE` có lịch + đo khóa bảng.
- Biểu đồ lịch sử tăng trưởng (cần lưu time-series; hiện chỉ tính tức thời).

## 17. Kết quả thực hiện

| Bước | Trạng thái | Commit | Test | Ghi chú |
|---|---|---|---|---|
| P07-0 | DONE | `feat(system): P07-0 menu Hệ thống và tab mặc định Sức khỏe` | server build PASS; frontend build PASS; Playwright `system-health` + `navigation` 2/2 PASS | `/system` + 3 tab; `/system/health` redirect; menu còn 1 mục Hệ thống; HealthTab tách khỏi `SystemHealth.tsx` (đã xóa) |
| P07-1 | DONE | `feat(system): P07-1 bảng cấu hình bảo trì và quyền system_ops` | migrate 034 PASS; server build PASS; vitest 74/74 PASS | 11 job + 1 settings + 2 permission; super_admin 2 grant, admin/user 0; bỏ retention khỏi `.env.example` |
| P07-2 | DONE | `feat(system): P07-2 API tối ưu chỉ số hệ thống` | server build PASS; vitest 80/80 PASS; API superadmin 200, 11 retention job | `GET /api/system/optimize`; fallback performance_schema; cache 20s; API admin 403 BLOCKED do thiếu mật khẩu admin local khớp (matrix test PASS) |
| P07-3 | PENDING | | | |
| P07-4 | PENDING | | | |
| P07-5 | PENDING | | | |
| P07-6 | PENDING | | | |

Bằng chứng P07-0:
- `cd server; npm run build` → PASS.
- `cd frontend; npm run build` → PASS (tsc + vite).
- `npx playwright test tests/system-health.spec.ts tests/navigation.spec.ts`
  → 2 passed. E2E dùng mật khẩu seed local qua biến môi trường, không in giá trị.
- `docker compose restart web` để Vite nạp mã mới; không chạm cổng 8081/2101.

Bằng chứng P07-1:
- `docker exec -w /app cors-mvp-server-1 npm run migrate`
  → `[migrate] admin 034_maintenance.sql applied`.
- Kiểm tra DB (không in secret): `jobs=11`, `settings=1`, `perms=2`,
  `grants(super_admin)=2`, `denied(admin/user)=0`.
- `docker exec -w /app cors-mvp-server-1 npm run build` → PASS.
- `docker exec -w /app cors-mvp-server-1 npm test` → 12 files / 74 tests PASS.

Bằng chứng P07-2:
- `docker exec -w /app cors-mvp-server-1 npm run build` → PASS.
- `docker exec -w /app cors-mvp-server-1 npm test` → 13 files / 80 tests PASS
  (thêm `systemOptimize.test.ts` 6 test).
- `GET /api/system/optimize` với superadmin → 200; `database.status=ok`,
  `retention.jobs=11`; response không chứa DSN/secret.
- `GET /api/system/optimize` với admin → BLOCKED: không có mật khẩu admin
  local khớp; thay thế bằng `matrix.test.ts` (admin/user = none).
