# 16 — KẾ HOẠCH: DANH SÁCH ONLINE, BẢN ĐỒ & CÁC HẠNG MỤC HỆ THỐNG

> Ngày lập: 2026-11-05
> Trạng thái: **KẾ HOẠCH — chưa triển khai**
> Thay thế 2 bản nháp trong `C:\Users\ADMIN\.opencode\plan\` (bản nháp cũ hiểu sai
> phạm vi: định siết luôn quyền publish của trạm — **không làm**).
> Tham chiếu: `AGENTS.md`, `docs/1/14_KE_HOACH_KHOA_NTRIP_THEO_CONG_TY.md`,
> `docs/1/15_KE_HOACH_DA_CONG_TY_LISTENER.md`.

---

## 0. Xác nhận cách hiểu (chốt phạm vi)

**Đúng như bạn nói:**

1. **"Danh sách online" = danh sách tài khoản NTRIP đã xác thực thành công**
   (đúng username + password, account đang enabled, có ACL, còn kết nối).
2. **Không quan tâm GGA / trạng thái fix**: thiếu GGA, `fixed`, `float`, `single`,
   hay lỗi định vị **vẫn hiển thị** — fix chỉ là thông tin phụ, không phải điều kiện lọc.
3. **Chỉ ảnh hưởng tới kết nối từ tài khoản NTRIP trên hệ thống.**
   **Không** thay đổi hành vi trạm/nguồn publish (SOURCE/POST), không siết auth nguồn trạm,
   không tạo migration cho `station_sources`.
4. Kết nối `source` (nguồn trạm/relay đẩy dữ liệu lên) **không phải tài khoản NTRIP** nên
   **không thuộc** trang Danh sách online. Nó vẫn được xem ở **CORS → Listener → Kết nối**
   (`/caster`, panel `ConnectionsPanel`).

**Hệ quả kỹ thuật (đã đối chiếu code):**
- Dòng "Tài khoản = —" trong ảnh trước là connection `direction = 'source'`, UA `CORS-MVP-relay`
  (`gnss/internal/relay/bridge.go:111-115`) — tức relay nội bộ publish, **không phải account**.
- `GET /api/connections` hiện trả **cả source lẫn rover** (`server/src/routes/caster.ts:639-703`)
  nên trang online mới hiện dòng trống. Chỉ cần lọc đúng ở API này.
- Rover đã bắt buộc Basic từ trước (`gnss/internal/caster/listener.go:96-112,309-336`),
  nên không có "rover vô danh"; chỉ cần thêm invariant + chặn username rỗng.

---

## 1. Phạm vi

### 1.1 Làm

| # | Hạng mục | Mức |
|---|---|---|
| P1 | Danh sách online chỉ hiển thị tài khoản NTRIP đã xác thực (bỏ source, bỏ dòng trống) | **P0** |
| P2 | z-index menu mobile không bị bản đồ đè | P1 |
| P3 | Bản đồ: thêm renderer MapLibre + lớp tài khoản + soát quyền/số liệu | P1 |
| P4 | `/system?tab=optimize` làm mới đúng (bỏ cảm giác "đứng yên") | P2 |
| P5 | `relay_events`: chống trùng, index, retention | P2 |
| P6 | Hướng dẫn tổng quát + deep-link từ trang Tài khoản/Trạm/Mountpoint | P2 |

### 1.2 **Không** làm (để tránh hiểu nhầm bản nháp cũ)

- Không bỏ `SourceNoAuth`, không buộc trạm phải có `caster_username/password`.
- Không chạy `UPDATE station_sources SET caster_requires_auth = 1`.
- Không drop `mountpoints.requires_auth`.
- Không đổi cách caster xác thực nguồn publish.
- Không đổi luồng byte RTCM.

---

## 2. Định nghĩa dữ liệu dùng chung

| Khái niệm | Định nghĩa | Nguồn |
|---|---|---|
| **Tài khoản NTRIP online** | connection `direction = 'rover'`, `account_id IS NOT NULL`, account tồn tại + `enabled = 1`, `username` không rỗng, `end_ts IS NULL` | `cors_runtime.caster_connections` + `cors_admin.ntrip_accounts` |
| **Nguồn trạm (source)** | connection `direction = 'source'` (trạm/relay publish) | không thuộc online list |
| **Fix/GGA** | thuộc tính hiển thị: `fixed/float/single/rtd/error/không gửi GGA` | `fixType` từ GGA (`caster/connection.go:138-139`) |
| **Trạng thái kết nối** | đang mở/đã đóng theo `end_ts` | bảng runtime |

---

# PHASE 1 (P0) — Danh sách online chỉ tài khoản NTRIP hợp lệ

## 1.1 Mục tiêu & acceptance

**Mục tiêu:** trang "Danh sách online" chỉ chứa tài khoản NTRIP đã xác thực; không còn dòng
`Tài khoản = —`; không phụ thuộc GGA/fix.

**Acceptance:**
1. `GET /api/connections` chỉ trả `direction = 'rover'` và `accountId != null`.
2. Không có item nào có `accountUsername = ''`.
3. Tài khoản không gửi GGA vẫn xuất hiện, cột fix hiển thị "chưa gửi GGA" (neutral).
4. Source (trạm/relay publish) **không** xuất hiện ở đây, vẫn thấy ở `/caster` → panel Kết nối.
5. `SOURCE`/publish của trạm: hành vi giữ nguyên (kể cả trạm đang cấu hình no-auth).
6. Tài khoản bị xoá/disable khi đang kết nối: biến mất khỏi danh sách trong ≤ 10s (reconcile)
   hoặc hiển thị username lấy từ snapshot Go, **không** hiện chuỗi rỗng.

## 1.2 Thay đổi Go (caster) — chỉ invariant, không đổi luồng

| File | Thay đổi |
|---|---|
| `gnss/internal/caster/listener.go:309-336` | Trong `authorize()`: nếu `username == ""` (Basic `":pass"` hoặc header rỗng) ⇒ `401` + `recordAuthFailure`. Hiện tại account rỗng sẽ không tìm thấy nên đã 401; thêm kiểm tra tường minh để không phụ thuộc dữ liệu. |
| `gnss/internal/caster/manager.go:387-411` | Trong `register()`: nếu `conn.direction == DirectionRover && account == nil` ⇒ trả `errAuthRequired` (không tạo connection). Đây là invariant phòng thủ. |
| `gnss/internal/caster/types.go:72-84` | (Tùy chọn, khuyến nghị) Thêm `AccountUsername string \`json:"accountUsername"\`` vào `ConnectionSnapshot`, gán ở `connection.go`/`manager.go` để API không phụ thuộc tra DB. |
| `gnss/internal/caster/store.go` | **Không đổi.** |

