# 11 — BÁO CÁO RÀ SOÁT TỐI ƯU TÀI NGUYÊN (CPU / RAM / ĐỌC-GHI / RÒ RỈ)

> Ngày lập: 2026-11-02
> Trạng thái: **BÁO CÁO KHẢO SÁT — read-only, không sửa mã nguồn**
> Phạm vi: `gnss/` (Go: caster, relay, probe, quality, maintenance),
> `server/` (Node/Express/Socket.IO), `frontend/` (React), `db/migrations/`,
> `docker-compose.yml`.
> Nguyên tắc: chỉ báo cáo bằng chứng và đề xuất; không thay đổi mã, không thêm
> thư viện, không đổi stack.
> Tham chiếu: `AGENTS.md` §4/§6/§9/§13/§14, `docs/0/RTCM_QUALITY_PLAN.md`,
> `docs/0/UI_UX_PLAN.md`, `docs/1/07_KE_HOACH_HE_THONG_TOI_UU.md`.

## 1. Phương pháp và giới hạn

- Truy vấn knowledge graph: `graphify query` trên `graphify-out/graph.json`
  (3.846 node / 8.755 edge) để lấy bản đồ các điểm nóng (goroutine, channel,
  buffer, pool, timer), sau đó đọc trực tiếp mã nguồn để xác minh từng phát hiện.
- Đọc thêm: migration/index MySQL, `docker-compose.yml`, cấu hình mặc định của
  Go (`gnss/internal/config/config.go`) và Node (`server/src/config.ts`).
- **Giới hạn:** graph được build từ commit `713a10f`, HEAD hiện tại là `b1cd0b2`
  → graph có thể lệch; kết quả `query` bị cắt ở 500 node/2000 token. Mọi kết
  luận dưới đây đã được đối chiếu lại với mã nguồn tại thời điểm lập báo cáo.
- Không chạy tải thật, không gọi dịch vụ NTRIP công cộng, không chạy `relay.exe`,
  không chiếm cổng 8081/2101.

## 2. Kết luận tổng quan

Hệ thống **đã có ý thức tối ưu tài nguyên** ở tầng byte RTCM và tầng ghi DB:
queue có giới hạn kèm bộ đếm drop, passthrough nguyên byte, index DB đầy đủ cho
truy vấn nóng, có retention/maintenance và màn "Tối ưu".

Các điểm **chưa tối ưu** tập trung ở:

1. **Realtime amplification (Node):** tick 1 giây quét bảng toàn cục, 1 truy vấn
   auth cho *mỗi socket mỗi giây*, và phát `snapshot` cho mọi socket mỗi tick dù
   dữ liệu không đổi.
2. **Giữ lock khi gọi DB (Go caster):** `register()` giữ `manager.mu` trong lúc
   gọi `runtime.Start` (timeout 3 giây).
3. **Thiếu idle timeout (Go relay/probe/caster rover):** upstream im lặng làm
   goroutine + socket treo vô hạn, không retry.
4. **Đọc DB lặp lại (Node):** `getMapConfig` truy vấn `settings` cho từng tile;
   dashboard ops full-scan `stations`/`ntrip_accounts` mỗi 10 giây.
5. **Rò rỉ tăng dần:** `quality.Analyzer.targets` không bao giờ xoá; cache
   reverse-geocode không giới hạn; state realtime ở frontend (`qualityAlerts`,
   `snapshot.alerts`) chỉ tăng.

**Không phát hiện rò rỉ nghiêm trọng** kiểu: goroutine không đóng sau session,
interval/listener không clear, connection không release, hay secret bị ghi log.
Các mẫu tương ứng đều đã được xử lý đúng (xem §8).

## 3. Tầng Go — hot path RTCM

### 3.1. Điểm đã tối ưu tốt

