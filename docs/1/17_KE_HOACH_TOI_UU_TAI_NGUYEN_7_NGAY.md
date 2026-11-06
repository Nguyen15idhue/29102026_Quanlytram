# 17 — KẾ HOẠCH TỐI ƯU TÀI NGUYÊN: RETENTION 7 NGÀY & GIẢM RAM/DISK

> Ngày lập: 2026-11-06
> Trạng thái: **KẾ HOẠCH ĐÃ CHỐT — CHƯA TRIỂN KHAI**
> Quyết định đã chốt: **1A, 2A, 3B, 4A, 5A, 6 (xoá tất cả alert admin theo tuổi),
> 7A, 8A, 9A, 10C**.
> Nguyên tắc bắt buộc:
> - **Local-first**: làm và test trên local trước.
> - **Không sửa prod** trong quá trình lập kế hoạch.
> - Chỉ chuyển lên prod sau khi chủ dự án **duyệt thủ công** diff + evidence.
> - Không nâng RAM/ổ cứng.
> - Không đổi luồng byte RTCM, không chặn relay/caster, không auto-disable job/probe.
>
> Tham chiếu:
> - `AGENTS.md`
> - `docs/OPS.md`
> - `docs/1/11_BAO_CAO_TOI_UU_TAI_NGUYEN.md`
> - `docs/1/16_KE_HOACH_DANH_SACH_ONLINE_VA_CAC_HANG_MUC.md`
> - `docs/3/KE_HOACH_DEPLOY_VPS_2026-11-03.md`

---

## 0. Chốt yêu cầu

1. **Không nâng RAM, không nâng ổ cứng.**
2. Giảm RAM hiện tại và RAM tăng theo ngày.
3. Giảm dung lượng ổ cứng hiện tại và tốc độ tăng trong tương lai.
4. **Retention dữ liệu chi tiết: 7 ngày** thay vì 30/35/90/365 ngày.
5. **`quality-alerts`: xoá tất cả bản ghi cũ hơn 7 ngày**, kể cả alert **chưa resolve**
   (`resolved_at IS NULL`). Đây là quyết định của chủ dự án; không giữ điều kiện
   `resolved_at IS NOT NULL` như hiện tại.
6. **`alerts` admin: xoá tất cả alert cũ hơn 7 ngày**, không quan tâm `status`
   (`open`/`acked`) và không cần relay về `streaming`. Alert cũ vẫn bị dọn.
7. Giữ các aggregate nhỏ cần cho biểu đồ:
   - `relay-hourly`: giữ **90 ngày** (rất nhỏ, phục vụ chart 30 ngày).
   - `audit-logs`: giữ **365 ngày** (compliance, hiện ~0.4 MB).
   - `web-sessions`: giữ **7 ngày**.
8. Không thay đổi:
   - Nội dung byte RTCM; chỉ giảm buffer đệm của relay, không sửa frame.
   - `gnss/internal/caster/*` về xác thực/nguồn.
   - Không xoá bảng, không drop cột, không đổi schema `quality_alerts` ngoài index.
   - Không export CSV `quality_alerts` (quyết định 10C).

---

## 1. Baseline đo được trên prod (2026-11-06, chỉ đọc)

> Các số dưới đây lấy từ VPS `43.240.117.54`, user `deploy`, **không sửa gì**.
> Dùng làm mốc so sánh sau khi tối ưu local/prod.

### 1.1 Tài nguyên

| Thành phần | Hiện tại | Peak | Limit | Swap |
|---|---:|---:|---:|---:|
| MySQL | ~1.05 GB (cgroup) | **1.40 GB** | 1.40 GB | **699 MB** |
| gnss (Go) | ~220 MB | **700 MB** | 700 MB | peak 205 MB |
| server (Node) | ~95 MB | 144 MB | 700 MB | 0 |
| caddy | ~42 MB | 81 MB | 128 MB | 0 |
| web-prod | ~9 MB | 14 MB | 128 MB | 0 |

- Host: 3.8 GB RAM, dùng ~2.4 GB, swap đã dùng ~788 MB.
- CPU: load average 0.09–0.16; CPU tổng ~10–15%/2 core → **CPU không phải nút cổ chai**.
- Disk: **17 GB / 40 GB**, còn 24 GB.
- Không có OOM kill; nhưng MySQL và Go đều đã chạm `mem_limit`, gây reclaim/swap.

### 1.2 Disk

| Hạng mục | Hiện tại | Tốc độ / ghi chú |
|---|---:|---|
| `binlog.000002` + `binlog.000003` | ~1.96 GB | ~1.02 GB/ngày; expiry 30 ngày |
| `quality_samples` | 307 MB / 330.804 rows | +125 rows/phút ≈ 180k rows/ngày |
| `relay_sessions` | 17 MB / 78.8k rows | ~1.000 session/giờ |
| `caster_connections` | 12.6 MB / 31.4k rows | retention 90 ngày |
| `rtcm_message_stats` | 12 MB / 42k rows | retention 365 ngày |
| `relay_events` | 8.5 MB / 65k rows | retention 30 ngày |
| `alerts` | 5.1 MB / 8.661 open | alert backoff không tự resolve |
| `quality_alerts` | 1.0 MB / 3.256 rows | retention 90 ngày, chỉ xoá resolved |
| Backup MySQL | ~15 MB/ngày | retention 14 ngày, không đáng kể |
| Docker build cache | 3.3 GB | **2.6 GB reclaimable** |
| Image cũ | 387 MB | reclaimable |

### 1.3 Nguyên nhân chính

1. **Binlog 30 ngày**: ~1 GB/ngày → sẽ chiếm ~30 GB.
2. **`quality_samples` 35 ngày**: ~180k rows/ngày × ~0.9 KB → ~170–190 MB/ngày;
   steady state ~6 GB.
3. **MySQL buffer pool 768 MB + performance_schema**: MySQL ~1.05 GB, peak 1.4 GB,
   đã swap 699 MB.
4. **Go buffer relay**: mỗi job có `monitorCh` 256 slot + `writeCh` 256 slot +
   `ReadBuffer` 32 KB; worst-case 47 job streaming ≈ 700–770 MB.
5. **Relay flapping**: 10 job `backoff`, 2 `connecting`, ~1.000 session/giờ;
   tạo thêm session/event/alert và làm Go cấp phát buffer lại.
6. **Alert admin không được dọn theo tuổi**: 8.661 `relay.state.backoff` open;
   job retention `acked-alerts` chỉ xoá alert đã ack, nên alert open cũ tồn tại mãi.

---

## 2. Mục tiêu & KPI

