# Kế hoạch 20 — Tối ưu hiệu năng & giảm tài nguyên tiêu tốn không cần thiết

- Ngày lập: 2026-11-10
- Trạng thái: **IN PROGRESS** — triển khai tuần tự P20-1 → P20-7, mỗi bước có test + commit riêng.
- Căn cứ: báo cáo khảo sát production `rtktk.online` ngày 2026-11-10
  (đo read-only: `performance_schema`, `EXPLAIN ANALYZE`, log request, dmesg,
  tile provider, `/internal/rtcm/health`).
- Nguyên tắc bắt buộc:
  - Mock-first; **không chạy relay.exe**, không chiếm `8081`/`2101` của relay cũ.
  - Không sửa/ghi/xoá gì trong `relayrtcm/backup`.
  - Không commit secret; không log Authorization/password/DSN.
  - Không đổi nội dung byte RTCM, không chèn Node vào đường byte.
  - Node chỉ ghi `cors_admin`; Go chỉ ghi `cors_runtime` (giữ nguyên ranh giới).
  - Local-first: test trên stack Docker local; **không deploy prod trong kế hoạch này**.
  - Không tuyên bố PASS khi chưa có bằng chứng lệnh test.

## 0. Số liệu xuất phát (baseline prod, 2026-11-10)

| Chỉ số | Giá trị đo được | Ghi chú |
|---|---|---|
| `/api/stations` | p50 74 ms, p90 **1.817 ms**, p99 **12.648 ms**, max **41.375 ms** | 520 request/39 h |
| `/api/stations/:id` | p90 2.075 ms, p99 6.099 ms, max **20.891 ms** | 132 request |
| `/api/map/overview` | p50 188 ms, p90 **12.879 ms**, max **15.670 ms** | 52 request |
| `/health` Node | p50 3 ms | Node không phải nút thắt |
| Query latest-sample 20 trạm | **36,77 s**; `EXPLAIN ANALYZE` quét 28.944 dòng | index sai thứ tự cột |
| Query latest-sample toàn bộ trạm (map) | **92,77 s** | 196.879 dòng |
| `quality_samples` | 905.642 dòng / **855 MB** (mới 5 ngày) | buffer pool 512 MB |
| `SELECT * … ORDER BY ts LIMIT 5000` (export) | **36,6 s**/lần, quét 5,18 M dòng | 9 lần |
| `relay_sessions` open-set | quét **4,15 M dòng**/173 lần, max 4,2 s | thiếu index `end_ts` |
| Go `corsd` | ~90–100 % của 1 core, bị throttle **24,5 %** period | 129 target |
| Go RSS | ~500 MB/700 MB, **OOM-kill 2 lần** (03:40 và 03:47) | `anon-rss` 711 MB |
| Mẫu bị mất | **4 phút/6 h** (`storeFailures=4`) | mất cả batch 87 target |
| `quality_alerts` | 52.235 dòng, 63 alert mở vĩnh viễn | score_zero 27.269 |
| `caster_connections` mở | 58 dòng / 26 mountpoint (có mountpoint 3 dòng) | không dọn khi restart |
| Tile `osm-de` | `ETIMEDOUT` từ container (VPS không có IPv6) | mỗi tile +0,6 s rồi fallback 0,7 s |

## 1. Mục tiêu

1. **M20-1** — Đưa `GET /api/stations`, `/api/stations/:id`, `/api/map/overview`
   về **p90 < 400 ms** ở local với fixture 37 trạm/900 k mẫu; không còn query
   > 1 s trên đường đọc thường dùng.
2. **M20-2** — Không còn mất batch mẫu 60 s do timeout ghi DB; timeline không
   hiện "không có dữ liệu" giả khi chỉ thiếu 1 tick.
3. **M20-3** — Không còn cảnh báo `score_zero` giả khi trạm vừa có dữ liệu lại.
4. **M20-4** — Giảm tải phân tích RTCM không cần thiết: bỏ tính sky plot khỏi
   hot path, giới hạn tần suất giải mã chi tiết MSM, giảm cấp phát bộ nhớ mỗi
   tick; CPU Go giảm ≥ 30 % so với baseline cùng tải mock.
5. **M20-5** — Không còn phiên `caster_connections`/`station_source_sessions`
   mồ côi sau restart; không còn alert mở "ma" sau restart.
6. **M20-6** — Bản đồ: nền tile tải được từ mọi mode, không phụ thuộc provider
   chết; cache tile lớn hơn; asset tĩnh có `Cache-Control immutable`.
