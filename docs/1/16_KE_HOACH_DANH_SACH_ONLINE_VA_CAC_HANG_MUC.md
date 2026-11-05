# 16 — KẾ HOẠCH: DANH SÁCH ONLINE, BẢN ĐỒ & CÁC HẠNG MỤC HỆ THỐNG

> Ngày lập: 2026-11-05
> Trạng thái: **ĐÃ TRIỂN KHAI LOCAL** (nhánh `feat/plan16`, 2026-11-05) — chưa deploy VPS.
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
4. `## Thông tin kết nối {#thong-tin-ket-noi}` — Host/IP, Port (xem CORS → Listener,
   ví dụ 2101), Mountpoint, Username, Password, NTRIP v2 khuyến nghị.
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
- Commit: `0fee117`
- Việc còn lại: kiểm tra thủ công mobile với renderer MapLibre (Playwright đã phủ desktop).

## KẾT QUẢ THỰC HIỆN — BƯỚC 4 (2026-11-05)

- Trạng thái: **PASS** (vitest + typecheck + Playwright).
- File đã sửa:
  - `server/src/lib/systemOptimize.ts`: `getSystemOptimize({ fresh })` bỏ cache khi
    `fresh`; payload thêm `computedAt` (lúc tính) và `fetchedAt` (lúc trả), giữ
    `generatedAt`.
  - `server/src/routes/system.ts`: `/optimize` nhận `?fresh=1` (vẫn `system_ops.view`).
  - `frontend/src/pages/system/OptimizeTab.tsx`: nút "Tải lại" tăng `nonce` →
    gọi `?fresh=1`, `staleTime: 0`; hiển thị "Tính lúc … · tải lúc …"; nhãn
    "ước lượng" + ghi chú InnoDB/DELETE.
- Test đã chạy:
  - `cd server; npx vitest run tests/systemOptimize.test.ts` → 6/6 PASS.
  - `cd frontend; npx tsc --noEmit` → PASS.
  - Playwright `tests/system-ops.spec.ts` → 3/3 PASS, gồm test bắt request
    `/api/system/optimize?fresh=1` và mốc "tải lúc".
- Commit: `4e3191d`
- Việc còn lại: không.

## KẾT QUẢ THỰC HIỆN — BƯỚC 5 (2026-11-05)

- Trạng thái: **PASS** (Go unit + typecheck + Playwright + EXPLAIN local).
- File đã sửa:
  - `gnss/internal/relay/writer.go`: throttle `(jobID, eventType)` tối đa 1 event/60s;
    số bị gộp ghi vào message của event kế tiếp dạng `(gộp N sự kiện trong 1m0s)`.
  - `db/migrations/runtime/008_relay_events_index.sql`: thêm `idx_relay_events_ts (ts, id)`.
  - `gnss/internal/relay/retention.go`, `gnss/internal/maintenance/retention.go`:
    prune `ORDER BY ts, id` để dùng index mới.
  - `frontend/src/pages/History.tsx`: tab Sự kiện có lọc "Loại sự kiện"
    (`?type=`), giữ bộ lọc job/thời gian.
- Test đã chạy:
  - `cd gnss; go test ./internal/relay/... ./internal/maintenance/...` → PASS
    (gồm `TestEventThrottlesByJobAndType`: 100 lần/10s → 1 event + gộp 99).
  - `cd frontend; npx tsc --noEmit` → PASS.
  - Migration local: `runtime 008_relay_events_index.sql applied`; `SHOW INDEX` có
    `idx_relay_events_ts`; `EXPLAIN` dùng `idx_relay_events_ts` + `Using index`.
  - Playwright `tests/history-events.spec.ts` PASS (bắt request `type=reconnect`);
    `tests/relay-state.spec.ts` + `tests/timeline.spec.ts` → 6/6 PASS.
- Commit: `2041ab7`
- Việc còn lại: chạy migration trên staging/prod khi triển khai (chưa deploy).