| Chỉ số | Hiện tại | Mục tiêu sau tối ưu |
|---|---:|---:|
| Disk used | 17 GB | **≤ 12 GB sau dọn ngay**; **≤ 15 GB steady state** |
| Disk free | 24 GB | **≥ 25 GB** |
| Binlog | ~1.96 GB, +1 GB/ngày | **0** (tắt binlog — quyết định 3B) |
| `quality_samples` | 307 MB | **≤ 1.3 GB** (7 ngày, 60s — quyết định 4A) |
| `quality_alerts` | 3.256 rows | **≤ 7 ngày dữ liệu**, xoá cả open |
| `alerts` admin | 8.661 open | **≤ 7 ngày**, xoá cả open/acked |
| RAM host used | ~2.4 GB + 0.8 GB swap | **≤ 2.2 GB, swap ≤ 100 MB** |
| Go peak | 700 MB | **≤ 450 MB** (GOMEMLIMIT), sau code ≤ 300 MB |
| Relay streaming | 47/59 | **không giảm**, không tăng lỗi |
| RTCM drop do tối ưu | — | **0** (không đổi byte path) |

**Điều kiện không được vi phạm:**
- Không tăng `downstream backlog`, `monitorDrop`, `quality dropped` do cấu hình mới.
- Không làm chậm đáng kể dashboard/realtime.
- Không mất dữ liệu audit.
- Không làm hỏng backup/restore.

---

## 3. Chính sách retention 7 ngày

### 3.1 Bảng cấu hình

| Job key | Bảng | Hiện tại | Đề xuất | Ghi chú |
|---|---|---:|---:|---|
| `quality-samples` | `quality_samples` | 35 | **7** | Giảm mạnh nhất |
| `quality-alerts` | `quality_alerts` | 90 | **7** | **Xoá tất cả**, kể cả open |
| `relay-events` | `relay_events` | 30 | **7** | Sự kiện relay |
| `relay-sessions` | `relay_sessions` | 90 | **7** | Phiên relay |
| `caster-connections` | `caster_connections` | 90 | **7** | Phiên caster |
| `station-sessions` | `station_source_sessions` | 90 | **7** | Phiên nguồn trạm |
| `rtcm-message-stats` | `rtcm_message_stats` | 365 | **7** | Thống kê message gần |
| `acked-alerts` | `alerts` | 180 | **7** | **Xoá tất cả alert admin**, kể cả open |
| `relay-hourly` | `relay_hourly` | 90 | **90** | Giữ vì rất nhỏ, cần chart 30 ngày |
| `audit-logs` | `audit_logs` | 365 | **365** | Compliance |
| `web-sessions` | `web_sessions` | 7 | **7** | Giữ nguyên |

> `acked-alerts` giữ nguyên `job_key` để không phá API/UI hiện có, nhưng đổi nghĩa
> thành **dọn tất cả alert admin**; label trong DB đổi thành “Tất cả cảnh báo”.
> Điều kiện mới dùng `created_at`, không dùng `acked_at`/`status`.

### 3.2 Quyết định riêng cho `quality-alerts`

**Chốt: xoá tất cả bản ghi có `last_seen < now - 7 days`, không lọc `resolved_at`.**

Điều kiện mới:

```sql
DELETE FROM quality_alerts
WHERE last_seen < UTC_TIMESTAMP(3) - INTERVAL 7 DAY
ORDER BY id
LIMIT ?;
```

Hệ quả:
- Alert `quality.*` **chưa resolve** nhưng cũ hơn 7 ngày sẽ bị xoá.
- UI/API quality alerts chỉ còn dữ liệu 7 ngày.
- Nếu điều kiện lỗi vẫn đang diễn ra, analyzer có thể tạo alert mới ở lần đánh giá tiếp theo;
  alert mới sẽ có `last_seen` mới và tiếp tục được giữ tới khi quá 7 ngày.
- Không ảnh hưởng relay/caster/probe; đây là dữ liệu phân tích/chất lượng.
- Không thể khôi phục nếu không có backup → vẫn backup DB theo quy trình chung
  trước lần chạy đầu, nhưng **không export CSV riêng** (quyết định 10C).

### 3.3 Vì sao giữ `relay-hourly` 90 ngày

- Bảng hiện chỉ ~0.3 MB / 2.021 rows.
- Dùng cho biểu đồ lịch sử 30 ngày (`frontend/src/components/EntityHistory.tsx`,
  tab `hourly`).
- Giữ 90 ngày gần như không tốn disk, tránh mất chức năng xem 30 ngày.
- Đã chốt giữ 90 ngày (quyết định 2A); nếu sau này muốn tất cả 7 ngày thì đổi
  và chấp nhận chart 30 ngày chỉ còn 7 ngày.

### 3.4 Quyết định riêng cho `alerts` admin

**Chốt: xoá tất cả alert có `created_at < now - 7 days`, không quan tâm `status`.**

Điều kiện mới:

```sql
DELETE FROM alerts
WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 7 DAY
ORDER BY id
LIMIT ?;
```

Hệ quả:
- Alert `relay.state.backoff`, `relay.state.error`, `system.*` cũ hơn 7 ngày đều bị xoá,
  kể cả đang `open` và kể cả relay không bao giờ trở lại `streaming`.
- Không cần logic auto-resolve theo trạng thái relay.
- Alert mới vẫn được tạo bình thường; chỉ alert cũ hơn 7 ngày bị dọn.
- `acked-alerts` hiện là job admin phía Node, không phải Go; sửa ở
  `server/src/lib/maintenance.ts`.
- Không ảnh hưởng `quality_alerts` (bảng runtime, job riêng).

---

## 4. Thay đổi kỹ thuật chi tiết

### 4.1 `quality-alerts` xoá tất cả — Go maintenance

**File:** `gnss/internal/maintenance/retention.go`

Hiện tại:

```go
"quality-alerts": {
    table: "quality_alerts",
    where: func(days int) string {
        return fmt.Sprintf("resolved_at IS NOT NULL AND last_seen < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days)
    },
    orderBy: "id",
},
```

Đổi thành:

```go
"quality-alerts": {
    table: "quality_alerts",
    where: func(days int) string {
        return fmt.Sprintf("last_seen < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days)
    },
    orderBy: "id",
},
```

**File:** `gnss/internal/quality/store.go`

Hàm `Prune` hiện cũng lọc `resolved_at IS NOT NULL`. Đổi cho đồng bộ:

```go
DELETE FROM quality_alerts
WHERE last_seen < ?
ORDER BY id
LIMIT ?
```

> Nếu hàm `Prune` không còn được dùng, ghi chú rõ trong code và vẫn sửa để tránh
> hành vi lệch với maintenance runner.

**File:** `gnss/internal/maintenance/runner_test.go`

- Bỏ `"quality-alerts": "resolved_at IS NOT NULL"` khỏi `TestSpecsKeepOpenRows`.
- Thêm test mới khẳng định điều kiện mới **không chứa** `resolved_at`:
  - `TestQualityAlertsDeletesAllOldRows`
  - Kiểm tra `specs["quality-alerts"].where(7)` chứa `last_seen` và không chứa
    `resolved_at`.
- Thêm test prune với dữ liệu giả nếu runner có fake DB hỗ trợ.

### 4.2 Index cho `quality_alerts`