**Không** sửa `SourceNoAuth`, `handleSource`, `request.go` v1 SOURCE.

## 1.3 Thay đổi Node API

| File | Thay đổi |
|---|---|
| `server/src/routes/caster.ts:639-720` (`listConnections`) | Lọc cứng: bỏ mọi `direction !== 'rover'`; bỏ mọi `accountId == null`; sau khi map username, bỏ item có `accountUsername === ''` (defensive). |
| `server/src/routes/caster.ts:699-707` | Bỏ tham số `direction` khỏi endpoint này (hoặc giữ nhưng cảnh báo `source` không hợp lệ). Trang online không còn bộ lọc hướng. |
| `server/src/routes/caster.ts:758+` (`/api/caster/connections`) | **Giữ nguyên** — đây là nơi xem source + rover. |
| `server/src/lib/caster.ts:118-140` | `publicConnection` giữ `direction` để trang Caster dùng; online list chỉ rover. |
| `server/src/routes/ntripAccounts.ts:35` | Đã có `username.min(3)` + regex; bổ sung trim + chặn khoảng trắng ở import Excel (nếu chưa). |

## 1.4 Thay đổi Frontend

| File | Thay đổi |
|---|---|
| `frontend/src/pages/OnlineList.tsx:92-100` | Bỏ `Select` "Mọi hướng/Rover/Source" (trang chỉ có rover). Giữ bộ lọc fix (đã có `none` = "Chưa có GGA"). |
| `frontend/src/pages/OnlineList.tsx:130` | Bỏ fallback `'—'`; hiển thị `item.accountUsername` (API đã đảm bảo non-empty). |
| `frontend/src/pages/OnlineList.tsx:35-51` | `fixBadge`: khi không có fixType → label `"chưa gửi GGA"`, kind `neutral` (đã đúng, chỉ đổi nhãn cho rõ). |
| `frontend/src/pages/OnlineList.tsx` (PageHeader) | Subtitle: "Tài khoản NTRIP đã xác thực đang kết nối caster. Không phụ thuộc GGA/trạng thái fix." |
| `frontend/src/pages/Caster.tsx:613+` | Panel Kết nối: thêm dòng mô tả "Bao gồm nguồn (source) và rover"; giữ cột Tài khoản `—` cho source (hợp lý vì source không có account). |