## KẾT QUẢ THỰC HIỆN — BƯỚC 6 (2026-11-05)

- Trạng thái: **PASS** (build tài liệu + typecheck + Playwright 8/8, trừ G5 do thiếu fixture local).
- File đã sửa:
  - `docs-site/docs/02a-huong-dan-tong-quat.md` (mới): 5 mục có anchor
    `#tao-tram`, `#tao-mountpoint`, `#tao-tai-khoan`, `#thong-tin-ket-noi`,
    `#kiem-tra-ket-noi`; mỗi mục có ảnh; bảng thông tin kết nối (Port xem trong
    CORS → Listener, ví dụ 2101; NTRIP v2) và bảng lỗi 401/403/404/429/503.
  - `frontend/src/guide.ts`: `guideUrl()` (validate slug/anchor) và `guideHref()`.
  - `frontend/src/pages/Guide.tsx`: đọc `?doc=&anchor=`, iframe `src` + `key`,
    link "Mở toàn màn hình" theo đúng chương.
  - `Stations.tsx`, `Mountpoints.tsx`, `NtripAccounts.tsx`: nút "Hướng dẫn"
    (icon `BookOpen`) mở đúng anchor.
  - `frontend/tests/guide.spec.ts`: thêm G9 kiểm tra deep-link từ cả 3 trang.
- Test đã chạy:
  - `node scripts/build-guide.mjs --check` → PASS (14 chương, 19 route).
  - `node scripts/build-guide.mjs` → build Docusaurus + copy `frontend/public/guide` PASS.
  - `cd frontend; npx tsc --noEmit` → PASS.
  - `npx playwright test tests/guide.spec.ts --grep-invert "G5"` → 8/8 PASS.
  - G5 (3 vai trò) không chạy được trên local: DB chỉ có `superadmin`, thiếu
    `docs.admin`/`docs.user`; đây là thiếu fixture, không phải lỗi thay đổi.
- Commit: `7c91742`
- Việc còn lại: chạy G5 khi có seed docs fixtures; kiểm tra mắt thường 3 nút hướng dẫn.

## KẾT QUẢ THỰC HIỆN — BƯỚC 7 (TỔNG KIỂM TRA, 2026-11-05)

- **Go**: `cd gnss; go test ./...` → 12/12 package `ok`, không FAIL.
- **Node**: `cd server; npx vitest run` → **196/196 test PASS** (40 file).
- **Frontend typecheck**: `cd frontend; npx tsc --noEmit` → PASS.
- **Playwright toàn bộ** (sau khi seed fixture local bằng
  `ALLOW_DOCS_SEED=1 node scripts/seed-docs-fixtures.mjs --apply`):
  **68 PASS / 1 FAIL / 1 skipped**.
  - FAIL duy nhất: `tests/p1-station-fix.spec.ts` — test cũ gửi
    `PUT /api/stations/:id/sources` đổi `caster_username` sau khi tạo, API trả
    `409 IMMUTABLE_FIELD`. Lỗi **có sẵn**, không liên quan thay đổi plan 16
    (không sửa `server/src/routes/stations.ts`). Cần cập nhật test hoặc API sau.
- **Graphify**: `graphify update .` → 4907 nodes / 11066 edges / 340 communities.
- **Bảo mật**: `git diff main...HEAD` không có PRIVATE KEY / MYSQL_ROOT_PASSWORD /
  SESSION_SECRET / INTERNAL_HMAC_SECRET; không commit `.env.local`.
- **Phạm vi**: không đụng `relayrtcm/backup`, không chạy `relay.exe`, không deploy VPS.
- Ghi chú vận hành: `frontend/public/guide` là thư mục build (gitignore) — khi
  triển khai phải chạy lại `node scripts/build-guide.mjs`.

### Tổng hợp 6 bước