Điều kiện mới `WHERE last_seen < ? ORDER BY id` không dùng tốt index hiện tại
`idx_quality_alerts_open (resolved_at, last_seen)`. Thêm migration runtime:

**File mới:** `db/migrations/runtime/009_quality_alerts_last_seen_index.sql`

```sql
ALTER TABLE quality_alerts
  ADD KEY idx_quality_alerts_last_seen (last_seen, id);
```

- Giữ nguyên `idx_quality_alerts_open` cho query alert đang mở.
- Index mới hỗ trợ retention và lịch sử theo thời gian.
- Migration idempotent theo framework hiện có; nếu chạy lại phải báo đã tồn tại.

### 4.3 Migration cấu hình retention 7 ngày

**File mới:** `db/migrations/admin/042_retention_7d.sql`

```sql
UPDATE maintenance_jobs
   SET retention_days = 7
 WHERE job_key IN (
   'quality-samples',
   'quality-alerts',
   'relay-events',
   'relay-sessions',
   'caster-connections',
   'station-sessions',
   'rtcm-message-stats',
   'acked-alerts'
 );

UPDATE maintenance_jobs
   SET label = 'Tất cả cảnh báo'
 WHERE job_key = 'acked-alerts';
```

**File mới:** `db/migrations/admin/043_alerts_created_index.sql`

```sql
ALTER TABLE alerts
  ADD KEY idx_alerts_created (created_at);
```

Không sửa `034_maintenance.sql` (migration cũ đã chạy). Migration mới đảm bảo:
- Local mới và prod hiện tại đều có cùng giá trị.
- Có thể audit qua `schema_migrations` + `maintenance_jobs.updated_at`.
- `relay-hourly`, `audit-logs`, `web-sessions` giữ nguyên.
- Index `created_at` hỗ trợ job dọn `alerts` không quét bảng.

### 4.4 Server: backlog SQL phải khớp điều kiện mới

**File:** `server/src/lib/systemOptimize.ts`

Đổi cả `quality-alerts` và `acked-alerts`:

```ts
'quality-alerts': {
  schema: 'runtime',
  table: 'quality_alerts',
  condition: (days) => `last_seen < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
},
'acked-alerts': {
  schema: 'admin',
  table: 'alerts',
  condition: (days) => `created_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`
},
```

Nếu không đổi, tab “Tối ưu chỉ số” sẽ báo backlog sai:
- `quality-alerts`: chỉ đếm resolved trong khi job thật xoá cả open.
- `acked-alerts`: chỉ đếm alert đã ack trong khi job thật xoá cả open.

### 4.5 UI: cảnh báo khi chạy/xoá alert

**File:** `frontend/src/pages/system/AutomationTab.tsx`

- Trong dialog xác nhận chạy job:
  - `runTarget.key === 'quality-alerts'`: cảnh báo “xoá **tất cả** quality alert
    cũ hơn N ngày, kể cả alert chưa resolve. Không thể hoàn tác.”
  - `runTarget.key === 'acked-alerts'`: cảnh báo “xoá **tất cả** alert admin cũ hơn
    N ngày, kể cả alert đang open/chưa ack. Không thể hoàn tác.”
- Không cần đổi layout; chỉ thêm text cảnh báo.

### 4.6 RAM: MySQL

**File:** `docker-compose.prod.yml` (và override local nếu cần)

```yaml
command:
  - --default-time-zone=+00:00
  - --character-set-server=utf8mb4
  - --collation-server=utf8mb4_0900_ai_ci
  - --innodb-buffer-pool-size=512M
  - --max-connections=60
```

- Giảm buffer pool 768 → 512 MB: tiết kiệm ~256 MB.
- `max_connections` 150 → 60: hiện max dùng chỉ 23; đủ headroom.
- Không giảm dưới 384 MB nếu chưa đo lại I/O.
- Có thể dùng `SET GLOBAL innodb_buffer_pool_size = 536870912;` để thử local,
  nhưng vẫn phải sửa compose để giữ sau restart.

### 4.7 RAM: Go

**File:** `docker-compose.prod.yml` / `.env.production` (local dùng override)

```env
GOMEMLIMIT=450MiB
GOGC=50
QUALITY_QUEUE_BYTES=8388608
QUALITY_QUEUE_SIZE=1024
```

- `GOMEMLIMIT` chặn Go phình tới 700 MB.
- `GOGC=50` giảm high-water mark; CPU hiện rất thấp nên đánh đổi an toàn.
- Queue quality giảm 16 → 8 MB; khi đầy thì drop sample, không chặn byte path.

### 4.8 RAM: giảm buffer relay (Phase code, cần test mock)

**File:** `gnss/internal/relay/bridge.go`

Hiện tại `DefaultOptions()`:

```go
MonitorBuffer:    256,
ReadBuffer:       32 * 1024,
DownstreamBuffer: 256,
```

Đề xuất:

```go
MonitorBuffer:    32,
ReadBuffer:       8 * 1024,
DownstreamBuffer: 64,
```

Ước tính:
- Mỗi job worst-case: `32×8KB + 64×8KB ≈ 768 KB` thay vì ~16 MB.
- 47 job streaming: **< 40 MB** thay vì ~700 MB.
- Vẫn đủ đệm cho RTCM 1–4 KB/s; nếu downstream chậm, 64 slot × 8 KB = 512 KB/job.
- Nếu cần an toàn hơn: `MonitorBuffer 64`, `DownstreamBuffer 128`, `ReadBuffer 8KB`.
- **Bắt buộc** test mock trước khi áp dụng:
  `scripts/load-test-mock.ps1 -Jobs 20`, sau đó `-Jobs 50` nếu máy đủ tài nguyên.
- Tiêu chí: không có `downstream backlog`, `streaming=20/20`, không tăng
  `monitorDrop` bất thường.

### 4.9 Disk: tắt binlog (quyết định 3B)

**Chốt: tắt binlog**, không giữ 7 ngày. Chỉ làm sau khi xác nhận:
- Không có replica.
- Không cần PITR (point-in-time recovery).
- Backup hiện tại là `mysqldump` + dump định kỳ, đủ để restore.

**Local test:**
1. Thêm `--skip-log-bin` vào command MySQL local.
2. Restart MySQL local.
3. Kiểm tra:
   ```sql
   SHOW VARIABLES LIKE 'log_bin';   -- OFF
   SHOW BINARY LOGS;                -- rỗng/lỗi tùy phiên bản
   ```
4. Chạy stack + load test mock; xác nhận ghi DB bình thường.

**Prod (chỉ sau duyệt):**
1. Backup DB trước.
2. Trước khi tắt, purge binlog cũ để giải phóng nhanh:
   ```sql
   PURGE BINARY LOGS BEFORE NOW() - INTERVAL 1 DAY;
   ```
3. Thêm `--skip-log-bin` vào `docker-compose.prod.yml`:
   ```yaml
   command:
     - --default-time-zone=+00:00
     - --character-set-server=utf8mb4
     - --collation-server=utf8mb4_0900_ai_ci
     - --innodb-buffer-pool-size=512M
     - --max-connections=60
     - --skip-log-bin
   ```
4. Restart MySQL:
   ```bash
   docker compose up -d mysql
   ```
5. Kiểm tra `log_bin = OFF`; sau đó có thể xoá các file `binlog.*` còn lại
   **chỉ khi MySQL đã dừng và đã backup**, hoặc để nguyên nếu muốn giữ làm dấu vết.
6. Ghi chú: khi binlog tắt, không còn PITR. Nếu sau này cần bật lại, bỏ
   `--skip-log-bin`, restart, và chấp nhận binlog mới bắt đầu từ thời điểm đó.

**Ảnh hưởng:**
- Không còn tăng ~1 GB/ngày; tiết kiệm ~7 GB so với giữ 7 ngày, ~30 GB so với 30 ngày.
- Giảm I/O đáng kể; `sync_binlog` không còn tác dụng.
- `innodb_flush_log_at_trx_commit=1` vẫn giữ nguyên; không đổi durability của InnoDB.
- Mất khả năng PITR trong thời gian binlog tắt.

### 4.10 Disk: dọn Docker

**Prod (chỉ sau duyệt):**
```bash
docker builder prune -f
docker image prune -f
```
- Giải phóng ~2.6 GB build cache + ~0.39 GB image cũ.
- Không ảnh hưởng container/volume đang chạy.
- Không dùng `docker system prune -a --volumes`.

### 4.11 Alert admin: xoá tất cả theo tuổi (quyết định 6)

`quality-alerts` **không** dọn `cors_admin.alerts`. Hiện có 8.661 alert
`relay.state.backoff` open. Chủ dự án chốt: **cứ đủ 7 ngày là xoá, không quan tâm
trạng thái relay hay status alert**.

**File:** `server/src/lib/maintenance.ts`

Đổi `ADMIN_SPECS['acked-alerts']`:

```ts
'acked-alerts': {
  table: 'alerts',
  where: (days) => `created_at < UTC_TIMESTAMP(3) - INTERVAL ${days} DAY`,
  orderBy: 'id'
}
```

- Không còn `status = 'acked'`.
- Không còn `acked_at IS NOT NULL`.
- Không cần auto-resolve theo `streaming`.
- Alert `open` cũ hơn 7 ngày vẫn bị xoá.

**File:** `server/src/lib/systemOptimize.ts`

Đồng bộ backlog SQL như mục 4.4.

**File:** `db/migrations/admin/043_alerts_created_index.sql`

Thêm index `idx_alerts_created (created_at)` để job dọn không quét bảng.

**Hệ quả:**
- Bảng `alerts` chỉ còn alert trong 7 ngày gần nhất.
- Các alert `relay.state.backoff` open cũ sẽ biến mất khỏi UI sau 7 ngày.
- Nếu lỗi vẫn còn, Node sẽ tạo alert mới ở lần đánh giá tiếp theo; alert mới
  có `created_at` mới và tiếp tục được giữ tới khi quá 7 ngày.
- Không ảnh hưởng byte RTCM; đây là dữ liệu cảnh báo/UI.

---

## 5. Kế hoạch thực hiện local

### Phase L0 — Chuẩn bị

- Tạo nhánh: `feat/plan17-resource-7d`.
- Backup DB local:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-mysql.ps1
  ```