7. **M20-7** — Frontend chỉ poll khi cần, interval hợp lý; không refetch chồng
   lên request đang chạy.
8. **M20-8** — Có script PowerShell tiếng Việt kiểm tra hiệu năng + tài liệu
   vận hành cập nhật; toàn bộ test Go/Node/Playwright PASS.

## 2. Quyết định đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| D20-1 | Query "mẫu mới nhất" chỉ đọc **cửa sổ 15 phút** + fallback `ORDER BY ts DESC LIMIT 1` theo target | index mới phục vụ cả hai |
| D20-2 | Thêm index runtime: `(target_type, target_id, direction, ts)`, `relay_sessions(relay_job_id, end_ts)`, `quality_alerts(resolved_at, last_seen)` | migration runtime 011 |
| D20-3 | Không `SELECT qs.*`; chỉ select cột cần dùng, bỏ cột `details` khỏi mọi đường đọc danh sách | giảm I/O |
| D20-4 | Export chất lượng giới hạn **1 ngày/lần xuất**, dùng index `ts` + `LIMIT 5000` | tránh sort 5 M dòng |
| D20-5 | `AsyncStore` timeout theo loại op: mẫu **15 s**, stats 10 s, alert 5 s; retry 1 lần; log mỗi lỗi | mất batch là lỗi phải thấy |
| D20-6 | Cache điểm chỉ bị vô hiệu khi state đổi `stale → streaming` (và khi reset session) | hết `score_zero` giả |
| D20-7 | Timeline chấp nhận sample cũ tối đa **2× window** (120 s) thay vì đúng 60 s | 1 tick trễ không thành "no data" |
| D20-8 | Khi khởi động: đóng `caster_connections` mở bằng lý do `service_restart`; resolve toàn bộ `quality_alerts` đang mở | Go mất state sau restart |
| D20-9 | Snapshot chi tiết (sky plot, danh sách signal) **chỉ** tính khi API yêu cầu; hot path chỉ tính số liệu tổng hợp | giảm CPU/alloc |
| D20-10 | Giải mã chi tiết MSM tối đa **1 lần/2 s/target** (`QUALITY_DETAIL_INTERVAL_MS`, mặc định 2000) | vẫn đếm frame/CRC đầy đủ |
| D20-11 | Bật pprof loopback khi đặt `PPROF_ADDR` (mặc định tắt) | đo CPU/heap trên staging |
| D20-12 | Provider tile mặc định chuyển sang `osm-fr` (truy cập được), `osm-de` thành fallback; thêm **negative cache** 10 phút sau 3 lần lỗi liên tiếp | VPS không có IPv6 |
| D20-13 | Cache tile RAM 256 → **2048** tile, TTL 6 h; giữ tile proxy (không lộ IP client) | cấu hình, không đổi kiến trúc |
| D20-14 | Asset `/assets/*` có `Cache-Control: public, max-age=31536000, immutable` | hash trong tên file |
| D20-15 | Frontend: stations 20 s, map 30 s, chi tiết trạm 30 s; `staleTime` = ½ interval; không poll khi tab ẩn | giảm request |
| D20-16 | Node: cache `latest sample` 2 s, `map overview` 2 s, `open alerts` 3 s, dedupe alert in-memory | giảm query lặp |
| D20-17 | Không đổi API shape/response field, không đổi quyền, không đổi schema cột | tránh hồi quy UI/RBAC |

## 3. Phạm vi file

- `db/migrations/runtime/011_perf_indexes.sql` (mới)
- `server/src/lib/latestSample.ts` (mới), `server/src/lib/ttlLruCache.ts` (dùng lại)
- `server/src/routes/stations.ts`, `map.ts`, `quality.ts`, `mountpoints.ts`,
  `relayJobs.ts`, `server/src/lib/alerts.ts`, `server/src/realtime/data.ts`,
  `server/src/realtime/socket.ts`
- `server/src/lib/statusTimeline.ts`
- `gnss/internal/quality/analyzer.go`, `store.go`, `score.go` (nếu cần),
  `gnss/internal/caster/store.go` + `manager.go` (startup cleanup),
  `gnss/internal/config/config.go`, `gnss/cmd/corsd/main.go`
- `server/src/lib/mapConfig.ts`, `server/src/lib/tileProxy.ts`, `Caddyfile`,
  `frontend/nginx.conf` (nếu có)