| Bước | Nội dung | Test chính | Commit |
|---|---|---|---|
| 1 | Online chỉ tài khoản NTRIP đã xác thực | Go caster, vitest 7/7, Playwright navigation | `eda5943` |
| 2 | Menu mobile không bị bản đồ đè | tsc, Playwright mobile menu/ui | `56e63f5` |
| 3 | MapLibre + lớp tài khoản | vitest 18/18, Playwright 13/13 | `0fee117` |
| 4 | Optimize fresh | vitest 6/6, Playwright 3/3 | `4e3191d` |
| 5 | relay_events throttle + index | Go relay/maintenance, EXPLAIN, Playwright 7/7 | `2041ab7` |
| 6 | Hướng dẫn + deep-link | build-guide PASS, Playwright 8/8 | `7c91742` |

---

# KẾ HOẠCH BỔ SUNG 1 — HAI RENDERER CÙNG HOẠT ĐỘNG + FALLBACK

> Ngày lập: 2026-11-05
> Trạng thái: **KẾ HOẠCH — chưa triển khai**
> Phạm vi: chỉ ổn định renderer Leaflet/MapLibre, chuyển đổi qua lại và tự fallback.
> **Không** làm 3D, terrain, vector style, cluster nâng cao hay provider matrix.

## 1. Mục tiêu

1. Leaflet và MapLibre đều render được: nền tile, marker trạm/tài khoản, popup, Fit/Reset.
2. Chuyển đổi renderer trong **Cấu hình bản đồ**, tải lại trang vẫn giữ lựa chọn.
3. MapLibre lỗi (WebGL/worker/chunk) → **tự về Leaflet** + banner lý do, không trắng trang.
4. Không thay đổi dữ liệu/API hiện có (renderer đã lưu đúng trong `settings['map.config']`).

## 2. Nguyên nhân đã xác minh

| # | Vấn đề | Bằng chứng |
|---|---|---|
| B1 | Build thiếu worker MapLibre | `dist/assets/MaplibreCanvas-*.js` tham chiếu `new URL('./maplibre-gl-worker.mjs', import.meta.url)` nhưng `dist/assets/` không có file này |
| B2 | Dev thiếu worker | `.vite/deps` chỉ có `maplibre-gl.js`; chưa `optimizeDeps.exclude` |
| B3 | Không có WebGL check/fallback | `MapCanvas.tsx` chỉ if/else; `MaplibreCanvas` không try/catch |
| B4 | Test quá yếu | `map-maplibre.spec.ts` chỉ assert canvas + attribution, không assert tile/marker |
| — | Lưu cấu hình renderer đúng | `PUT /api/map/config` + `validateMapConfigInput` giữ `renderer` |

## 3. Thay đổi chi tiết

### 3.1 `frontend/vite.config.ts` (sửa gốc)

- Thêm:
  ```ts
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' }
  ```
- Thêm plugin `copyMaplibreWorkerPlugin` (chỉ áp dụng khi build):
  - sau khi build xong, copy `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs`
    → `dist/assets/maplibre-gl-worker.mjs`;
  - nếu không tìm thấy file nguồn hoặc copy lỗi → **fail build** (không để im lặng).
  - Không cần copy `maplibre-gl-shared.mjs` (hiện 0 byte).
- (Tùy chọn, không bắt buộc) `manualChunks` tách Leaflet khỏi entry.

### 3.2 `frontend/src/components/map/MapCanvas.tsx` (adapter an toàn)

- Thêm `webglAvailable()`: tạo canvas thử `webgl2`/`webgl`, trả boolean.
- Thêm state `fallbackReason`.
- Nếu `renderer === 'maplibre'`:
  - `!webglAvailable()` → render `LeafletCanvas` + reason "Trình duyệt không hỗ trợ WebGL";
  - lazy import thất bại (`.catch`) → render Leaflet + reason "Không tải được MapLibre".