- Ghi baseline local:
  ```sql
  SELECT job_key, retention_days FROM cors_admin.maintenance_jobs ORDER BY job_key;
  SELECT COUNT(*) FROM cors_runtime.quality_alerts;
  SELECT COUNT(*) FROM cors_runtime.quality_samples;
  SELECT COUNT(*) FROM cors_admin.alerts;
  SHOW VARIABLES LIKE 'log_bin';
  SHOW BINARY LOGS;
  ```
- Tạo thư mục evidence: `docs/1/evidence/plan17/`.
- **Acceptance:** baseline lưu vào `docs/1/evidence/plan17/baseline.txt`.

### Phase L1 — Retention 7 ngày + `quality-alerts`/`alerts` xoá tất cả

**Files:**
- `db/migrations/admin/042_retention_7d.sql` (mới)
- `db/migrations/admin/043_alerts_created_index.sql` (mới)
- `gnss/internal/maintenance/retention.go`
- `gnss/internal/quality/store.go`
- `gnss/internal/maintenance/runner_test.go`
- `server/src/lib/maintenance.ts`
- `server/src/lib/systemOptimize.ts`
- `frontend/src/pages/system/AutomationTab.tsx`
- `docs/OPS.md`

**Việc làm:**
1. Tạo migration 042 với danh sách job ở mục 4.3.
2. Đổi điều kiện `quality-alerts` trong Go (mục 4.1).
3. Đổi `quality/store.go` cho đồng bộ.
4. Đổi `ADMIN_SPECS['acked-alerts']` trong `server/src/lib/maintenance.ts`
   (mục 4.11) sang `created_at`, bỏ lọc `status/acked_at`.
5. Đổi `BACKLOG_SQL` phía server cho cả `quality-alerts` và `acked-alerts`.
6. Thêm cảnh báo UI cho cả hai job.
7. Cập nhật `docs/OPS.md`: bảng retention + ghi chú xoá cả open alert.

**Test local:**
```powershell
cd gnss
go test ./...

cd ..\server
npx vitest run

cd ..\frontend
npx tsc --noEmit
```

**Test hành vi xoá tất cả:**

Tạo fixture local (chỉ local):
```sql
INSERT INTO cors_runtime.quality_alerts
(target_type, target_id, mountpoint_id, direction, event_type, code, level,
 first_seen, last_seen, resolved_at)
VALUES
('relay_job', 999999, 0, 'upstream', 'station_alert', 'test.old_open', 'minor',
 UTC_TIMESTAMP(3) - INTERVAL 10 DAY, UTC_TIMESTAMP(3) - INTERVAL 10 DAY, NULL),
('relay_job', 999999, 0, 'upstream', 'station_alert', 'test.old_resolved', 'minor',
 UTC_TIMESTAMP(3) - INTERVAL 10 DAY, UTC_TIMESTAMP(3) - INTERVAL 9 DAY,
 UTC_TIMESTAMP(3) - INTERVAL 9 DAY),
('relay_job', 999999, 0, 'upstream', 'station_alert', 'test.recent_open', 'minor',
 UTC_TIMESTAMP(3) - INTERVAL 1 DAY, UTC_TIMESTAMP(3) - INTERVAL 1 DAY, NULL);
```

Chạy job `quality-alerts` với retention 7 (UI `Hệ thống → Tự động hóa → Chạy`,
hoặc gọi internal API local). Kỳ vọng:
- `test.old_open`: **bị xoá**.
- `test.old_resolved`: **bị xoá**.
- `test.recent_open`: **còn**.
- Không còn row nào `last_seen < now - 7 days`.
- Dọn fixture: `DELETE FROM quality_alerts WHERE code LIKE 'test.%';`