- `frontend/src/pages/Stations.tsx`, `UnifiedMap.tsx`,
  `components/StationDetailDrawer.tsx`, `components/QualityPanel.tsx` (nếu cần)
- `scripts/kiem-tra-hieu-nang.ps1` (mới)
- `docs/OPS.md`, `docs/1/20_KE_HOACH_TOI_UU_HIEU_NANG.md`, `SESSION.md`, `TASKS.md`

## 4. Các bước thực hiện

### P20-1 — DB index + query mẫu mới nhất (BE)

Phạm vi: migration runtime 011, helper `latestSample.ts`, 5 route đọc.

Việc làm:
1. Migration `011_perf_indexes.sql`:
   - `idx_quality_samples_latest (target_type, target_id, direction, ts)`
   - `idx_relay_sessions_open (relay_job_id, end_ts)`
   - `idx_quality_alerts_open (resolved_at, last_seen)`
   - Idempotent: kiểm tra `information_schema.statistics` trước khi tạo.
2. Helper `loadLatestSamples({targetType, ids, direction?})`:
   - Query 1: cửa sổ `ts >= UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE`,
     `ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY ts DESC)` **chỉ select
     cột cần** (không `qs.*`).
   - Query 2 (fallback) cho target không có mẫu trong cửa sổ:
     `UNION ALL` các `SELECT … WHERE target_type=? AND target_id=? [AND direction=?]
     ORDER BY ts DESC LIMIT 1` (dùng index mới, 1 seek/target).
3. Thay 5 chỗ dùng window function + `qs.*`:
   - `stations.ts` `qualityMap`
   - `map.ts` latest station sample
   - `quality.ts` `/quality/overview`
   - `mountpoints.ts` latest sample
   - `relayJobs.ts` (4 chỗ)
4. `quality.ts` export: bắt buộc `from/to ≤ 24 h`, `FORCE INDEX (idx_quality_samples_ts)`,
   `ORDER BY ts LIMIT 5000`; trả `EXPORT_RANGE_TOO_LARGE` nếu vượt.
5. `stations.ts` bỏ 12 subquery tương quan: join `station_sources` 1 lần + join
   `caster_listeners` 1 lần, gộp `mountpoint_count/name` bằng 1 query phụ.

Nghiệm thu:
- `EXPLAIN` cho cả 3 query chính dùng index mới, không `Using filesort` trên
  toàn bảng; `EXPLAIN ANALYZE` đọc < 1.000 dòng.
- Test Node mới: `server/tests/latestSample.test.ts`, `server/tests/perfIndexes.test.ts`
  (đọc file migration, kiểm tra tên index + idempotent).
- `/api/stations` p90 < 400 ms với fixture local 900 k mẫu (đo bằng script P20-7).

### P20-2 — Go: mất batch mẫu, cache score, dọn dữ liệu mồ côi

Việc làm:
1. `AsyncStore`: timeout theo `storeOpKind` (mẫu 15 s, stats 10 s, alert 5 s),
   retry 1 lần khi lỗi, log `[quality] store <kind> failed: …` kèm số dòng;
   `Failures()` vẫn đếm 1 lần/op.
2. `targetState.snapshot`: nếu `state == streaming` mà cache `score` được tính
   khi state chưa streaming → tính lại ngay (vô hiệu cache khi chuyển trạng thái).
   Thêm test hồi quy: stale (score 0) → streaming phải trả score > 0 ngay tick đầu.
3. Startup Go:
   - `quality.MySQLStore.ResolveAllOpen(ctx)` — resolve toàn bộ alert mở, log số dòng.
   - `caster.MySQLStore.CloseOpenConnections(ctx, "service_restart")` — đóng
     `caster_connections.end_ts IS NULL`; gọi trong `main.go` trước khi start manager.
   - Giữ nguyên `relay.CloseStaleSessions` và station-source `CloseOpen`.
4. `statusTimeline.ts`: `framesAt` chấp nhận sample cũ ≤ `2 × window` (tối thiểu
   60 s, tối đa 180 s); thêm test "thiếu 1 tick không thành no_data".

Nghiệm thu:
- `go test ./...` PASS; test mới cho AsyncStore timeout/retry, score transition,
  cleanup SQL.
- `server npm test` PASS, test mới cho timeline tolerance + resolve-all.

### P20-3 — Giảm tải phân tích RTCM

Việc làm:
1. `Snapshot` tách 2 mức: `snapshot(now, opts)` (tổng hợp, dùng cho eval/sample)
   và `snapshotDetail(now, opts)` (có sky plot + danh sách signal). `evaluate` và
   `emitSamples` dùng bản tổng hợp.