- Truyền `onFallback(reason)` lên `UnifiedMap`.
- Renderer lạ/không xác định → Leaflet (giữ hành vi an toàn hiện tại).

### 3.3 `frontend/src/components/map/MaplibreCanvas.tsx`

- `try/catch` quanh `new maplibregl.Map(...)`; lỗi → gọi `onFatal(reason)`.
- Timeout `map.on('load')` 8 giây; quá hạn → `onFatal('MapLibre không khởi tạo được')`.
- Cleanup timeout khi unmount.
- Không đổi logic tile/marker/popup/fit hiện có.

### 3.4 `frontend/src/pages/UnifiedMap.tsx`

- Hiển thị banner nhỏ khi fallback (dùng `.map-error-float` sẵn có),
  nội dung: "Không dùng được MapLibre — đang dùng Leaflet. Lý do: …".
- Không đổi layout/toolbar.

### 3.5 Test

Cập nhật `frontend/tests/map-maplibre.spec.ts` (và giữ test cũ):

1. **Worker 200**: `page.waitForResponse(url.includes('maplibre-gl-worker'))`.
2. **Tile thực sự được gọi**: đếm request `/api/map/tiles/` > 0.
3. **Marker render**: chỉ trong dev expose `window.__map`;
   assert `map.isSourceLoaded('tiles')` và `map.querySourceFeatures('stations').length > 0`.
4. **Chuyển đổi 2 chiều**: Leaflet → MapLibre → Leaflet, reload vẫn giữ renderer.
5. **Fallback**: `page.addInitScript` chặn `getContext('webgl*')` →
   thấy `.leaflet-container` + banner, không có `pageerror`.
6. **Build check**: script `scripts/plan16/07-kiem-tra-build-ban-do.ps1` (tiếng Việt,
   `-DryRun` không cần) fail nếu `dist/assets/maplibre-gl-worker.mjs` thiếu.

### 3.6 Tài liệu

- `docs-site/docs/04-ban-do.md`: thêm mục renderer + fallback.
- `SESSION.md`: ghi kết quả từng bước.

## 4. Thứ tự thực hiện

1. Vite worker + build check (sửa gốc B1/B2).
2. Fallback adapter (B3).
3. Test mạnh + test fallback (B4).
4. Verify: dev (worker 200, tile > 0, marker), build (có worker), preview.
5. Docs + commit/push.

## 5. Acceptance

- Dev: worker 200, tile request > 0, marker hiện, chuyển Leaflet ↔ MapLibre 2 chiều.
- Build: `dist/assets/maplibre-gl-worker.mjs` tồn tại; bản build render được MapLibre.
- WebGL tắt hoặc worker 404 → tự về Leaflet + banner, không trắng trang.
- Reload giữ renderer đã chọn.
- `cd frontend; npx tsc --noEmit` PASS.
- Playwright map suite PASS (gồm test fallback).

## 6. Ước lượng & rủi ro

- Ước lượng: **0.5–1 ngày**.
- Rủi ro: đường dẫn copy worker sai giữa dev/build (giảm thiểu bằng build check);
  `optimizeDeps.exclude` làm dev khởi động chậm hơn;
  fallback phải tránh vòng lặp (chỉ fallback một lần, hiển thị lý do).

## 7. Không thuộc phạm vi

3D/terrain, vector tile style, cluster nâng cao, provider↔renderer matrix,
registry runtime đầy đủ như mã nguồn tham chiếu.

## KẾT QUẢ THỰC HIỆN — KẾ HOẠCH BỔ SUNG 1 (2026-11-05)