**Test `alerts` admin xoá tất cả:**

Tạo fixture local (chỉ local):
```sql
INSERT INTO cors_admin.alerts
(type, severity, target_type, target_id, title, message, dedupe_key,
 owner_web_user_id, created_at, status)
VALUES
('test.old_open', 'warning', 'relay_job', 999999, 'old open', 'old open',
 'test:old_open', NULL, UTC_TIMESTAMP(3) - INTERVAL 10 DAY, 'open'),
('test.old_acked', 'warning', 'relay_job', 999999, 'old acked', 'old acked',
 'test:old_acked', NULL, UTC_TIMESTAMP(3) - INTERVAL 10 DAY, 'acked'),
('test.recent_open', 'warning', 'relay_job', 999999, 'recent open', 'recent open',
 'test:recent_open', NULL, UTC_TIMESTAMP(3) - INTERVAL 1 DAY, 'open');
```

Chạy job `acked-alerts` với retention 7. Kỳ vọng:
- `test.old_open`: **bị xoá** (dù status open).
- `test.old_acked`: **bị xoá**.
- `test.recent_open`: **còn**.
- `SELECT COUNT(*) FROM alerts WHERE created_at < now - 7 days` = 0.
- Dọn fixture: `DELETE FROM alerts WHERE dedupe_key LIKE 'test:%';`

**Acceptance:**
- `quality-alerts` không còn chứa `resolved_at` trong điều kiện prune.
- `quality_alerts` cũ hơn 7 ngày = 0 sau khi chạy.
- `quality_alerts` mới hơn 7 ngày vẫn còn.
- `alerts` admin cũ hơn 7 ngày = 0, kể cả status `open`.
- `alerts` mới hơn 7 ngày vẫn còn.
- `systemOptimize` báo backlog khớp với cả hai job.
- UI hiển thị cảnh báo “xoá cả alert chưa resolve/chưa ack”.

### Phase L2 — RAM config

**Files:**
- `docker-compose.override.yml` local (không commit secret)
- `docker-compose.prod.yml` (chỉ sửa khi chuẩn bị deploy, sau duyệt)
- `.env.local` (không commit)

**Việc làm:**
1. MySQL: buffer pool 512M, max_connections 60.
2. Go: `GOMEMLIMIT=450MiB`, `GOGC=50`, quality queue 8 MB/1024.
3. Recreate `mysql`, `gnss`.
4. Đo lại bằng `docker stats`, cgroup `memory.current/peak`, `memory.events`.

**Test tải:**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/load-test-mock.ps1 -Jobs 20
```

**Acceptance:**
- `streaming=20/20`.
- Không có `downstream backlog`, `monitorDrop` không tăng bất thường.
- Go RSS < 350 MB, peak < 450 MB.
- MySQL RSS/working set giảm ~250 MB.
- Host swap delta < 50 MB trong 30 phút test.

### Phase L3 — Giảm buffer relay (code)

**File:** `gnss/internal/relay/bridge.go`

**Việc làm:**
1. Đổi default buffer như mục 4.8.
2. Chạy `go test ./...`.
3. Chạy load test mock 20 job, sau đó 50 job nếu đủ tài nguyên.
4. So sánh peak RSS trước/sau; ghi evidence.

**Acceptance:**
- Không có `downstream backlog`.
- Không tăng `monitorDrop`/`quality dropped` đáng kể.
- Peak Go giảm rõ rệt (mục tiêu ≤ 300–450 MB).
- Không đổi nội dung byte: test byte-exact hiện có vẫn PASS.

### Phase L4 — Disk local

**Việc làm:**
1. Thêm `--skip-log-bin` vào MySQL local (mục 4.9).
2. Restart MySQL local; kiểm tra `log_bin = OFF`.
3. Purge binlog cũ trước khi tắt; xoá file còn lại nếu cần (sau backup).
4. Chạy `docker builder prune -f` local.
5. Ghi dung lượng trước/sau.

**Acceptance:**
- `SHOW VARIABLES LIKE 'log_bin'` = OFF.
- Không còn binlog mới sinh ra.
- Disk local giảm tương ứng.
- Không ảnh hưởng backup/restore.

### Phase L5 — Tổng kiểm tra local

```powershell
cd gnss; go test ./...
cd ..\server; npx vitest run
cd ..\frontend; npx tsc --noEmit
```

- Chạy Playwright liên quan:
  - `npx playwright test tests/system-ops.spec.ts`
  - `npx playwright test tests/navigation.spec.ts`
- Kiểm tra diff:
  ```powershell
  git diff --stat
  git diff
  ```
- Không có secret/`.env.local` trong diff.
- Cập nhật `SESSION.md`: đã làm / test / việc còn lại.
- Ghi evidence vào `docs/1/evidence/plan17/`.

---

## 6. Test plan chi tiết

### 6.1 Go

| Test | Mục tiêu |
|---|---|
| `go test ./internal/maintenance/...` | Spec `quality-alerts` xoá cả open |
| `go test ./internal/quality/...` | `Prune` đồng bộ điều kiện mới |
| `go test ./internal/relay/...` | Byte-exact, buffer, backlog không đổi |
| `go test ./...` | Không regression |

### 6.2 Server

| Test | Mục tiêu |
|---|---|
| `tests/maintenance.test.ts` | Cấu hình retention 7 ngày; `acked-alerts` xoá cả open |
| `tests/systemOptimize.test.ts` | Backlog `quality-alerts` dùng `last_seen`; `acked-alerts` dùng `created_at` |
| `npx vitest run` | Toàn bộ |

### 6.3 Frontend

| Test | Mục tiêu |
|---|---|
| `npx tsc --noEmit` | Typecheck |
| `tests/system-ops.spec.ts` | Tab automation/optimize |
| `tests/navigation.spec.ts` | Không vỡ điều hướng |

### 6.4 SQL acceptance

```sql
-- 1. Cấu hình đúng 7 ngày
SELECT job_key, retention_days
  FROM cors_admin.maintenance_jobs
 WHERE job_key IN ('quality-samples','quality-alerts','relay-events',
                   'relay-sessions','caster-connections','station-sessions',
                   'rtcm-message-stats','acked-alerts');
-- Kỳ vọng: tất cả = 7

-- 2. Không còn quality alert cũ
SELECT COUNT(*) AS old_rows
  FROM cors_runtime.quality_alerts
 WHERE last_seen < UTC_TIMESTAMP(3) - INTERVAL 7 DAY;
-- Kỳ vọng: 0

-- 3. Alert mới vẫn còn
SELECT COUNT(*) AS recent_rows
  FROM cors_runtime.quality_alerts
 WHERE last_seen >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY;
-- Kỳ vọng: > 0 (nếu có dữ liệu)

-- 4. Index mới tồn tại
SHOW INDEX FROM cors_runtime.quality_alerts
 WHERE Key_name = 'idx_quality_alerts_last_seen';