## 1.5 Test

**Go (`cd gnss && go test ./...`):**
- `TestAuthorizeRejectsEmptyUsername`: Basic `":pass"` ⇒ 401.
- `TestRegisterRejectsNilAccountForRover`: gọi `register` với rover + nil ⇒ lỗi.
- Giữ nguyên test source hiện có (không đổi hành vi): `caster_test.go:393,411,446`.
- (Nếu thêm snapshot field) test JSON có `accountUsername`.

**Node (`cd server && npm test`):**
- `/api/connections`: fixture có 1 source + 2 rover (1 thiếu username) ⇒ chỉ trả 2 rover hợp lệ.
- `/api/connections`: rover không GGA vẫn trả về.
- `/api/caster/connections`: vẫn trả cả source + rover.

**Frontend:**
- `npm test` + kiểm tra thủ công: bảng không còn dòng `—`, bộ lọc fix còn "Chưa có GGA",
  empty state "Chưa có tài khoản NTRIP online."

## 1.6 Kiểm chứng trên prod

```sql
-- 1) Không còn connection rover vô danh
SELECT COUNT(*) FROM cors_runtime.caster_connections
WHERE end_ts IS NULL AND direction = 'rover' AND account_id IS NULL;
-- Kỳ vọng: 0

-- 2) Danh sách online thực tế (đối chiếu UI)
SELECT a.username, cc.mountpoint_id, cc.remote_addr, cc.start_ts,
       cc.bytes_in, cc.bytes_out
FROM cors_runtime.caster_connections cc
JOIN cors_admin.ntrip_accounts a ON a.id = cc.account_id
WHERE cc.end_ts IS NULL AND cc.direction = 'rover'
ORDER BY cc.start_ts DESC;

-- 3) Source vẫn chạy bình thường (không bị ảnh hưởng)
SELECT id, mountpoint_id, account_id, remote_addr, user_agent, start_ts
FROM cors_runtime.caster_connections
WHERE end_ts IS NULL AND direction = 'source';
```

UI: mở `/online` — mọi dòng đều có username; mở `/caster` → Kết nối — thấy source.

## 1.7 Rollout & rollback

- Không có migration. Deploy `gnss` (invariant) → `server` (lọc) → `frontend`.
- Rollback: redeploy image cũ; dữ liệu không đổi.
- Không ảnh hưởng trạm/relay đang chạy (không đổi đường publish, không đổi auth nguồn).

## 1.8 Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Ai đó dùng `/api/connections` để giám sát source | Thấp | Dùng `/api/caster/connections`; ghi rõ trong docs |
| Account bị xoá khi đang kết nối → dòng biến mất | Thấp | Reconcile 10s (`manager.go:41,165-173`); nếu cần giữ tên, thêm snapshot `accountUsername` |
| Lọc quá tay làm mất rover hợp lệ | Thấp | Test fixture; chỉ lọc `direction`/`accountId`, không lọc `fixType` |