- Trạng thái: **PASS** (build + Playwright + typecheck).
- File đã sửa:
  - `frontend/vite.config.ts`: `optimizeDeps.exclude: ['maplibre-gl']`,
    `worker.format: 'es'`, plugin `copy-maplibre-worker` (fail build nếu thiếu).
  - `frontend/src/components/map/MapCanvas.tsx`: phát hiện WebGL, lazy import có
    bắt lỗi, fallback Leaflet + `onFallback`.
  - `frontend/src/components/map/MaplibreCanvas.tsx`: try/catch khi tạo map,
    timeout load 8s, expose `window.__map` ở dev để test.
  - `frontend/src/components/map/LeafletCanvas.tsx`: thêm prop `onFallback`.
  - `frontend/src/pages/UnifiedMap.tsx`: banner khi fallback.
  - `frontend/tests/map-maplibre.spec.ts`: worker 200, tile > 0, marker render,
    chuyển đổi 2 chiều + reload, fallback khi chặn WebGL.
  - `scripts/plan16/07-kiem-tra-build-ban-do.ps1`: kiểm tra worker trong `dist`.
- Bằng chứng:
  - `cd frontend; npm run build` → PASS; `scripts/plan16/07-kiem-tra-build-ban-do.ps1`
    → ĐẠT, `maplibre-gl-worker.mjs` 507.2 KB trong `dist/assets`.
  - Playwright `map-maplibre.spec.ts` → 3/3 PASS.
  - Playwright hồi quy `map`, `map-upgrade`, `unified-map`, `map-accounts` → 6/6 PASS.
- Commit: `__COMMIT__`
- Việc còn lại: kiểm tra thủ công trên trình duyệt thật (Playwright đã phủ Chrome).

---

# KẾ HOẠCH BỔ SUNG 2 — LỚP RANH GIỚI & TÊN TỈNH

> Ngày lập: 2026-11-05
> Trạng thái: **KẾ HOẠCH — chưa triển khai**
> Phạm vi: thêm layer ranh giới tỉnh + tên tỉnh, bật/tắt trong mục **Nền bản đồ**.
> Áp dụng cho **cả Leaflet và MapLibre**, không thêm dependency.

## 1. Hiện trạng đã kiểm tra

| Hạng mục | Kết quả |
|---|---|
| File dữ liệu | `frontend/public/guide/assets/map/vietnam-provinces.geojson` |
| Kích thước | 186.198 bytes |
| Nội dung | `FeatureCollection`, **34 tỉnh/thành**, geometry `MultiPolygon`, property duy nhất `name` |
| Vị trí | Nằm trong `frontend/public/guide/` — **thư mục build, đã gitignore** |
| Rủi ro | `node scripts/build-guide.mjs` xoá và copy lại `frontend/public/guide` → file sẽ **mất** |
| Repo | Chưa có file `.geojson` nào được track |

**Kết luận:** phải copy file sang vị trí ổn định, ví dụ
`frontend/public/geo/vietnam-provinces.geojson` (được Vite serve tại
`/geo/vietnam-provinces.geojson`), rồi mới dùng trong code.

## 2. Thiết kế

### 2.1 Dữ liệu

- Copy file gốc sang `frontend/public/geo/vietnam-provinces.geojson`.
- Ghi chú nguồn/giấy phép của file (hiện chưa rõ) trong
  `frontend/public/geo/README.md` hoặc đầu file; nếu không xác định được thì
  ghi "nguồn do người dùng cung cấp" và không tuyên bố giấy phép.
- Cache GeoJSON trong bộ nhớ (module-level `Promise`) để bật/tắt không fetch lại.

### 2.2 UI bật/tắt

- Vị trí: popover **Nền bản đồ** trong `frontend/src/pages/UnifiedMap.tsx`
  (khối `panel === 'modes'`, dưới Select chọn mode).
- Thêm checkbox:
  ```tsx
  <label className="checkbox-field">
    <input
      type="checkbox"
      checked={showProvinces}
      onChange={(event) => applyPatch({ provinces: event.target.checked ? null : '0' })}
    />
    <span>Ranh giới & tên tỉnh</span>
  </label>
  ```