-- 5. Alert admin cũ đã bị xoá, kể cả open
SELECT COUNT(*) AS old_admin_alerts
  FROM cors_admin.alerts
 WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 7 DAY;
-- Kỳ vọng: 0

-- 6. Alert admin mới vẫn còn
SELECT COUNT(*) AS recent_admin_alerts
  FROM cors_admin.alerts
 WHERE created_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY;
-- Kỳ vọng: > 0 (nếu có dữ liệu)

-- 7. Index alerts(created_at) tồn tại
SHOW INDEX FROM cors_admin.alerts
 WHERE Key_name = 'idx_alerts_created';

-- 8. Binlog đã tắt
SHOW VARIABLES LIKE 'log_bin';
-- Kỳ vọng: OFF
```

---

## 7. Triển khai prod (chỉ sau khi duyệt thủ công)

> **Không thực hiện bất kỳ bước nào dưới đây nếu chưa có xác nhận rõ ràng của chủ dự án.**
> Toàn bộ phải đã PASS local + có evidence.

### 7.1 Gate trước deploy

- [ ] Local tests PASS (Go, vitest, typecheck, Playwright liên quan).
- [ ] Evidence `docs/1/evidence/plan17/` đầy đủ.
- [ ] Diff đã review, không secret.
- [ ] Chủ dự án duyệt thủ công.
- [ ] Backup prod mới nhất đã kiểm tra restore thử (theo `docs/OPS.md`).

### 7.2 Thứ tự deploy

1. **Backup DB prod**:
   ```bash
   /opt/cors/backup.sh
   ```
   Ghi lại `SHOW BINARY LOGS`, `SHOW MASTER STATUS`, counts.
2. Deploy code + migration theo quy trình hiện có:
   - `docker compose build migrate server web gnss`
   - `docker compose run --rm migrate`
   - `docker compose up -d --force-recreate server web gnss`
3. Kiểm tra migration:
   ```sql
   SELECT job_key, retention_days, label FROM cors_admin.maintenance_jobs;
   SHOW INDEX FROM cors_runtime.quality_alerts;
   SHOW INDEX FROM cors_admin.alerts;
   ```
4. Chạy retention một lần (sau khi đã backup):
   - UI `Hệ thống → Tự động hóa → quality-alerts → Chạy`.
   - UI `Hệ thống → Tự động hóa → acked-alerts → Chạy`.
   - Kiểm tra `COUNT(*)` trước/sau; alert cũ >7 ngày phải về 0,
     kể cả `quality_alerts` open và `alerts` open.
5. Tắt binlog (quyết định 3B):
   - Backup DB.
   - `PURGE BINARY LOGS BEFORE NOW() - INTERVAL 1 DAY;` để giải phóng trước.
   - Thêm `--skip-log-bin` vào compose; `docker compose up -d mysql`.
   - Kiểm tra `SHOW VARIABLES LIKE 'log_bin'` = OFF.
   - Nếu cần xoá file binlog còn lại: dừng MySQL, xoá file, start lại.
     Không xoá file binlog khi MySQL đang chạy; chỉ làm sau backup.
6. Docker cleanup:
   ```bash
   docker builder prune -f
   docker image prune -f
   ```
7. RAM config:
   - Sửa compose/env, recreate `mysql`, `gnss`.
   - Kiểm tra `docker stats`, cgroup peak, swap, `/health`.
8. Verify:
   - `curl http://127.0.0.1:7080/health`
   - `curl http://127.0.0.1:4000/health` (từ trong network/container)
   - `docker compose ps`
   - Relay streaming không giảm; `quality` queue/dropped không tăng.
   - Disk/RAM đạt KPI mục 2.

### 7.3 Rollback

| Thay đổi | Rollback |
|---|---|
| Code Go/Node/Frontend | Deploy lại image/commit trước |
| Migration 042 | `UPDATE maintenance_jobs SET retention_days = <old>, label = <old>` |
| Runtime 009 index | `ALTER TABLE quality_alerts DROP INDEX idx_quality_alerts_last_seen;` |
| Admin 043 index | `ALTER TABLE alerts DROP INDEX idx_alerts_created;` |
| `quality-alerts` đã xoá | Không khôi phục được nếu không có backup → phải dump trước |
| `alerts` admin đã xoá | Không khôi phục được nếu không có backup → phải dump trước |
| Binlog đã tắt/xoá | Bỏ `--skip-log-bin`, restart; dữ liệu binlog cũ không khôi phục được |
| MySQL/Go config | Revert compose/env + recreate |
| Docker prune | Không cần rollback; chỉ mất cache build |

---

## 8. Definition of Done

- [ ] `quality-alerts` xoá **tất cả** bản ghi cũ hơn 7 ngày, kể cả `resolved_at IS NULL`.
- [ ] `alerts` admin xoá **tất cả** alert cũ hơn 7 ngày, kể cả `status = 'open'`.
- [ ] Retention 7 ngày áp dụng đúng cho 8 job ở mục 3.1.
- [ ] `relay-hourly` 90 ngày, `audit-logs` 365 ngày được giữ.
- [ ] Index `idx_quality_alerts_last_seen` và `idx_alerts_created` tồn tại.
- [ ] Binlog đã tắt (`log_bin = OFF`), không còn file binlog mới.
- [ ] Local tests PASS; có log/evidence.
- [ ] Load test mock 20 job PASS; không có backlog/drop bất thường.
- [ ] Disk local/prod đạt KPI; RAM/swap đạt KPI.
- [ ] Không đổi byte path RTCM; relay/caster hoạt động bình thường.
- [ ] Không secret trong diff; không commit `.env.local`.
- [ ] `SESSION.md` cập nhật.
- [ ] Chủ dự án duyệt thủ công trước khi deploy prod.

---

## 9. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Xoá quality alert chưa resolve làm mất dấu lỗi cũ | Trung bình | Đã chốt theo yêu cầu; dump DB trước; alert mới sẽ tái tạo nếu lỗi còn |
| Xoá admin alert open làm mất dấu lỗi cũ | Trung bình | Đã chốt theo yêu cầu; dump DB trước; alert mới tái tạo nếu lỗi còn |
| `DELETE` batch gây lock | Thấp | Batch 1000, chạy off-peak, index `(last_seen,id)` và `(created_at)` |
| Giảm buffer pool gây đọc disk nhiều | Trung bình | 512M, theo dõi `iowait`/latency; rollback 768M nếu cần |
| Go buffer nhỏ gây `downstream backlog` | Trung bình | Test mock 20/50 job; dùng 64/128 slot nếu cần |
| `GOMEMLIMIT` thấp gây GC thrash | Thấp | 450MiB; CPU còn nhiều; theo dõi latency |
| Tắt binlog mất PITR | Cao | Chỉ làm sau backup; xác nhận không cần PITR; rollback bật lại |
| Migration 042/043 áp dụng ngoài ý muốn | Thấp | Chỉ chạy sau duyệt; backup; rollback SQL rõ |