2. Bỏ `skyPlotFor` khỏi mọi tick; chỉ tính trong `snapshotDetail` khi
   `/internal/rtcm/snapshot` yêu cầu (API detail).
3. Throttle giải mã chi tiết MSM theo `DetailInterval` (mặc định 2 s):
   - `state.lastDetailAt`; nếu chưa đủ 2 s thì chỉ đếm frame/CRC/parse + cập nhật
     `lastDataAt`, bỏ qua decode observation.
   - Có env `QUALITY_DETAIL_INTERVAL_MS` (0 = tắt throttle, giữ hành vi cũ).
4. Giảm cấp phát: bỏ map `identities` không dùng; tái sử dụng slice trong
   `evaluate`; `snapshot` không copy `satSignals` khi không cần detail.
5. Thêm pprof loopback khi `PPROF_ADDR` khác rỗng (`net/http/pprof`, `127.0.0.1`).
6. Benchmark Go: `BenchmarkEvaluate` + `BenchmarkSnapshot` trước/sau; ghi số
   alloc/op và ns/op vào tài liệu.

Nghiệm thu:
- `go test ./...` PASS, benchmark giảm ≥ 30 % `ns/op` và ≥ 40 % `allocs/op`
  ở `BenchmarkEvaluate` (129 target, toàn bộ streaming).
- Không đổi semantics: điểm/alert giống nhau với `QUALITY_DETAIL_INTERVAL_MS=0`.

### P20-4 — Node: giảm query lặp

Việc làm:
1. Cache `loadLatestSamples` 2 s (theo key targetType+ids+direction) bằng
   `TtlLruCache`.
2. Cache `/api/map/overview` 2 s theo khoá `user|scope|query` (không cache lỗi).
3. `realtime/data.ts`: cache `loadOpenAlerts` 3 s và `MAX(id) relay_sessions` 3 s.
4. `alerts.ts`: dedupe in-memory `Map<dedupeKey, expiresAt>` (cooldown) trước khi
   query DB; gộp các `createAlertOnce` chạy song song thành tuần tự có giới hạn.
5. `stationConnectionSet`: dùng index mới, bỏ query `relay_sessions` khi station
   không có relay job.

Nghiệm thu:
- `server npm test` PASS; test mới cho cache (hit/miss/expiry) và dedupe.
- Đo local: 10 lần gọi `/api/stations` liên tiếp → số query `quality_samples`
  ≤ 2 (cache) và p90 < 400 ms.

### P20-5 — Bản đồ & asset tĩnh

Việc làm:
1. `mapConfig.ts`: `streets` primary → `https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png`,
   fallback `tile.openstreetmap.de`; giữ nguyên tên mode/attribution.
2. `tileProxy.ts`: cache 2048; negative cache theo provider (3 lỗi liên tiếp →
   bỏ qua 10 phút, tự phục hồi); timeout 8 s giữ nguyên.
3. `frontend/nginx.conf` (hoặc `Dockerfile` web) + `Caddyfile`: thêm
   `Cache-Control: public, max-age=31536000, immutable` cho `/assets/`.
4. `map.config` trong DB không đổi (provider chỉ là metadata) — ghi rõ trong docs.

Nghiệm thu:
- Test Node mới: chọn provider, negative cache, cache size.
- `map-maplibre.spec.ts`, `unified-map.spec.ts`, `map.spec.ts` PASS.
- Kiểm tra header asset bằng `curl -I` trên stack local.

### P20-6 — Frontend polling

Việc làm:
1. `Stations.tsx`: `refetchInterval: 20000`, `staleTime: 10000`,
   `refetchIntervalInBackground: false`.
2. `UnifiedMap.tsx`: `refetchInterval: 30000`, `staleTime: 15000`,
   `refetchIntervalInBackground: false`; giữ marker cũ khi refetch (`placeholderData`).
3. `StationDetailDrawer.tsx`: `refetchInterval: 30000`, `staleTime: 15000`.
4. Không đổi UI/UX, không đổi nhãn trạng thái.

Nghiệm thu:
- `tsc --noEmit` + `vite build` PASS.
- Playwright: `station-detail`, `timeline`, `quality`, `unified-map`,
  `ui` PASS; `inspect.mjs` 1440/768/390 = 0 FAIL.

### P20-7 — Vận hành, script, tài liệu