| Vị trí | Bằng chứng |
|---|---|
| `gnss/internal/caster/connection.go:89-96` | `enqueue` non-blocking; queue đầy thì báo để đóng `slow_client`, không chặn luồng đọc nguồn |
| `gnss/internal/caster/hub.go:98-126` | Copy **một lần** cho mỗi khung rồi chia sẻ cho mọi rover (không copy N lần) |
| `gnss/internal/relay/bridge.go:220-238` | `writeCh`/`monitorCh` đều có nhánh `default:` → downstream backlog thì đóng phiên, không block |
| `gnss/internal/relay/writer.go:151-217` | Queue 10.000 op, batch 100, flush lỗi thì cắt về kích thước queue ⇒ RAM có trần |
| `gnss/internal/relay/station_source.go:282` | Có idle read deadline cho phiên nguồn trạm |
| `gnss/internal/lifecycle/service_runs.go:14-25` | Heartbeat 15 giây, lỗi DB chỉ log |

### 3.2. Phát hiện cần xử lý

| Mức | Vị trí | Vấn đề | Tác động |
|---|---|---|---|
| **Cao** | `gnss/internal/caster/manager.go:334-379` | `register()` giữ `m.mu` **trong khi gọi `runtime.Start` (DB, timeout 3s)** | Mọi kết nối rover/source serialize theo latency DB; burst 200 rover reconnect = 200 lần tuần tự; đồng thời chặn `Connections()`, `Reconcile`, `Disconnect` |
| **Cao** | `gnss/internal/relay/bridge.go:214` | `upstream.Body.Read` **không có read deadline/idle timeout** (`ntrip.go:307` xoá deadline sau handshake) | Upstream im lặng → goroutine + socket treo mãi, state kẹt `connecting`, không retry |
| **Cao** | `gnss/internal/probe/manager.go:261-279` | Vòng đọc probe **không có read deadline** | Probe treo vô hạn, giữ goroutine + connection, không log lỗi |
| **Cao (an toàn)** | `gnss/internal/caster/listener.go:42-144`, `manager.go:503` | Chỉ giới hạn theo `account.MaxConnections`; **không có trần tổng connection/IP, không `SetKeepAlive`, rover không idle timeout** | Rover chết nửa mở vẫn giữ goroutine + `sendCh` 64×chunk; nguy cơ cạn FD/goroutine khi bị flood cổng caster |
| **Trung bình** | `gnss/internal/quality/analyzer.go:245-256` | Copy chunk **trước** khi kiểm tra queue đầy | Lãng phí alloc khi overload; queue `2048 × chunk ≤32KB` ⇒ trần lý thuyết ~64 MB |
| **Trung bình** | `gnss/internal/quality/analyzer.go:316-331` | Parse RTCM (`crc24q` bitwise + `decodeMessage`) dưới **một mutex toàn cục**; `Snapshot()` (API) và `evaluate()` phải chờ | CPU/độ trễ API tăng theo tải; CRC bị tính **2 lần** (`rtcm.Monitor` + analyzer) |
| **Trung bình** | `gnss/internal/quality/analyzer.go:224` | `a.targets` **không bao giờ bị xoá**; target ngừng feed giữ buffer 128KB + map | Tăng dần khi tạo/xoá job/trạm; rò rỉ chậm |
| **Trung bình** | `gnss/internal/quality/store.go:310-321` | `AsyncStore.apply` dùng `context.Background()` **không timeout** | MySQL treo → giữ connection vô hạn, cạn pool runtime (5) |
| **Thấp** | `gnss/internal/relay/writer.go:151-167` | Queue đầy thì drop **op cũ nhất** | Có thể mất `State` mới trong khi giữ `State` cũ |
| **Thấp** | `gnss/internal/caster/hub.go:99` | `publish` luôn copy kể cả khi 0 rover/không có quality | 1 alloc/chunk dư |
| **Thấp** | `gnss/internal/db/db.go` | `MaxIdleConns(1)` với runtime 5 / admin 2 | Churn mở-đóng connection dưới tải đồng thời |

## 4. Tầng dữ liệu — đọc/ghi MySQL

### 4.1. Điểm đã tối ưu tốt