---

# PHASE 2 — z-index menu mobile vs bản đồ

**Nguyên nhân:** `.sidebar` z-index 30, backdrop 20 (`frontend/src/styles.css:182,1557-1567`);
overlay bản đồ 1100–1400 (`1700,1746,1791,1835,1849,1864,1896,1923,2332`); Leaflet controls ~800.

**Cách làm:**
1. Token mới: `--z-map-ui`, `--z-drawer`, `--z-modal`, `--z-toast`; gán drawer/backdrop cao hơn map UI.
2. Thêm `isolation: isolate` cho container trang bản đồ để overlay không vượt stacking context.

**Acceptance:** 390/768, mở bản đồ → mở menu → click được mọi mục; backdrop/Esc hoạt động;
modal/toast không đổi thứ tự. Thêm test Playwright mobile.

---

# PHASE 3 — Bản đồ: MapLibre + lớp tài khoản + quyền

## 3.1 Renderer

- Thêm `maplibre-gl` (lazy import).
- `MapConfig` thêm `renderer: 'leaflet' | 'maplibre'` (default `leaflet`) trong
  `server/src/lib/mapConfig.ts` (zod + `DEFAULT_MAP_CONFIG`); lưu trong `settings.map.config`
  (**không cần migration**).
- `SystemMapConfig.tsx`: Select "Renderer" (chỉ superadmin như hiện tại, `mapConfig.ts:46-52`).
- Tách `frontend/src/components/map/MapCanvas.tsx` → `LeafletCanvas.tsx` + `MaplibreCanvas.tsx`
  + switch; MapLibre dùng raster source trỏ tile proxy `/api/map/tile/...`, attribution bắt buộc.

**Acceptance:** đổi renderer → reload → marker/popup/fit/legend tương đương; mobile không vỡ.

## 3.2 Lớp tài khoản (khớp định nghĩa Phase 1)

Hiện map chỉ đếm rover gắn trạm và mountpoint `station_id NULL` bị bỏ
(`server/src/routes/map.ts:300-320`; cột nullable `admin/001_init.sql:101`).

**Thiết kế:**
- Thêm `accounts[]` vào response `/api/map/overview`:
  `accountId, username, mountpointId, stationId|null, fixType, startTs, bytesIn/out`.
  Chỉ `direction = 'rover'`, `accountId != null` — **cùng định nghĩa với Danh sách online**.
- Toạ độ: station của mountpoint; nếu `station_id NULL` ⇒ `hasCoords = false`,
  đếm vào `counts.accountsOutsideStations` và hiển thị trong drawer (không vẽ marker).
- `counts.accountStatus` đếm theo tài khoản duy nhất; **không** coi thiếu GGA là "lỗi":
  - `fixType` rỗng ⇒ bucket `no_gga` (neutral).
  - `AccountFixStatus` (`server/src/lib/mapAccountStatus.ts:1-7`) thêm `'none'` (hoặc `null`),
    `normalizeFixType('')` trả `'none'` thay vì `'error'`.
- Thêm `truncated: boolean` khi > 1000 station/item (`map.ts:199,534`).

**Acceptance:** số tài khoản trên bản đồ = số dòng trang Danh sách online (cùng quyền);
tài khoản không GGA vẫn hiện, không bị tính "Lỗi"; tenant/subtree chỉ thấy phạm vi mình.

## 3.3 Quyền

- `/api/map/overview` (`stations.view`) + scope `quality/relay/connections` — giữ.
- Thêm test scope `own/subtree/tenant` cho `accounts`.
- `GET /api/map/config` hiện `requireAuth` — chấp nhận (không chứa secret); ghi chú.

---

# PHASE 4 — `/system?tab=optimize` làm mới đúng

**Nguyên nhân:** cache server 20s (`systemOptimize.ts:48,498-516`), client poll 30s + `staleTime`
(`OptimizeTab.tsx:126-130`, `main.tsx:18-24`), và `information_schema.TABLES` là **số ước lượng**
(`systemOptimize.ts:270-282`) — DELETE không làm giảm dung lượng.