Việc làm:
1. `scripts/kiem-tra-hieu-nang.ps1` (UTF-8 BOM, tiếng Việt chuẩn):
   - Tham số: `-BaseUrl`, `-AdminUser`, `-AdminPassword` (không log mật khẩu),
     `-SoLan` (mặc định 10), `-BangChung` (đường dẫn file kết quả).
   - Đo p50/p90/max cho `/api/stations`, `/api/map/overview`, `/api/connections`,
     `/health`; in bảng ASCII, thoát mã 1 nếu p90 vượt ngưỡng.
   - Kiểm tra index tồn tại qua MySQL trong container `cors-mvp-mysql-1`.
2. `docs/OPS.md`: mục "Hiệu năng" (ngưỡng, cách đo, index, tile provider).
3. `SESSION.md`, `TASKS.md`: ghi kết quả từng bước + bằng chứng.
4. `graphify update .` sau khi xong (không trỏ vào backup).

Nghiệm thu: script chạy dry-run trên local PASS; tài liệu khớp số liệu thực tế.

## 5. Checklist test chung (mỗi bước)

| Hạng mục | Lệnh | Kỳ vọng |
|---|---|---|
| Go vet + test | `cd gnss; go vet ./...; go test ./...` | PASS |
| Go race (nếu đổi analyzer) | `docker run --rm -v "${PWD}:/src" -w /src golang:1.24 sh -c "go test -race ./internal/quality"` | PASS |
| Node build/test | `cd server; npm run build; npm test` | PASS |
| Frontend build | `cd frontend; npx tsc --noEmit; npm run build` | PASS |
| Playwright | `cd frontend; npx playwright test tests/<spec>` | PASS |
| UI inspect | `node ~/.config/opencode/skills/design-taste-frontend/scripts/inspect.mjs <url> --app` | 0 FAIL |
| Diff | `git diff --stat` | không secret, đúng phạm vi |

## 6. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Index mới làm chậm ghi `quality_samples` | Chấp nhận: ghi 87 dòng/phút; đo `INSERT` < 50 ms; index chỉ 3 cột |
| Bỏ sky plot khỏi hot path làm thiếu dữ liệu UI | API detail vẫn tính; có test so sánh field |
| Throttle decode MSM làm score nhảy | `DetailInterval=0` khôi phục hành vi cũ; test so sánh |
| Cache 2 s làm trạng thái trễ 2 s | Nhỏ hơn interval poll (20–30 s); có `no-store` cho lỗi |
| Đổi provider tile vi phạm attribution | Giữ `© OpenStreetMap contributors` |

## 7. Kết quả thực hiện

> Mục này được cập nhật sau từng bước (P20-1 … P20-7) kèm bằng chứng test.

### P20-1 — DB index + query mẫu mới nhất — DONE (2026-11-10)

Đã làm:
- `db/migrations/runtime/011_perf_indexes.sql` (idempotent bằng prepared
  statement, chạy được cả khi index đã tồn tại): thêm
  `idx_quality_samples_latest (target_type, target_id, ts)`,
  `idx_quality_samples_target_dir_ts (target_type, target_id, direction, ts)`,
  `idx_relay_sessions_open (relay_job_id, end_ts)`,
  `idx_quality_alerts_open (resolved_at, last_seen)`; schema runtime 11.
- `server/src/lib/latestSample.ts`: query có cửa sổ 15 phút, chỉ select cột cần
  dùng (bỏ `details`), fallback `ORDER BY ts DESC LIMIT 1` cho target không có
  mẫu trong cửa sổ (1 seek index/target).
- Áp dụng cho `routes/stations.ts` (qualityMap), `routes/map.ts` (marker),
  `routes/mountpoints.ts` (danh sách mountpoint); `routes/quality.ts`
  (overview) bỏ `qs.*`, export giới hạn 24 giờ + `FORCE INDEX (idx_quality_samples_ts)`.
- **Không đổi** 12 subquery tương quan trong `stationColumns`: đo thực tế chỉ
  0,30 s cho 20 dòng, không phải nút thắt; giữ nguyên để tránh hồi quy field.

Bằng chứng (local, 411.840 dòng `quality_samples`, 143 target):
| Query | Cũ | Mới |
|---|---|---|
| latest 20 trạm | 0,602 s | **0,034 s** (17,8×) |
| latest 31 trạm (map) | 0,881 s | **0,053 s** (16,6×) |
| fallback 1 trạm | — | 0,0014 s |