---

## 10. Quyết định đã chốt (2026-11-06)

| # | Nội dung | Chốt |
|---|---|---|
| 1 | `rtcm-message-stats` | **1A — 7 ngày** |
| 2 | `relay-hourly` | **2A — giữ 90 ngày** |
| 3 | Binlog | **3B — tắt hẳn** |
| 4 | Sampling quality | **4A — giữ 60 giây** |
| 5 | Buffer relay | **5A — làm trong plan 17, Phase L3** |
| 6 | Alert admin | **Xoá tất cả alert cũ hơn 7 ngày, không quan tâm trạng thái** |
| 7 | `performance_schema` | **7A — giữ ON** |
| 8 | Cách áp retention | **8A — migration 042** |
| 9 | Cách đổi RAM config | **9A — `SET GLOBAL` + recreate Go** |
| 10 | Export `quality_alerts` | **10C — không export, xoá sạch** |

Ghi chú:
- Quyết định 6 không dùng auto-resolve theo `streaming`; job `acked-alerts` đổi
  điều kiện sang `created_at < now - 7 days`, xoá cả `open`.
- Quyết định 3B chấp nhận mất PITR; backup định kỳ `mysqldump` là lớp bảo vệ chính.
- Quyết định 10C: không xuất CSV; vẫn backup DB theo quy trình chung trước khi
  deploy/xoá dữ liệu, nhưng không lưu riêng `quality_alerts`.

---

## 11. Task breakdown & thứ tự

| # | Task | File chính | Test | Ưu tiên |
|---|---|---|---|---|
| 1 | Migration retention 7 ngày | `db/migrations/admin/042_retention_7d.sql` | migrate local + SQL | P0 |
| 2 | `quality-alerts` xoá tất cả | `gnss/internal/maintenance/retention.go` | Go unit | P0 |
| 3 | Đồng bộ `quality/store.go` | `gnss/internal/quality/store.go` | Go unit | P0 |
| 4 | Index `last_seen` | `db/migrations/runtime/009_...sql` | `SHOW INDEX` | P0 |
| 5 | `alerts` admin xoá tất cả | `server/src/lib/maintenance.ts` | vitest | P0 |
| 6 | Index `alerts(created_at)` | `db/migrations/admin/043_...sql` | `SHOW INDEX` | P0 |
| 7 | Backlog SQL server | `server/src/lib/systemOptimize.ts` | vitest | P0 |
| 8 | Cảnh báo UI | `frontend/src/pages/system/AutomationTab.tsx` | tsc + Playwright | P1 |
| 9 | MySQL 512M / max_conn 60 | compose/env | docker stats | P1 |
| 10 | Go GOMEMLIMIT/GOGC | compose/env | load test | P1 |
| 11 | Giảm buffer relay | `gnss/internal/relay/bridge.go` | Go + mock load | P1 |
| 12 | Tắt binlog + Docker prune | compose/prod runbook | `SHOW VARIABLES`, `df` | P1 |
| 13 | Evidence + SESSION.md | `docs/1/evidence/plan17/`, `SESSION.md` | review | P0 |

---

## 12. Kết luận

- Kế hoạch này **không nâng cấp phần cứng**, chỉ giảm phát sinh và giảm high-water mark.
- Thay đổi lớn nhất về disk là **tắt binlog** và **quality_samples 35 → 7 ngày**.
- Thay đổi lớn nhất về RAM là **MySQL buffer pool 768 → 512 MB** và **giảm buffer relay Go**.
- `quality-alerts` và `alerts` admin đều **xoá tất cả bản ghi cũ hơn 7 ngày**,
  kể cả chưa resolve/open, theo yêu cầu.
- Sampling quality giữ **60 giây** (quyết định 4A); `quality_samples` 7 ngày ~1.3 GB.
- Không export CSV `quality_alerts` (quyết định 10C); chỉ backup DB theo quy trình chung.
- Toàn bộ làm local trước; **không sửa prod**; chỉ deploy sau khi chủ dự án duyệt thủ công.

---

## 13. KẾT QUẢ THỰC HIỆN

### BƯỚC 0 — Baseline & nhánh (2026-11-06)
- Trạng thái: **PASS**
- File:
  - `docs/1/evidence/plan17/baseline.txt`
  - `docs/1/17_KE_HOACH_TOI_UU_TAI_NGUYEN_7_NGAY.md`
- Test: không có.
- Bằng chứng: baseline local (Docker, RAM/disk, maintenance_jobs, counts, binlog,
  index) đã ghi.
- Commit: `docs(plan17): bước 0 - baseline và nhánh thực hiện`.
- Việc còn lại: không.

### BƯỚC 1 — Retention 7 ngày + quality-alerts/alerts admin xoá tất cả (2026-11-06)
- Trạng thái: **PASS**
- File đã sửa:
  - `db/migrations/admin/042_retention_7d.sql`
  - `db/migrations/admin/043_alerts_created_index.sql`
  - `db/migrations/runtime/009_quality_alerts_last_seen_index.sql`
  - `gnss/internal/maintenance/retention.go`
  - `gnss/internal/quality/store.go`
  - `gnss/internal/maintenance/runner_test.go`
  - `server/src/lib/maintenance.ts`
  - `server/src/lib/systemOptimize.ts`
  - `server/tests/maintenance.test.ts`
  - `server/tests/systemOptimize.test.ts`
  - `frontend/src/pages/system/AutomationTab.tsx`
  - `docs/OPS.md`
- Test đã chạy:
  - `go test ./...` → PASS toàn bộ.
  - `npx vitest run` → 204/204 PASS, 41 file.
  - `npx tsc --noEmit` → PASS.
  - Migration local: admin 042, admin 043, runtime 009 applied; schema_version = 9.
  - Fixture quality_alerts: old_open + old_resolved bị xoá; recent_open còn.
  - Fixture alerts admin: old_open + old_acked bị xoá; recent_open còn.
- Bằng chứng: `docs/1/evidence/plan17/step1.txt`.
- Commit: `feat(plan17): bước 1 - retention 7 ngày và xoá alert theo tuổi`.
- Việc còn lại: không; fixture đã dọn.

### BƯỚC 2 — RAM config local (2026-11-06)
- Trạng thái: **PASS**
- File đã sửa:
  - `docker-compose.yml`
  - `docker-compose.prod.yml`
- Cấu hình:
  - MySQL: `innodb_buffer_pool_size=512M`, `max_connections=60`.
  - Go: `GOMEMLIMIT=450MiB`, `GOGC=50`, quality queue 8 MB/1024.
  - Giữ `performance_schema=ON`.
- Test đã chạy:
  - `docker compose up -d` → mysql, server, gnss, web healthy.
  - `scripts/load-test-mock.ps1 -Jobs 20` → `streaming=20/20 PASS`.
  - Docker stats/cgroup: gnss peak 24.1 MiB, swap 0; MySQL current 478.8 MiB,
    peak 501.7 MiB, swap 0.