**Thay đổi:**
1. `getSystemOptimize({ fresh })` bỏ cache khi `fresh`; route `/optimize` nhận `?fresh=1`.
2. Payload thêm `computedAt` + `fetchedAt` (giữ `generatedAt`).
3. UI: nút "Tải lại" gọi fresh (nonce trong queryKey), `staleTime: 0`; nhãn "ước lượng" cạnh bảng.
4. Tùy chọn: `COUNT(*)` (timeout 1500ms) cho 5 bảng lớn nhất.

**Acceptance:** bấm Tải lại thấy số mới ngay; `generatedAt` ≠ `fetchedAt` khi cache; ghi chú rõ.

---

# PHASE 5 — `relay_events`: chống trùng + index + retention

**Hiện trạng:** mỗi reconnect 1 dòng (`relay/writer.go:308`, phát tại `job.go:145`); retention 30 ngày
(`admin/034_maintenance.sql:39`); index chỉ `(relay_job_id, ts)` (`runtime/002_relay_runtime.sql:34`).

**Thay đổi:**
1. Go `BufferedWriter`: throttle `(jobID, eventType)` 1 event/60s; số bị gộp ghi vào `relay_hourly`
   và/hoặc message `(xN trong 60s)`.
2. Migration runtime `008_relay_events_index.sql`: `ADD KEY idx_relay_events_ts (ts, id)`.
3. Retention: `ORDER BY ts, id` (`relay/retention.go`, `maintenance/retention.go`).
4. UI Lịch sử: lọc theo `type`, hiển thị "đã gộp N".

**Acceptance:** số event/ngày giảm ≥ 90% khi flap; prune dùng index; vẫn truy vết được.

---

# PHASE 6 — Hướng dẫn tổng quát + deep-link

## 6.1 Chương mới

`docs-site/docs/02-huong-dan-tong-quat.md` (hoặc `02a-…`), gồm:
1. `## Tạo trạm {#tao-tram}`
2. `## Tạo mountpoint {#tao-mountpoint}`
3. `## Tạo tài khoản NTRIP {#tao-tai-khoan}`
4. `## Thông tin kết nối {#thong-tin-ket-noi}` — Host/IP, Port (2101; 1508/1509 legacy),
   Mountpoint, Username, Password, NTRIP v2 khuyến nghị.
5. `## Kiểm tra & lỗi thường gặp {#kiem-tra-ket-noi}` — 401/403/404.

Bắt buộc ảnh minh hoạ (build-guide `--check`).

## 6.2 Deep-link

- `Guide.tsx`: đọc `?doc=&anchor=`, set `iframe.src = /guide/<doc>/#<anchor>` + `key`.
- Helper `guideHref()` trong `frontend/src/guide.ts`.
- Nút "Hướng dẫn" ở `PageHeader actions`: `NtripAccounts`, `Stations`, `Mountpoints`
  (+ tùy chọn `RelayJobs`).

## 6.3 Build & test

```bash
cd docs-site && npm run build
node scripts/build-guide.mjs
node scripts/build-guide.mjs --check
node frontend/scripts/capture-guide-shots.mjs
cd frontend && npx playwright test tests/guide.spec.ts
```

**Acceptance:** từ 3 trang mở đúng section; back được; mobile ổn; `--check` PASS.

---

# 7. Thứ tự & ước lượng

| Thứ tự | Phase | Ước lượng |
|---|---|---|
| 1 | P1 — Danh sách online | 1–1.5 ngày |
| 2 | P2 — z-index | 0.5 ngày |
| 3 | P3 — Bản đồ | 3–4 ngày |
| 4 | P4 — Optimize | 0.5 ngày |
| 5 | P5 — relay_events | 1–2 ngày |
| 6 | P6 — Hướng dẫn | 1–2 ngày |

Có thể làm song song P2/P4/P5. P3 làm sau P1 để số liệu tài khoản khớp nhau.