- Index đúng cho truy vấn nóng:
  `quality_alerts(resolved_at, last_seen)` (`db/migrations/runtime/004_rtcm_quality.sql:69`),
  `alerts(dedupe_key, created_at)` (`db/migrations/admin/005_alerts_settings.sql:19`),
  `quality_samples(target_type,target_id,mountpoint_id,direction,ts)`.
- Ghi quality theo cửa sổ: sample 60 giây, stats 10 giây
  (`gnss/internal/config/config.go`), qua `AsyncStore` có drop counter.
- Ghi runtime relay qua `BufferedWriter` (batch + ticker) — không ghi từng byte.
- Retention maintenance có batch và chạy có kiểm soát
  (`server/src/lib/maintenance.ts`, `server/src/lib/systemOptimize.ts`).
- `withTransaction` luôn rollback + release (`server/src/db/pool.ts:26-41`).
- Không lưu raw RTCM/payload — đúng thiết kế `AGENTS.md` §9.

### 4.2. Phát hiện cần xử lý

| Mức | Vị trí | Vấn đề |
|---|---|---|
| **Cao** | `server/src/realtime/socket.ts:359-509` | Mỗi `REALTIME_POLL_MS` (mặc định **1000ms**, `server/src/config.ts`): `loadBaseData()` = 4 query admin + 2 gọi Go; `loadOpenAlerts`; `SELECT * quality_alerts … LIMIT 500`; `SELECT MAX(id)`; và **mỗi socket 1 query auth** (`stateForSocket` → `refreshAuth`, dòng 396). 50 user online ⇒ ~50 query/giây chỉ để auth |
| **Cao** | `server/src/realtime/data.ts:40,52,62` | `loadBaseData()` full-scan `relay_jobs`, `stations`, `mountpoints`, không cache; được gọi bởi tick realtime, `/api/ops/dashboard` và mỗi `snapshot:request` |
| **Cao** | `server/src/routes/map.ts:73` → `server/src/lib/mapConfig.ts:250` | `getMapConfig()` truy vấn `settings` **cho từng tile**, không cache; endpoint tile không auth ⇒ một khung bản đồ = 20–40 query admin |
| **Trung bình** | `server/src/routes/stations.ts:848`, `server/src/routes/webUsers.ts:264` | Export đọc toàn bảng và dựng cả workbook trong RAM, không giới hạn rows |
| **Trung bình** | `server/src/routes/quality.ts:443,514`, `:88` | `SELECT *` theo khoảng thời gian người dùng nhập, không LIMIT; overview dùng window function trên `quality_samples` (cửa sổ tới 1440 phút) |
| **Trung bình** | `server/src/routes/ops.ts:79-201` | Dashboard ops `SELECT … FROM stations` và `SELECT … FROM ntrip_accounts` toàn bảng rồi lọc trong JS; frontend poll 10 giây |
| **Trung bình** | `server/src/lib/systemOptimize.ts:403-418` | `Promise.all` ~12 `COUNT(*)` full scan chạy đồng thời trên pool 10/5, cache 20 giây |
| **Trung bình** | `server/src/rbac/scope.ts:6,56` | `assertRecordScope` gọi recursive CTE mỗi row; bulk/import gọi tuần tự (`routes/caster.ts:316`, `ntripAccounts.ts:321,566`, `webUsers.ts:615`, `relayJobs.ts:1475`) |
| **Trung bình** | `server/src/lib/systemHealth.ts:18-32`, `server/src/lib/maintenance.ts:58` | `withTimeout` reject promise nhưng **không huỷ query** → connection vẫn bị giữ tới khi MySQL trả |
| **Thấp** | `server/src/routes/geo.ts:47` | Cache reverse-geocode `Map` **không có giới hạn** (search cache có 100) |
| **Thấp** | `server/src/db/pool.ts`, `server/src/db/runtimePool.ts` | Không đặt `connectTimeout`/`queueLimit`/`maxIdle` |

## 5. Tầng Node server (ngoài realtime)

- `server/src/db/pool.ts:11` = 10 connection; `runtimePool.ts:11` = 5 → phù hợp MVP
  với MySQL mặc định 151 connection.