HTTP local (10 lần, đăng nhập superadmin):
`/api/stations?pageSize=50` p50 79 ms / p90 **94 ms**; `/api/stations/709`
p90 24 ms; `/api/map/overview` p90 **39 ms**; `/api/connections` p90 16 ms.

Test: `server npm run build` PASS; `server npm test` 48 file/244 test PASS;
Playwright `station-detail.spec.ts` + `unified-map.spec.ts` 3/3 PASS;
migration chạy lại lần 2 không lỗi (idempotent).

### P20-2 — Go: mất batch mẫu, cache score, dọn dữ liệu mồ côi — DONE (2026-11-10)

Đã làm:
- `AsyncStore` (`gnss/internal/quality/store.go`): timeout theo loại ghi —
  mẫu **15 s**, stats 10 s, alert 5 s (fallback `storeTimeout`); **retry 1 lần**
  trước khi bỏ; log `[quality] store samples failed: …` khi thất bại; mỗi op
  chỉ tăng `failures` 1 lần.
- Cache score: thêm `scoreState`; nếu trạng thái đổi (stale → streaming) thì
  bỏ cache và tính lại ngay ⇒ hết `score_zero` giả 5 s (D20-6).
- Khởi động Go: `qualityStore.ResolveAllOpen` đóng toàn bộ alert chất lượng
  đang mở; `casterStore.CloseOpenConnections("service_restart")` đóng
  `caster_connections` mồ côi (D20-8).
- `server/src/lib/statusTimeline.ts`: dung sai sample = 2× cửa sổ (tối đa
  120 s). Thiếu đúng 1 tick 60 s không còn tạo bucket "no_data" (D20-7).

Bằng chứng test:
- `go vet ./...` PASS; `go test ./...` PASS (quality 0,86 s; caster 6,17 s).
- Test mới: `TestScoreCacheInvalidatedWhenStateChanges`,
  `TestAsyncStoreUsesLongerTimeoutForSamples`,
  `TestResolveAllOpenClosesEveryOpenAlert`,
  `TestCloseOpenConnectionsSetsEndAndReason`.
- `server npm test` **48 file / 245 test PASS** (thêm test "thiếu đúng một
  tick 60 giây không biến phút đó thành no_data").
- Playwright `timeline.spec.ts` (3) + `quality.spec.ts` (1) = **4/4 PASS**.

### P20-3 — Giảm tải phân tích RTCM — DONE (2026-11-10)

Đã làm:
- Tách `snapshotMode(now, opts, detail)`:
  - `summarySnapshot` (không sky plot, không constellations, không danh sách
    signal) dùng cho tick đánh giá 5 s — `evaluate` đã chuyển sang bản này.
  - `snapshot` (chi tiết) chỉ dùng cho `/internal/rtcm/snapshot` (API live) và
    lần ghi mẫu 60 s, có **cache 2 s** (`DetailInterval`).
- Throttle ghi observation chi tiết MSM (`satSignals`, `cellHistory`,
  `rmsWindow`) tối đa 1 lần/`QUALITY_DETAIL_INTERVAL_MS` (mặc định 2000 ms);
  frame/CRC/satellite/cell/CNR vẫn cập nhật mọi epoch.
- `applyAlert` nhận `func() map[string]any` (lazy): chỉ cấp phát map khi alert
  thực sự mở/emit, không cấp phát 7 map × 129 target × mỗi 5 s như trước.
- Bỏ map `identities` dư trong `evaluate`; bỏ closure `Constellations` khỏi
  summary path.
- pprof loopback khi đặt `PPROF_ADDR` (mặc định tắt); thêm 2 biến vào
  `.env.example`.

Benchmark (129 target streaming, `go test -bench -benchmem`):
| Benchmark | Trước (đường cũ) | Sau | Giảm |
|---|---|---|---|
| `evaluate` ns/op | ~338.000–457.000 | **164.000–203.000** | **~50 %** |
| `evaluate` B/op | 436.860 | **132.422** | **~70 %** |
| `evaluate` allocs/op | 3.102 | **1.166** | **~62 %** |
| `summarySnapshot` | — | 352–400 ns/op, 226 B, 4 allocs | — |

Test: `go vet ./...` PASS; `go test ./...` PASS; `go test -count=3
./internal/relay` PASS (1 lần flaky do chạy song song với benchmark, không tái
diễn); Playwright `quality.spec.ts` + `station-detail.spec.ts` 2/2 PASS.
E2E local: restart gnss đóng 1 `caster_connections` mồ côi với
`service_restart`; log `resolved 18 stale alerts`.