- Bằng chứng: `docs/1/evidence/plan17/step2.txt`.
- Commit: `feat(plan17): bước 2 - cấu hình RAM local`.
- Việc còn lại: không; đây là cấu hình local, chưa deploy.

### BƯỚC 3 — Giảm buffer relay (2026-11-06)
- Trạng thái: **PASS**
- File đã sửa:
  - `gnss/internal/relay/bridge.go`
  - `gnss/internal/relay/bridge_test.go`
- Thay đổi: `MonitorBuffer 256→32`, `DownstreamBuffer 256→64`,
  `ReadBuffer 32KB→8KB`; thêm test giới hạn buffer.
- Test đã chạy:
  - `go test ./...` → PASS toàn bộ.
  - Load test mock 20 job → `streaming=20/20`; Go peak 16.3 MiB.
  - Load test mock 50 job → `streaming=50/50`; Go peak 30.9 MiB; swap 0.
  - Không thấy backlog/quality drop/monitor error trong log.
- Bằng chứng: `docs/1/evidence/plan17/step3.txt`.
- Commit: `feat(plan17): bước 3 - giảm buffer relay`.
- Việc còn lại: không; byte RTCM không đổi, test byte-exact PASS.

### BƯỚC 4 — Tắt binlog + dọn Docker local (2026-11-06)
- Trạng thái: **PASS**
- File đã sửa:
  - `docker-compose.yml`
  - `docker-compose.prod.yml`
- Thay đổi: thêm `--skip-log-bin`; backup DB trước; purge binlog cũ;
  recreate MySQL local; `docker builder prune -f` + `docker image prune -f`.
- Test đã chạy:
  - `SHOW VARIABLES LIKE 'log_bin'` → OFF.
  - `SHOW BINARY LOGS` → lỗi 1381 (không dùng binary logging).
  - Load test mock 5 job sau khi tắt binlog → `streaming=5/5`.
  - Node/Go health OK; Go schemaVersion 9.
  - Docker build cache 25.8GB → 4.435GB; image prune 187.7MB.
- Bằng chứng: `docs/1/evidence/plan17/step4.txt`.
- Commit: `feat(plan17): bước 4 - tắt binlog và dọn Docker local`.
- Việc còn lại: không; chưa deploy prod.

### BƯỚC 5 — Tổng kiểm tra + tài liệu + kết thúc (2026-11-06)
- Trạng thái: **PASS**
- Test đã chạy:
  - `go test ./...` → PASS toàn bộ.
  - `npx vitest run` → 204/204 PASS, 41 file.
  - `npx tsc --noEmit` → PASS.
  - Playwright `system-ops` + `navigation` → 4/4 PASS.
- SQL acceptance:
  - 8 job retention = 7 ngày.
  - `quality_alerts` cũ >7 ngày = 0; `alerts` admin cũ >7 ngày = 0.
  - Index `idx_quality_alerts_last_seen` + `idx_alerts_created` tồn tại.
  - `log_bin = OFF`; buffer pool 512M; max_connections 60;
    performance_schema ON.
- Health: Node ok/schema 43, Go ok/schema 9.
- Graphify: 5089 nodes, 11349 edges, 361 communities.
- Bảo mật: diff không có secret/password/private key; không commit `.env.local`.
- Docker local sau dọn: Images 15.19GB, Build Cache 4.435GB.
- Bằng chứng: `docs/1/evidence/plan17/step5.txt`.
- Commit: `docs(plan17): bước 5 - tổng kiểm tra và kết quả`.
- Việc còn lại: chủ dự án kiểm tra thủ công; **chưa deploy VPS**.

### BƯỚC 6 — Rà soát UI 30 ngày (2026-11-06)
- Trạng thái: **PASS**
- Vấn đề: tab `Dữ liệu` và `Lịch sử` vẫn còn nút `30 ngày` dù retention 7 ngày.
- File đã sửa:
  - `frontend/src/components/EntityTimeline.tsx`
  - `frontend/src/components/EntityHistory.tsx`
  - `frontend/tests/timeline.spec.ts`
  - `scripts/load-test-mock.ps1`
- Thay đổi:
  - Bỏ range `1m`/`30 ngày` khỏi tab Dữ liệu; còn 1 giờ, 24 giờ, 7 ngày.
  - Bỏ range `30d` khỏi tab Lịch sử; còn 24 giờ, 7 ngày.
  - Test khẳng định không còn nút `30 ngày`.
  - Cleanup load test disable job + chờ Go nhả runtime state trước khi xoá.
- Test:
  - `npx tsc --noEmit` → PASS.
  - `npx playwright test tests/timeline.spec.ts` → 3/3 PASS.
  - Load test mock 2 job → `streaming=2/2`; không còn job test sống.
- Bằng chứng: `docs/1/evidence/plan17/step6.txt`.
- Ghi chú local: trong lúc dọn test đã restore DB local từ backup
  `cors-mysql-20261106-233319.sql.zip`; không ảnh hưởng prod.
- Commit: `fix(plan17): bước 6 - bỏ mốc 30 ngày khỏi tab dữ liệu`.
- Việc còn lại: chủ dự án kiểm tra lại UI local; **chưa deploy VPS**.

### BƯỚC 7 — TRIỂN KHAI PROD (2026-11-07)
- Trạng thái: **PASS**
- Commit prod: `920ad10` (merge plan 17 vào main).
- Backup:
  - `cors-prod-20261106-171649.sql.gz`
  - `cors-prod-20261106-171834.sql.gz` (update.sh tự backup)
- Migration prod:
  - admin 042_retention_7d.sql
  - admin 043_alerts_created_index.sql
  - runtime 009_quality_alerts_last_seen_index.sql
- Kết quả:
  - Node health ok/schema 43; Go health ok/schema 9; HTTPS 200.
  - 8 job retention = 7 ngày; relay-hourly 90; audit 365.
  - `quality_alerts` cũ >7 ngày = 0; `alerts` admin cũ >7 ngày = 0.
  - Index mới tồn tại.
  - `log_bin=OFF`; buffer pool 512M; max_connections 60;
    performance_schema ON.
  - Relay: 45 streaming, 11 backoff, 3 connecting, 8 disabled.
  - Disk 18G → **13G used / 28G free**.
  - RAM 2.7Gi → **1.9Gi used**; swap 824Mi → **127Mi**.
  - Docker: mysql 717MiB, gnss 75.9MiB, server 102.6MiB, caddy 49.5MiB, web 3.4MiB.
  - Build cache 3.547GB → 358MB; image prune 544MB.
- Bằng chứng: `docs/1/evidence/plan17/prod.txt`.
- Ghi chú: còn log quality score error/recovered của relay 507/509 — lỗi flapping
  có sẵn, không phải lỗi deploy.
- Rollback code: `git checkout 02527b0 && bash update.sh`.
- Việc còn lại: theo dõi relay 11 backoff/3 connecting; không còn việc deploy.