---

# 8. Test matrix tổng

| Loại | Lệnh | Phạm vi |
|---|---|---|
| Go unit | `cd gnss && go test ./...` | caster auth, invariant, relay throttle, retention |
| Node | `cd server && npm test` | filter online, map overview, optimize, relay validation |
| Frontend | `cd frontend && npm test` | OnlineList, map renderer switch, guide link |
| Playwright | `cd frontend && npx playwright test` | mobile menu/map, guide deep-link |
| Build guide | `node scripts/build-guide.mjs --check` | ảnh/route/chương |
| Mock | script mock caster | rover auth, source không đổi hành vi |

---

# 9. Definition of Done

1. Acceptance từng phase PASS, có log/test.
2. Không secret trong diff; audit redaction đúng.
3. Không đụng `relayrtcm/backup`, không chạy `relay.exe`.
4. Diff review; `SESSION.md` cập nhật (đã làm/chưa/lỗi/cách chạy).
5. P1: ảnh chụp `/online` không còn dòng `—` + SQL đếm rover vô danh = 0.

---

# 10. Điểm cần chốt

1. Có thêm `accountUsername` vào snapshot Go không? (đề xuất: có, để không bao giờ trống tên).
2. Bản đồ: tài khoản có mountpoint `station_id NULL` — hiển thị trong drawer là đủ, hay cần
   cho phép gán toạ độ thủ công cho mountpoint?
3. `AccountFixStatus`: thêm bucket `none` ("chưa gửi GGA") — đồng ý không?
4. Có cần giữ bộ lọc "hướng" ở trang online dưới dạng ẩn (chỉ rover) hay bỏ hẳn UI?
5. Nút "Hướng dẫn" đặt ở cả 4 trang (thêm Relay) hay chỉ 3 trang?

---

# 11. KẾT QUẢ THỰC HIỆN

## KẾT QUẢ THỰC HIỆN — BƯỚC 1 (2026-11-05)

- Trạng thái: **PASS** (unit Go + vitest + typecheck frontend).
- File đã sửa:
  - `server/src/routes/caster.ts`: `listConnections` chỉ lấy rover có `accountId`,
    bỏ lọc `direction` khỏi query, loại item có `accountUsername` rỗng.
  - `server/src/lib/caster.ts`: thêm `selectOnlineConnections()`, snapshot
    `accountUsername` dùng làm fallback; `GoConnection.accountUsername`.
  - `frontend/src/pages/OnlineList.tsx`: bỏ bộ lọc hướng, bỏ fallback `—`,
    nhãn "chưa gửi GGA", subtitle/empty state mới.
  - `gnss/internal/caster/listener.go`: `authorize()` từ chối username rỗng.
  - `gnss/internal/caster/manager.go`: `register()` từ chối rover không account
    (`errAuthRequired`).
  - `gnss/internal/caster/types.go`, `connection.go`: snapshot có `accountUsername`.
  - `gnss/internal/caster/caster_test.go`: thêm 2 test invariant.
  - `server/tests/casterListener.test.ts`: thêm 3 test lọc danh sách online.
- Test đã chạy:
  - `cd gnss; go test ./internal/caster/...` → `ok cors/gnss/internal/caster`.
  - `cd server; npx vitest run tests/casterListener.test.ts` → 7/7 PASS.
  - `cd frontend; npx tsc --noEmit` → PASS (không lỗi).
- Đã chạy bổ sung: Playwright `tests/navigation.spec.ts` **PASS** sau khi dựng
  stack local (web 3000/server 4000/gnss 7080/mysql 3307) — không còn mục "chưa chạy".
- Không đổi hành vi publish của trạm (`SourceNoAuth`, `handleSource`,
  `request.go` giữ nguyên); không migration.
- Commit: `eda5943`
- Việc còn lại: kiểm tra UI trên stack local; chạy SQL kiểm chứng khi lên prod.

## KẾT QUẢ THỰC HIỆN — BƯỚC 2 (2026-11-05)