- `server/src/lib/systemHealth.ts:16` cache 12 giây + in-flight dedupe → tốt.
- `server/src/lib/tileProxy.ts:14-46` cache 256 entry, TTL 6 giờ, LRU → tốt.
- `server/src/lib/maintenance.ts:408` scheduler 60 giây, `unref()` → tốt (nhưng
  không có hàm stop, timer sống tới hết process).
- Socket cleanup đúng: `clearInterval` + `qualityBus.off` + `io.close`
  (`server/src/realtime/socket.ts:514-525`).
- Vấn đề chính nằm ở tick 1 giây (§4.2) và phát `snapshot` cho **mỗi socket mỗi
  tick** dù dữ liệu không đổi (`server/src/realtime/socket.ts:409`) kèm
  `JSON.stringify` 3 lần/socket/tick (dòng 411, 417, 452).

## 6. Tầng frontend

### 6.1. Điểm đã tối ưu tốt

- Một socket duy nhất (`frontend/src/realtime/RealtimeProvider.tsx:70-77`);
  cleanup gọi `disconnect()` (`:194-197`); listener không cộng dồn khi reconnect.
- React Query mặc định `refetchOnWindowFocus: false`, polling dừng khi tab ẩn
  (không đặt `refetchIntervalInBackground`) — `frontend/src/main.tsx:18-25`.
- Phần lớn bảng dùng phân trang server-side, pageSize ≤ 50.

### 6.2. Phát hiện cần xử lý

| Mức | Vị trí | Vấn đề |
|---|---|---|
| **Cao** | `frontend/src/realtime/RealtimeProvider.tsx:92,169,211` | `setSnapshot` mỗi giây + `quality.snapshot` mỗi giây ⇒ context value đổi liên tục ⇒ **toàn bộ consumer re-render 1 giây/lần**; payload gồm relays + connections + alerts |
| **Cao** | `RealtimeProvider.tsx:175` | `qualityAlerts` prepend **không giới hạn**, và không component nào dùng tới (chỉ xoá khi logout) |
| **Cao** | `RealtimeProvider.tsx:150` | `snapshot.alerts` chỉ thêm qua `alert.created`, **không bị xoá khi alert resolve** ⇒ chỉ reset khi reconnect |
| **Cao** | `frontend/src/components/map/MapCanvas.tsx:196-257` | Mỗi lần `items` đổi (15 giây) `clearLayers()` rồi dựng lại toàn bộ marker + popup; kèm `UnifiedMap.tsx:109-114` poll `/api/map/overview` 15 giây (LIMIT 1000) |
| **Trung bình** | `frontend/src/pages/OnlineList.tsx:45` | Poll 5 giây dữ liệu đã có qua `connection.updated` |
| **Trung bình** | `frontend/src/components/QualityPanel.tsx:103` | Poll 15 giây trùng `quality.updated` |
| **Trung bình** | `frontend/src/pages/Dashboard.tsx:152` | Poll 10 giây `/api/ops/dashboard` (aggregate nặng) trong khi socket đã có số liệu |
| **Trung bình** | `RealtimeProvider.tsx:97-108` | `entity.changed` invalidate nhiều key ⇒ trên màn Stations có 3 poller chồng nhau (list 10s, detail 15s, quality 15s) |
| **Thấp** | `frontend/src/main.tsx:18-25` | Không đặt `staleTime`/`gcTime` toàn cục ⇒ remount luôn refetch |
| **Thấp** | `frontend/src/api/client.ts:17-28` | `apiFetch` không nhận `AbortSignal` ⇒ request không huỷ khi unmount |
| **Thấp** | `components/EntityHistory.tsx:68-73`, `components/charts.tsx:195-276` | Mặc định 100 dòng, chart 30 ngày không downsample |
| **Thấp** | `components/ToastProvider.tsx:25-31` | `setTimeout` không được clear khi unmount |

## 7. Tầng hạ tầng