- Trạng thái lưu trên URL: mặc định **bật**; tắt ghi `?provinces=0`.
  (`applyPatch` đã có sẵn cơ chế lưu/khôi phục query params.)
- Một toggle cho cả đường ranh giới và tên tỉnh (đúng yêu cầu, tránh rối UI).

### 2.3 Leaflet (`LeafletCanvas.tsx`)

- Thêm prop `showProvinces`.
- Khi bật:
  - `fetch('/geo/vietnam-provinces.geojson')` (cache module-level).
  - `L.geoJSON(data, { style: { color: '#2563eb', weight: 1, dashArray: '4 4', fillOpacity: 0 } })`.
  - Với mỗi feature: tính tâm từ `layer.getBounds().getCenter()`, gắn
    `bindTooltip(name, { permanent: true, direction: 'center', className: 'map-province-label' })`.
  - Ẩn tooltip khi `zoom < 6` (bắt `zoomend`), tránh rối ở mức quốc gia.
  - Thêm layer vào map; cleanup `map.removeLayer(layer)` khi tắt/unmount.
- Thứ tự hiển thị: vector nằm ở overlay pane, dưới marker sẵn có.

### 2.4 MapLibre (`MaplibreCanvas.tsx`)

- Thêm prop `showProvinces`.
- Khi bật:
  - Thêm source `provinces` (GeoJSON) + layer `provinces-line`:
    ```ts
    { id: 'provinces-line', type: 'line', source: 'provinces',
      paint: { 'line-color': '#2563eb', 'line-width': 1, 'line-dasharray': [4, 4] } }
    ```
    chèn **dưới** `stations-layer`.
  - Tên tỉnh: dùng DOM Marker tại tâm bbox (không dùng `symbol` để tránh phụ
    thuộc `glyphs`/font ngoài), cùng class `map-province-label`.
  - Ẩn tên khi `zoom < 6` (`zoomend`), giống Leaflet.
- Tắt: remove layer/source + markers.

### 2.5 CSS (`frontend/src/styles.css`)

```css
.map-province-label {
  background: transparent;
  border: 0;
  box-shadow: none;
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
  pointer-events: none;
  text-shadow: 0 1px 2px var(--surface), 0 0 4px var(--surface);
  white-space: nowrap;
}
```

## 3. Test

Playwright (thêm vào `map.spec.ts` hoặc spec mới `map-provinces.spec.ts`):

1. Mặc định bật: mở `/map` → có label tỉnh (Leaflet: `.map-province-label`;
   MapLibre: cùng class) và ít nhất 1 đường ranh giới.
2. Tắt trong **Nền bản đồ** → label/biên biến mất, URL có `provinces=0`;
   reload vẫn tắt.
3. Bật lại → xuất hiện; reload vẫn bật.
4. Chạy cho **cả 2 renderer** (đổi renderer trong Cấu hình bản đồ).
5. Không có `pageerror`; `tsc --noEmit` PASS.

## 4. Acceptance

- Cả Leaflet và MapLibre hiển thị ranh giới + tên 34 tỉnh.
- Bật/tắt được trong mục **Nền bản đồ**, trạng thái giữ sau reload.
- Không thêm dependency; không đổi API/DB.
- Không ảnh hưởng marker/popup/fit hiện có.
- File GeoJSON nằm ở vị trí được track, không phụ thuộc `public/guide`.

## 5. Ước lượng & rủi ro

- Ước lượng: **0.5 ngày**.
- Rủi ro: nhãn tỉnh dày ở zoom thấp (giảm thiểu bằng ngưỡng zoom ≥ 6);
  dữ liệu 34 tỉnh theo đơn vị hành chính mới — cần xác nhận đúng phiên bản;
  chưa rõ giấy phép file gốc — phải ghi nguồn trước khi phát hành.

## 6. Không thuộc phạm vi

Sửa ranh giới theo thời gian, tô màu theo trạm, tra cứu địa chỉ theo tỉnh,
3D/terrain.