- Trạng thái: **PASS typecheck**, Playwright chưa chạy (không có stack local).
- Nguyên nhân: overlay bản đồ dùng z-index 1100–1400 nhưng `.map-shell` không tạo
  stacking context, nên phủ lên `.sidebar` (z-index 30).
- File đã sửa:
  - `frontend/src/styles.css`: `.map-shell { isolation: isolate; z-index: 0; }` —
    khoá toàn bộ overlay bản đồ trong stacking context của trang, không đánh số lại.
  - `frontend/src/components/Layout.tsx`: đóng drawer mobile bằng `Esc`.
  - `frontend/tests/map-mobile-menu.spec.ts`: test mới 390x844, kiểm tra
    `elementFromPoint` thuộc sidebar + Esc đóng.
- Test đã chạy:
  - `cd frontend; npx tsc --noEmit` → PASS.
  - Playwright `tests/map-mobile-menu.spec.ts` + `tests/ui.spec.ts` → PASS
    (390x844; `elementFromPoint` thuộc sidebar; Esc đóng).
- Commit: `56e63f5`
- Việc còn lại: kiểm tra thủ công 390/768 trên stack local.

## KẾT QUẢ THỰC HIỆN — BƯỚC 3 (2026-11-05)

- Trạng thái: **PASS** (vitest + typecheck + Playwright, gồm cả renderer MapLibre).
- Renderer:
  - `server/src/lib/mapConfig.ts`: thêm `renderer: 'leaflet' | 'maplibre'`
    (default `leaflet`, lưu trong `settings.map.config`, **không migration**).
  - `frontend/src/pages/SystemMapConfig.tsx`: Select "Renderer".
  - Tách `MapCanvas.tsx` thành switch; `LeafletCanvas.tsx` giữ nguyên hành vi;
    `MaplibreCanvas.tsx` dùng raster tile proxy, marker trạm + tài khoản,
    popup, Fit/Reset, nhãn quần đảo bằng Marker DOM, lazy-load `maplibre-gl`.
- Lớp tài khoản:
  - `server/src/routes/map.ts`: thêm `accounts[]` (rover + `accountId`), mỗi item
    `accountId, username, mountpointId, stationId|null, hasCoords, fixType,
    startTs, bytesIn/out`; gộp theo tài khoản duy nhất; thêm
    `counts.accounts`, `counts.accountsOutsideStations`, `truncated`.
  - Tài khoản gắn mountpoint `station_id NULL`: `hasCoords=false`, không vẽ marker,
    chỉ super admin thấy (không kiểm chứng được scope).
  - `mapAccountStatus.ts`: thêm bucket `none` ("chưa gửi GGA"), unknown khác rỗng
    mới là `error`; legend/nhãn cập nhật.
  - `UnifiedMap.tsx`: legend hiển thị tổng tài khoản + số tài khoản ngoài trạm.
- Test đã chạy:
  - `cd server; npx vitest run tests/map.test.ts tests/mapAccountStatus.test.ts tests/mapConfigCache.test.ts`
    → 18/18 PASS.
  - `cd frontend; npx tsc --noEmit` → PASS.
  - Playwright: `navigation`, `map-mobile-menu`, `ui`, `map`, `map-config`,
    `unified-map`, `map-upgrade` → 11/11 PASS.
  - Playwright mới `tests/map-maplibre.spec.ts`: đổi renderer → lưu → `/map`
    hiển thị MapLibre + attribution, Fit không lỗi → PASS (tự trả cấu hình về Leaflet).
  - Playwright mới `tests/map-accounts.spec.ts`: `counts.accounts` khớp
    `/api/connections.total`, username không rỗng, `hasCoords` khớp `stationId` → PASS.
- Ghi chú: `GET /api/map/config` vẫn chỉ `requireAuth` (không chứa secret) — giữ nguyên.
- Commit: `__COMMIT__`
- Việc còn lại: kiểm tra thủ công mobile với renderer MapLibre (Playwright đã phủ desktop).