| Mức | Vị trí | Vấn đề |
|---|---|---|
| **Trung bình** | `docker-compose.yml` | Không đặt `deploy.resources`/`cpus`/`mem_limit` cho `mysql`, `server`, `gnss` ⇒ một service quá tải có thể ăn hết RAM/CPU host |
| **Trung bình** | `docker-compose.yml` (mysql) | Không tuning `innodb_buffer_pool_size`, `max_connections` để mặc định (151) |
| **Thấp** | `docker-compose.yml` (web) | Service dev không cấu hình log rotation (mysql/server/gnss đã có `10m × 3`) |
| Ghi chú | `gnss/cmd/corsd/main.go` | `RunRetention` của Go **không được start**; retention thực tế do maintenance phía Node đảm nhận (`scope = 'runtime'`). Đúng thiết kế nhưng cần biết để không coi là thiếu |

## 8. Rủi ro rò rỉ đã kiểm tra và loại trừ

| Hạng mục | Kết luận | Bằng chứng |
|---|---|---|
| Goroutine theo connection caster | Đóng đúng qua `done` + `closeOnce` | `gnss/internal/caster/connection.go:64-77`, `listener.go:141-143` |
| Goroutine relay session | Thoát theo `ctx.Done`, đóng cả 2 đầu | `gnss/internal/relay/bridge.go:124-141`, `201-204` |
| NMEA ticker (relay/probe/station-source) | `defer ticker.Stop()` + thoát theo ctx/`done` | `bridge.go:150-168`, `probe/manager.go:240-258`, `station_source.go:263-274` |
| Session map (probe/station-source) | Xoá khi config biến mất hoặc Shutdown | `probe/manager.go:143-169`, `station_source.go:407-433` |
| Socket listener phía client | Không cộng dồn, `disconnect()` khi unmount | `RealtimeProvider.tsx:194-197` |
| DB connection | `withTransaction` rollback/release; Go dùng `defer rows.Close()` | `server/src/db/pool.ts:26-41`, `caster/store.go` |
| Timer Node | `unref()` cho scheduler; `clearInterval` khi stop socket | `maintenance.ts:408`, `socket.ts:511-519` |
| Secret trong log | Không log Authorization/password/DSN | Đã kiểm tra các luồng relay/caster/internal |

## 9. Thứ tự ưu tiên hành động (đề xuất, chưa triển khai)

| # | Bước | Hành động | Kỳ vọng | Trạng thái |
|---|---|---|---|---|
| 1 | P11-1 | Nâng `REALTIME_POLL_MS` ≥ 2000–5000; cache `loadBaseData` 1–2 giây | Giảm mạnh query/giây và CPU Node | DONE |
| 2 | P11-2 | Chỉ `refreshAuth` mỗi 30–60 giây/socket; chỉ phát `snapshot` khi dữ liệu đổi | Bỏ O(socket) query/giây; giảm payload mạng | DONE |
| 3 | P11-3 | Chuyển `runtime.Start` ra ngoài `manager.mu` trong `caster/manager.go` | Không serialize kết nối theo latency DB | CHƯA |
| 4 | P11-4 | Thêm idle read deadline + keepalive cho relay upstream, probe, rover; thêm trần tổng connection/IP cho caster | Không treo goroutine/socket vô hạn; chống flood | CHƯA |
| 5 | P11-5 | Cache `getMapConfig` TTL 30–60 giây | Giảm 20–40 query admin mỗi khung bản đồ | CHƯA |
| 6 | P11-6 | `AsyncStore` dùng context timeout 3–5 giây | Không giữ connection vô hạn khi MySQL treo | CHƯA |
| 7 | P11-7 | Dọn `quality.Analyzer.targets` theo TTL (5–10 phút không feed); giới hạn queue quality theo **byte** | RAM có trần thật, không rò rỉ chậm | CHƯA |
| 8 | P11-8 | Frontend: bỏ poll trùng socket (OnlineList/QualityPanel), giới hạn `qualityAlerts`/`alerts`, diff marker thay `clearLayers` | Giảm re-render và DOM churn | CHƯA |
| 9 | P11-9 | Giới hạn rows cho export/timeline; cache geo có trần; thêm `connectTimeout` pool | Chặn payload/RAM đột biến | CHƯA |
| 10 | P11-10 | Đặt resource limit cho compose + tuning `innodb_buffer_pool_size` | Cô lập tài nguyên giữa các service | CHƯA |

## 10. Tiêu chí nghiệm thu khi triển khai (đề xuất)

1. Đo trước/sau bằng `HealthTab` + `OptimizeTab`: query/giây, CPU Node, heapUsed,
   `go quality.Health()` (QueueDepth/Dropped/Targets).
2. Tick 1 giây phải còn ≤ 6 query DB cố định và **0 query phụ thuộc số socket**.
3. Burst 100 kết nối caster: p95 thời gian `register` không tăng tuyến tính theo
   số kết nối; `Connections()` không bị block quá 200ms.
4. Relay/probe/caster phải tự đóng phiên khi upstream im lặng > ngưỡng cấu hình và
   chuyển state `backoff` kèm session `close_reason = timeout`.
5. RAM Go ổn định sau 24 giờ khi tạo/xoá 50 job: `Targets` không tăng đơn điệu,
   total heap không tăng tuyến tính.
6. Frontend: số lần re-render/giây của page Dashboard ≤ 1 khi dữ liệu không đổi;
   `qualityAlerts`/`alerts` có trần cố định.
7. Không có FAIL ở test hiện có; bổ sung test cho idle timeout, trần connection,
   TTL target và drop counters.
8. Không secret trong diff; `SESSION.md` cập nhật; diff review xong.

## 11. Phụ lục — bảng đối chiếu nhanh

| Khu vực | CPU | RAM | Đọc/ghi DB | Rò rỉ |
|---|---|---|---|---|
| Go caster | Trung bình (mutex toàn cục) | Thấp | — | Chậm (rover không idle) |
| Go relay | Thấp | Thấp | Thấp | Treo khi upstream im lặng |
| Go quality | **Cao** (parse + CRC ×2 dưới mutex) | Trung bình (queue byte) | Thấp | Chậm (`targets` không xoá) |
| Node realtime | **Cao** (O(socket) mỗi giây) | Thấp | **Cao** (full scan + auth/socket) | Không |
| Node routes | Trung bình (export/optimize) | Trung bình (workbook) | Trung bình | Không |
| Frontend | **Cao** (re-render 1s) | Trung bình (state tăng) | Thấp | Chậm (`qualityAlerts`, alerts) |
| Hạ tầng | Không giới hạn | Không giới hạn | MySQL mặc định | Không |

## 12. Nhật ký triển khai

| Bước | Trạng thái | Commit | Thay đổi chính | Test (lệnh → kết quả) | Ghi chú |
|---|---|---|---|---|---|
| P11-1 | DONE | `61492d3` | `REALTIME_POLL_MS` mặc định 3000 (clamp 1000–10000); thêm `REALTIME_BASE_CACHE_MS` (mặc định 1500, clamp 250–5000); `loadBaseData()` cache TTL + chia sẻ in-flight, có `invalidateBaseDataCache()` | `npm run build` PASS; `npm test` → 18 file / 119 test PASS (thêm 3 test cache) | Payload/schema socket không đổi; `snapshot:request` dùng chung cache |
| P11-2 | DONE | `__P11_2__` | Cache auth 45 giây/socket (`authRefreshDue`); revoke tức thì qua room `session:<id>` và `revokeUserSockets` (logout, đổi mật khẩu, khóa user); chỉ emit `snapshot` + sự kiện con khi chữ ký đổi (bỏ `ts` khỏi chữ ký); `quality_alerts` LIMIT 100; sửa tick dùng `tenantIds` khi build snapshot | `npm run build` PASS; `npm test` → 19 file / 122 test PASS (thêm 3 test auth) | Dữ liệu không đổi ⇒ 0 emit; logout/khóa phiên bị ngắt ngay |
