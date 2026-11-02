# 10 — KẾ HOẠCH MA TRẬN TRẠNG THÁI RELAY (ĐỒNG BỘ VỚI TRẠM)

> Ngày lập: 2026-11-02
> Trạng thái: **KẾ HOẠCH — chưa triển khai, chưa sửa mã nguồn**
> Phạm vi: trạng thái và ma trận hành động của `relay_jobs` (single, bulk, import),
> cách Go đọc cấu hình, cách Node trả trạng thái, UI `/relay-jobs`.
> Nguyên tắc: giữ nguyên ranh giới Node/Go — Node ghi `cors_admin`, Go chỉ đọc cấu
> hình và ghi `cors_runtime`; Node chỉ **đọc** runtime state để hiển thị/kiểm tra.
> Tham chiếu: `AGENTS.md` §4/§8/§9, `docs/2/PHAN_QUYEN.md`,
> `docs/1/04_KE_HOACH_REALTIME_CRUD.md` Bước 5.

## 1. Kết luận rà soát

### 1.1. Trạng thái trạm — chuẩn tham chiếu hiện có

| Thành phần | Nguồn | Ghi chú |
|---|---|---|
| `enabled` | `cors_admin.stations` | Ý định bật/tắt chạy |
| `status` | `active/disabled/locked` | Khóa là trạng thái thứ ba |
| Runtime | `cors_runtime.station_source_sessions` | Node chỉ đọc |

Ma trận trạm đã chốt (`docs/1/04_KE_HOACH_REALTIME_CRUD.md:502-564`):

- Lock khi đang bật → 400 `STATION_ENABLED` (`stations.ts:1859-1861`).
- Enable/disable/patch-enabled khi đang khóa → `STATION_LOCKED`
  (`stations.ts:1758-1762`, `stations.ts:1803-1806`).
- Unlock → về `disabled`, **không** tự bật (`stations.ts:1894-1901`).
- Xóa: chỉ khi tắt **và** mở khóa (`stations.ts:2801-2806`).
- Bulk dùng chung luật, trả `updated/skipped/forbidden/notFound`
  (`stations.ts:2716-2771`).
- UI tính trước tập mục hợp lệ cho từng hành động (`Stations.tsx:612-620`),
  có nút khóa/mở khóa từng dòng.

### 1.2. Relay hiện tại

Cấu hình (`relay_jobs`):

| Cột | Ý nghĩa |
|---|---|
| `enabled` | Bật/tắt job |
| `locked` | Khóa cấu hình (cờ riêng, không phải `status`) |
| `deleted_at` | Xóa mềm |
| `paused_by_station_id` / `paused_by_mountpoint_id` | Tự tạm dừng do nguồn tắt |
| `desired_revision` | Cấu hình mong muốn |

Runtime (`db/migrations/runtime/002_relay_runtime.sql`): `relay_job_state` có
`runtime_state ENUM('disabled','pending','connecting','streaming','backoff','error','stopped')`,
`applied_revision`, `last_error`, `last_applied_at`.

API hiện có (`server/src/routes/relayJobs.ts`):

| Endpoint | Guard hiện tại |
|---|---|
| `POST /:id/enable` | khóa → 409 `RELAY_LOCKED`; paused → 409 `RESOURCE_PAUSED` |
| `POST /:id/disable` | khóa → 409 `RELAY_LOCKED` |
| `POST /:id/lock` | đang bật → 400 `RELAY_ENABLED`; xóa `paused_*` |
| `POST /:id/unlock` | không kiểm tra trạng thái; xóa `paused_*` |
| `POST /:id/restart` | **không** kiểm tra khóa/tắt |
| `POST /:id/test` | **không** kiểm tra khóa/tắt |
| `PATCH /:id` | **không** kiểm tra khóa; nhận `enabled` từ body |
| `DELETE /:id` | **không** kiểm tra bật/khóa/online |
| `POST /bulk` | kiểm tra lock/enable, **trừ `delete`** |

UI (`frontend/src/pages/RelayJobs.tsx`): khóa/mở khóa chỉ có trong thanh bulk
(dòng 435-436), **không có nút từng dòng**; nút xóa luôn bật.

### 1.3. Lỗ hổng xác nhận được

| ID | Lỗ hổng | Bằng chứng |
|---|---|---|
| B1 | Xóa relay đang bật / đang khóa / đang online vẫn thành công | `relayJobs.ts:1719-1751`; bulk `relayJobs.ts:1452-1460` |
| B2 | `PATCH /:id` bật lại được job đang khóa → phá bất biến `locked ⇒ !enabled` | `relayJobs.ts:1288-1299` (trạm chặn: `stations.ts:1758`) |
| B3 | Go coi job bị khóa (hoặc bị loại vì trạm nguồn tắt) là **không tồn tại** → đóng phiên lý do `deleted`, ghi `runtime_state='stopped'`, `last_error='deleted'` | `gnss/internal/relay/store.go:127-160`, `manager.go:143-152` |
| B4 | Status list trả `null` khi khóa → badge `—` thay vì `offline` | `relayJobs.ts:267-272`, `RelayJobs.tsx:71-83` |
| B5 | Không có nút khóa/mở khóa từng dòng | `RelayJobs.tsx:563-612` |
| B6 | Bulk không lọc target hợp lệ, chỉ dựa vào server skip | `relayJobs.ts:1423-1460` |
| B7 | Reconcile fire-and-forget, không trả kết quả; poll 10 giây nên runtime có thể còn chạy sau khi UI đã báo tắt | `relayJobs.ts:375-380`, `.env.example:56` |
| B8 | Import không chặn ghi đè `enabled` của job đang khóa | `relayJobs.ts:1577-1600` |
| B9 | `restart`/`test` chạy được khi job đang khóa | `relayJobs.ts:1872-1923` |
| B10 | Không hiển thị “đang áp dụng” khi `desired_revision > applied_revision` | `RelayJobs.tsx:530-540` |

Hệ quả người dùng báo:

1. **Relay đang online vẫn xóa được** → không có guard B1; hàng biến mất khỏi
   danh sách ngay, phiên chỉ đóng sau reconcile/poll.
2. **Khóa relay nhưng vẫn online** → B4 hiển thị `—`; B2 cho phép bật lại job
   đã khóa; B3 làm Go ghi nhầm `stopped/deleted` thay vì `disabled`; B7 tạo cửa
   sổ tới 10 giây trước khi runtime dừng.

### 1.4. Ràng buộc kiến trúc

- Node không ghi `cors_runtime`; chỉ đọc `relay_job_state` (được phép) và gọi
  internal API HMAC (`/internal/reconcile`).
- Go không sửa cấu hình; chỉ đọc `relay_jobs` + `relay_credentials`.
- Không thêm dịch vụ, không đổi stack.

## 2. Mục tiêu và tiêu chí thành công

1. Không thể tạo tổ hợp trạng thái sai qua bất kỳ đường nào: single, bulk,
   PATCH, import, hay DB (ràng buộc dữ liệu).
2. Xóa relay chỉ thành công khi job đã tắt, đã mở khóa và runtime không còn chạy.
3. Khóa relay → UI hiển thị `offline` ngay; Go dừng job với lý do `disabled`
   (không phải `deleted`); lịch sử phiên phản ánh đúng.
4. Thao tác trạng thái trả kết quả reconcile để UI biết “đã áp dụng” hay “đang chờ”.
5. UI relay có cùng bộ hành động và quy tắc như UI trạm.

Tiêu chí đo được:

- Bảng ma trận mục 4 có test cho 100% ô.
- `grep` code không còn đường nào ghi `enabled=1` khi `locked=1`.
- Go test mới: job locked → `runtime_state='disabled'`, close reason `disabled`.
- E2E: xóa khi bật/khóa/online → lỗi 409; khóa → badge `offline`.

## 3. Quyết định mặc định

| ID | Quyết định | Lý do |
|---|---|---|
| Q10-1 | Mọi guard tập trung ở `server/src/lib/relayState.ts`, dùng chung single/bulk/import | Tránh lệch luật như hiện tại |
| Q10-2 | Không thêm cột; giữ `enabled` + `locked` + `deleted_at` | Không phá dữ liệu/Go hiện có |
| Q10-3 | Bất biến dữ liệu: `locked ⇒ !enabled`, `deleted ⇒ !enabled`, thêm CHECK ở migration 035 | Chặn cả đường DB/import |
| Q10-4 | Mã lỗi trạng thái dùng **409** (`RELAY_ENABLED`, `RELAY_LOCKED`, `RELAY_DISABLED`, `RELAY_ONLINE`, `RELAY_PENDING`, `RELAY_UNLOCKED`); 400 chỉ cho sai định dạng | Bulk đã dùng 409 → `skipped`; thống nhất một loại |
| Q10-5 | Xóa **không** tự tắt hộ; trả lỗi hướng dẫn (giống trạm) | Tránh xóa khi đang truyền byte |
| Q10-6 | Lock/unlock **không** xóa `paused_by_*`; thêm `locked = 0` vào SQL pause/resume của trạm | Giữ lý do tạm dừng, tránh tự bật job đã khóa |
| Q10-7 | “Online” để chặn xóa dùng `relay_job_state.runtime_state ∈ (connecting, streaming)` và `applied_revision >= desired_revision` | Node chỉ đọc runtime, không gọi Go thêm |
| Q10-8 | Nút khóa/mở khóa từng dòng + bulk lọc target như trạm | Đồng bộ UX |

## 4. Ma trận trạng thái đích

### 4.1. Biến và nguồn sự thật

| Biến | Nguồn | Vai trò |
|---|---|---|
| `E` = enabled | `cors_admin` | Ý định chạy, do người dùng đặt |
| `L` = locked | `cors_admin` | Chặn thay đổi cấu hình |
| `D` = deleted_at | `cors_admin` | Xóa mềm |
| `P` = paused_by_station/mountpoint | `cors_admin` | Tự tạm dừng do nguồn |
| `R` = runtime_state | `cors_runtime` | Sự thật runtime (Go ghi) |
| `A` = applied_revision | `cors_runtime` | Cấu hình đã áp dụng |
| `V` = desired_revision | `cors_admin` | Cấu hình mong muốn |

`pending` khi `A < V`. Trạng thái hiển thị **ưu tiên cấu hình** (E/L/D/P) rồi
mới tới runtime — nhờ vậy UI chuyển `offline` ngay khi tắt/khóa, không chờ poll.

### 4.2. Trạng thái hiển thị

| Ưu tiên | Điều kiện | Nhãn UI | Badge |
|---|---|---|---|
| 1 | `D` | `deleted` (ẩn khỏi danh sách) | — |
| 2 | `L = 1` | `locked` | `offline` |
| 3 | `P` | `paused` | `offline` |
| 4 | `E = 0` | `disabled` | `offline` |
| 5 | `A < V` | `pending` | `offline` + “đang áp dụng x/y” |
| 6 | `R = streaming` và cả 2 chiều tươi | `online` | `online` |
| 7 | `R = streaming`, một chiều cũ/không dữ liệu | `no_data` | `không có dữ liệu` |
| 8 | còn lại | `offline` | `offline` |

Quy ước chiều: dùng `combinedRelayStatus` hiện có
(`server/src/lib/statusTimeline.ts`): một chiều offline → offline; cả hai online
→ online; còn lại `no_data`. `relayDirectionStatus` phải trả `offline` khi
`L` hoặc `E = 0` (đã đúng).

### 4.3. Ma trận hành động

Ký hiệu: ✓ cho phép · ✗ từ chối 409 · ↺ idempotent (trả nguyên trạng).

| Hành động | D | L=1 | P | E=1 | E=0 | pending | online |
|---|---|---|---|---|---|---|---|
| enable | ✗ | ✗ `RELAY_LOCKED` | ✗ `RESOURCE_PAUSED` | ↺ | ✓ | ✓ | — |
| disable | ✗ | ✗ `RELAY_LOCKED` | ✓ | ✓ | ↺ | ✓ | ✓ |
| lock | ✗ | ↺ | ✓ | ✗ `RELAY_ENABLED` | ✓ | ✗ `RELAY_PENDING` | ✗ `RELAY_ONLINE` |
| unlock | ✗ | ✓ | ✓ | ✗ `RELAY_UNLOCKED` | ✗ `RELAY_UNLOCKED` | ✗ | ✗ |
| restart | ✗ | ✗ `RELAY_LOCKED` | ✗ `RELAY_DISABLED` | ✓ | ✗ `RELAY_DISABLED` | ✓ | ✓ |
| test | ✗ | ✗ `RELAY_LOCKED` | ✓ | ✓ | ✓ | ✓ | ✓ |
| patch metadata | ✗ | ✓ (không được đặt `enabled=true`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| patch `enabled=true` | ✗ | ✗ `RELAY_LOCKED` | ✗ `RESOURCE_PAUSED` | ↺ | ✓ | ✓ | — |
| delete | ↺ 404 | ✗ `RELAY_LOCKED` | ✓ (khi E=0) | ✗ `RELAY_ENABLED` | ✓ khi không pending/online | ✗ `RELAY_PENDING` | ✗ `RELAY_ONLINE` |
| enable/disable/lock/unlock/delete key khác | bulk trả `skipped` cho mọi ô ✗, `updated` cho ô ✓/↺ | | | | | | |

Bổ sung:

- `lock` chỉ hợp lệ khi job đã tắt; nếu runtime còn `connecting/streaming` →
  `RELAY_ONLINE` (chờ tối đa một chu kỳ poll rồi thử lại).
- `delete` kiểm tra lần lượt: `D` → 404; `L` → `RELAY_LOCKED`; `E` →
  `RELAY_ENABLED`; `A < V` → `RELAY_PENDING`; `R ∈ {connecting,streaming}` →
  `RELAY_ONLINE`.
- Khi xóa thành công: giữ nguyên `paused_*` trong bản ghi tombstone để audit.

### 4.4. Mã lỗi

| HTTP | Mã | Khi nào |
|---|---|---|
| 409 | `RELAY_LOCKED` | Thao tác cần mở khóa trước |
| 409 | `RELAY_ENABLED` | Khóa/xóa khi job đang bật |
| 409 | `RELAY_DISABLED` | Restart khi job đang tắt |
| 409 | `RELAY_UNLOCKED` | Unlock khi job không khóa |
| 409 | `RELAY_PENDING` | Cấu hình trước chưa áp dụng xong |
| 409 | `RELAY_ONLINE` | Xóa/khóa khi runtime còn kết nối |
| 409 | `RESOURCE_PAUSED` | Enable khi nguồn đang tắt |

Ghi chú: `RELAY_ENABLED` đổi từ 400 → 409 cho thống nhất (Q10-4). UI không phụ
thuộc mã; test hiện có không assert mã này.

## 5. Kiến trúc và luồng

### 5.1. Thư viện trạng thái dùng chung (Node)

`server/src/lib/relayState.ts`:

- `deriveRelayState(input)` → `{ state, label, badge, canEdit, canDelete, ... }`.
- `assertTransition(state, action)` → ném `ApiError` đúng mã mục 4.4.
- `allowedBulkTargets(rows, action)` → lọc như trạm, dùng cho cả API và UI
  (UI nhận cờ `allowedActions` từ server trong response list để không lặp logic).

Dùng ở: `POST /:id/{enable,disable,lock,unlock,restart,test}`, `PATCH /:id`,
`DELETE /:id`, `POST /bulk`, `POST /import`.

### 5.2. Reconcile đồng bộ có thời hạn

- Đổi `requestReconcile(id)` thành `reconcileJobs(ids, { timeoutMs = 2500 })`
  trả `{ ok, error }`.
- Endpoint trạng thái trả thêm `reconcile: 'ok' | 'pending' | 'failed'`:
  - `ok`: gọi Go thành công.
  - `pending`: Go nhận nhưng chưa áp dụng (A < V) — UI hiện banner.
  - `failed`: gọi lỗi — vẫn giữ thay đổi DB, UI cảnh báo “sẽ tự đồng bộ ≤10s”.
- Delete trả 204 như hiện tại (đã chắc chắn job dừng trước đó).

### 5.3. Go — phân biệt “không được chạy” với “đã xóa”

Hiện tại `store.go:127-160` lọc SQL `j.locked = 0` và điều kiện trạm, nên job bị
khóa/bị trạm tắt bị coi là **không tồn tại** → `manager.go:143-152` đóng phiên
lý do `deleted` và ghi `stopped/deleted`.

Kế hoạch:

1. `jobColumns` thêm `j.deleted_at`, `j.locked`, `s.enabled`, `s.status`.
2. `JobConfig` thêm `Locked bool`, `Deleted bool`; `Enabled` tính trong Go:
   `enabled && !locked && (không có trạm nguồn || (station.enabled && station.status <> 'locked'))`.
3. `LoadAll`/`LoadJob` chỉ lọc `deleted_at IS NULL` (bỏ `locked = 0` và điều
   kiện trạm khỏi WHERE); việc quyết định chạy hay không nằm ở `Enabled`.
4. `Reconcile`: `!cfg.Enabled` → `job.stop("disabled")` + writer `disabled`
   (lý do `disabled`, không phải `deleted`); chỉ khi row thực sự không còn →
   `deleted`.
5. Thêm test:
   - `TestLockedJobStopsWithDisabledReason`
   - `TestStationLockedStopsRelayWithDisabledReason`
   - `TestLockedEnabledRowNeverStreams` (phòng thủ nếu DB sai bất biến).

### 5.4. Tương tác trạm ↔ relay

`server/src/lib/stationStream.ts`:

- `resumeResources` thêm `AND locked = 0` để không tự bật job đã khóa khi trạm
  bật lại.
- `pauseResources` giữ nguyên (chỉ tác động job chưa bị pause).
- `setEnabled` (Node) bỏ việc xóa `paused_*` khi **disable**; chỉ `enable` mới
  xóa (và enable đã bị chặn nếu đang paused, nên nhánh xóa chỉ chạy khi nguồn
  đã sẵn sàng).
- `lock`/`unlock` không đụng `paused_*` (Q10-6).

## 6. Dữ liệu / migration

`db/migrations/admin/035_relay_state_invariants.sql`:

```sql
UPDATE relay_jobs SET enabled = 0 WHERE locked = 1 AND enabled = 1;
UPDATE relay_jobs SET enabled = 0 WHERE deleted_at IS NOT NULL AND enabled = 1;

ALTER TABLE relay_jobs
  ADD CONSTRAINT chk_relay_locked_disabled CHECK (locked = 0 OR enabled = 0),
  ADD CONSTRAINT chk_relay_deleted_disabled CHECK (deleted_at IS NULL OR enabled = 0);
```

- Kiểm tra phiên bản MySQL hỗ trợ CHECK (>= 8.0.16; image `mysql:8.0` đạt).
- Dữ liệu hiện tại: 185 relay job, 0 vi phạm → backfill là no-op trên dev.
- Không thêm cột, không đổi enum, không đụng `cors_runtime`.

## 7. Thay đổi API

| Endpoint | Trước | Sau |
|---|---|---|
| `POST /:id/lock` | 400 khi bật; xóa pause | 409 `RELAY_ENABLED`; 409 `RELAY_PENDING`/`RELAY_ONLINE`; giữ pause |
| `POST /:id/unlock` | luôn chạy | ↺ nếu không khóa; giữ pause |
| `POST /:id/enable` | 409 khóa/paused | giữ; thêm `canEdit` |
| `POST /:id/disable` | 409 khóa | giữ; ↺ nếu đã tắt |
| `POST /:id/restart` | luôn chạy | 409 `RELAY_LOCKED`/`RELAY_DISABLED` |
| `POST /:id/test` | luôn chạy | 409 `RELAY_LOCKED` |
| `PATCH /:id` | bật được job khóa | 409 `RELAY_LOCKED` nếu `enabled=true` khi khóa; metadata vẫn sửa được |
| `DELETE /:id` | luôn chạy | 409 theo mục 4.3; 204 khi hợp lệ |
| `POST /bulk` | delete bỏ qua luật | dùng `allowedBulkTargets`; `skipped` cho ô ✗ |
| `POST /import` | ghi đè enabled | job đang khóa → ép `enabled=0`, báo trong `errors`/`skipped` |

Response hành động:

```json
{
  "item": { "...": "..." },
  "reconcile": "ok"
}
```

`GET /api/relay-jobs` bổ sung mỗi item: `state: 'locked'|'paused'|'disabled'|'pending'|'online'|'no_data'|'offline'`,
`allowedActions: ['enable','disable','lock','restart','test','delete']` để UI
không tự suy luận sai.

## 8. Thay đổi frontend

1. `relayJobs.ts` (list/detail): `relayStreamStatus` trả `offline` khi `locked`
   (bỏ `null`); tính `state` theo mục 4.2; trả `allowedActions`.
2. `RelayJobs.tsx`:
   - Thêm nút **Khóa/Mở khóa** từng dòng (`Lock`, `LockOpen`).
   - Disable nút theo `allowedActions`, kèm `title` lý do.
   - Nút xóa disabled khi `enabled/locked/pending/online`; tooltip hướng dẫn.
   - Bulk bar lọc target theo trạng thái như `Stations.tsx:612-620`.
   - Badge: locked → `offline`; thêm nhãn `paused`/`pending`.
   - Sau thao tác: invalidate `['relay-jobs']` + `['relay-status']`; nếu
     `reconcile !== 'ok'` hiện toast cảnh báo.
   - Dòng phụ hiển thị `runtime_state` thật + `x/y` revision (đã có) và nhãn
     “đang áp dụng” khi pending.
3. `frontend/src/types.ts`: mở rộng `RelayStreamStatus` giữ nguyên
   (`null` chỉ dùng khi chưa tải), thêm `relayState` + `allowedActions`.

## 9. Kế hoạch theo bước

| Bước | Nội dung | Nghiệm thu |
|---|---|---|
| P10-0 | Baseline: chạy `server npm test`, `go test ./internal/relay`, ghi lại số hiện tại; xác nhận không có job vi phạm | Có bằng chứng baseline |
| P10-1 | `relayState.ts` + unit test ma trận (mục 4.3) | 100% ô có test, PASS |
| P10-2 | Áp guard vào single/bulk/PATCH/import; trả `reconcile` + `allowedActions` | Integration/unit PASS; không còn đường bật job khóa |
| P10-3 | Go: store + JobConfig + Reconcile + test | `go test ./...` PASS; locked → `disabled` |
| P10-4 | Migration 035 + kiểm tra MySQL | Migrate PASS; 0 vi phạm |
| P10-5 | Frontend: badge, nút từng dòng, bulk target, tooltip | `npm run build` PASS |
| P10-6 | E2E `relay-state.spec.ts`, regression, docs (chương 07 guide + SESSION) | E2E PASS; tài liệu cập nhật |

Ước lượng: **4.5 ngày công** (P10-1 1.0 · P10-2 1.0 · P10-3 1.0 · P10-4 0.25 ·
P10-5 0.75 · P10-6 0.5).

## 10. Test matrix

| # | Loại | Nội dung |
|---|---|---|
| R1 | Unit | Bảng 4.3: mọi ô ✗/✓/↺, đúng mã lỗi |
| R2 | Unit | `deriveRelayState` ưu tiên D > L > P > E=0 > pending > runtime |
| R3 | Integration | `DELETE` khi bật/khóa/pending/online → 409; sau disable → 204 |
| R4 | Integration | `PATCH enabled=true` khi khóa → 409; metadata khi khóa → 200 |
| R5 | Integration | Bulk mixed: `updated/skipped/forbidden/notFound` đúng |
| R6 | Integration | Import vào job khóa → `enabled` giữ 0, có cảnh báo |
| R7 | Go | locked → `runtime_state=disabled`, close reason `disabled` |
| R8 | Go | trạm nguồn tắt/khóa → relay `disabled`, không `deleted` |
| R9 | Go | row `locked=1&enabled=1` (dữ liệu sai) không bao giờ stream |
| R10 | E2E | Khóa → badge `offline`, nút xóa disabled |
| R11 | E2E | Xóa khi đang bật → toast lỗi; tắt → khóa → mở khóa → xóa được |
| R12 | E2E | Bulk chọn 3 job trạng thái khác nhau → đúng số updated/skipped |
| R13 | Regression | `guide.spec.ts` 8/8, `navigation.spec.ts` 1/1, server suite không giảm |

## 11. File / khu vực dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `server/src/lib/relayState.ts` | Mới |
| `server/tests/relayState.test.ts` | Mới |
| `server/src/routes/relayJobs.ts` | Guard + reconcile + allowedActions |
| `server/src/lib/stationStream.ts` | `locked = 0` khi resume; giữ pause |
| `gnss/internal/relay/store.go` | Bỏ lọc locked, thêm cột, tính Enabled |
| `gnss/internal/relay/types.go` | `Locked`, `Deleted` |
| `gnss/internal/relay/manager.go` | Lý do `disabled` |
| `gnss/internal/relay/manager_test.go` | Test mới |
| `db/migrations/admin/035_relay_state_invariants.sql` | CHECK + backfill |
| `frontend/src/pages/RelayJobs.tsx` | Nút/khóa, bulk target, badge |
| `frontend/src/types.ts` | `relayState`, `allowedActions` |
| `frontend/tests/relay-state.spec.ts` | Mới |
| `docs-site/docs/07-relay.md` | Bổ sung ma trận cho người dùng |
| `docs/1/10_...md`, `TASKS.md`, `SESSION.md` | Nhật ký |

## 12. Rủi ro và cách xử lý

| Rủi ro | Mức | Xử lý |
|---|---|---|
| Đổi 400 → 409 `RELAY_ENABLED` | Thấp | Không test nào phụ thuộc; ghi trong changelog |
| CHECK constraint trên DB production có dữ liệu sai | TB | Backfill trước khi ALTER; chạy `SELECT` kiểm tra trong migration |
| Go đổi cách tính `Enabled` ảnh hưởng job đang chạy | TB | Không đổi điều kiện chạy thực tế, chỉ đổi **lý do** dừng; test R7–R9 |
| Thêm `locked = 0` vào resume có thể bỏ auto-resume job vừa mở khóa | Thấp | Sau unlock, job vẫn disabled; enable thủ công hoặc chu kỳ trạm sau |
| Reconcile timeout làm thao tác chậm | TB | Timeout 2.5s, không chặn DB; trả `pending` |
| Poll 10s vẫn là giới hạn runtime | Thấp | UI phản ánh ý định ngay; ghi rõ trong tài liệu |

## 13. Rollback

1. Revert migration 035 bằng migration mới (drop CHECK) — không xóa dữ liệu.
2. Revert code Node/Go theo commit từng bước (P10-1..P10-5 độc lập).
3. UI có thể giữ nút khóa từng dòng (không hại) nhưng phải revert guard nếu
   rollback API.
4. Kiểm tra lại: `server npm test`, `go test ./...`, E2E relay cũ.

## 14. Definition of Done

1. Bảng 4.3 được thi hành ở single, bulk, patch, import; test R1–R6 PASS.
2. Go test R7–R9 PASS; không còn close reason `deleted` cho job bị khóa/tắt.
3. Migration 035 chạy sạch trên dev + kiểm tra 0 vi phạm.
4. E2E R10–R12 PASS; regression R13 không giảm.
5. Tài liệu: chương 07 guide có ma trận ngắn; `TASKS.md`/`SESSION.md` cập nhật.

## 15. Việc để sau

- Hiển thị timeline trạng thái relay theo ma trận (đã có timeline chất lượng).
- Tự động disable job khi online quá lâu không dữ liệu (chính sách, không tự ý).
- Nút “Dừng và xóa” một bước (auto-stop) nếu người dùng cần; khi đó phải chờ
  runtime dừng thay vì từ chối.
- Đồng bộ mã lỗi 400/409 giữa trạm và relay trong một đợt riêng.

## 16. Nhật ký thực hiện

### P10-0 — Baseline & chốt kế hoạch (2026-11-02 09:38 +07:00)

- Việc: thêm kế hoạch 10 vào `TASKS.md` mục 9.4; ghi baseline; không sửa mã nguồn.
- Lệnh: `server npm test`; `server npm run build`; `gnss go test ./...`; `gnss go vet ./...`; `frontend npm run build`.
- Kết quả: PASS — server **102/102** (16 file), server build PASS, Go test/vet PASS,
  frontend build PASS.
- File: `docs/1/10_KE_HOACH_MA_TRAN_TRANG_THAI_RELAY.md`, `TASKS.md`, `SESSION.md`.
- Sai lệch: không. Các lỗi test phiên trước đã được người dùng xử lý trước baseline.

### P10-1 — Thư viện ma trận trạng thái (2026-11-02 09:42 +07:00)

- Việc: tạo `server/src/lib/relayState.ts` (`deriveRelayState`, `assertTransition`,
  `isIdempotent`, `allowedActions`, `isPending`, `isRuntimeLive`) và test thuần
  phủ 8 trạng thái × 8 hành động.
- Lệnh: `npx vitest run tests/relayState.test.ts`; `npm run build`; `npm test`.
- Kết quả: PASS — relayState **12/12**; toàn server **114/114** (17 file), build PASS.
- File: `server/src/lib/relayState.ts`, `server/tests/relayState.test.ts`.
- Sai lệch: (1) `assertTransition` nhận **input** thay vì chỉ `state` để kiểm tra
  chính xác `enabled`/`pending`/runtime; (2) `unlock` khi không khóa là **idempotent**
  (không ném `RELAY_UNLOCKED`) theo bước P10-2; mã `RELAY_UNLOCKED` giữ cho bulk báo
  `skipped`; (3) `allowedActions` loại các hành động idempotent để UI không hiện nút
  vô nghĩa; (4) thứ tự kiểm tra `lock`/`delete`: pending trước enabled.

### P10-2 — Áp ma trận vào API relay (2026-11-02 09:51 +07:00)

- Việc: guard single/bulk/PATCH/import qua `relayState`; `requestReconcile` trả
  `ok|pending|failed` (timeout 2.5s); `DELETE` chặn bật/khóa/pending/online;
  `PATCH` chặn `enabled=true` khi khóa; `lock` không xóa `paused_*`; `disable`
  không xóa pause; bulk dùng chung luật; import ép `enabled=0` cho job khóa và
  trả `warnings`; list/detail trả `relayState`, `relayStateLabel`,
  `allowedActions`; `relayStreamStatus` trả `offline` khi khóa;
  `stationStream.resume` thêm `locked = 0`.
- Lệnh: `npm run build`; `npm test`; kiểm tra API thật bằng script tạm (không commit).
- Kết quả: PASS — server **116/116**; API: list có `relayState`/`allowedActions`;
  xóa khi bật → `RELAY_ENABLED`; lock job tắt → 200; PATCH `enabled=true` khi khóa
  → `RELAY_LOCKED`; PATCH metadata khi khóa → 200; bulk delete 3 job (bật/khóa/tắt)
  → `updated=1`, `skipped=2`; xóa hợp lệ → 204; dọn sạch job test.
- File: `server/src/routes/relayJobs.ts`, `server/src/lib/relayState.ts`,
  `server/src/lib/stationStream.ts`, `server/tests/relayState.test.ts`.
- Sai lệch: (1) `isPending` chỉ đúng khi **đã có** `applied_revision`; job mới chưa
  áp dụng không bị coi là pending để không chặn khóa/xóa; (2) `lock`/`delete` kiểm
  tra `enabled` trước `pending` (ưu tiên thông báo “phải tắt”); (3) import trả
  `warnings` thay vì đưa vào `errors` (errors>0 sẽ hủy cả batch); (4) phải
  `docker compose restart server` sau build vì `node --watch` không tự nạp `dist`.

### P10-3 — Go phân biệt disabled và deleted (2026-11-02 09:54 +07:00)

- Việc: `store.go` chọn thêm `deleted_at`, `locked`, trạng thái trạm nguồn và chỉ
  lọc `deleted_at IS NULL`; `types.go` thêm `ConfigEnabled/Locked/Deleted/StationBlocked`
  và hàm `computeEnabled`; `Enabled` được tính trong Go thay vì lọc SQL. Nhờ đó job
  bị khóa hoặc bị trạm nguồn tắt được nạp với `Enabled=false` → `disabled`, không
  còn bị coi là “không tồn tại” rồi đóng phiên với lý do `deleted`.
- Test mới: `TestComputeEnabledHonoursLockAndStation`,
  `TestLockedJobStopsWithDisabledReason`, `TestStationLockedStopsRelayWithDisabledReason`,
  `TestLockedEnabledRowNeverStreams`.
- Lệnh: `gofmt -w`; `go test ./internal/relay/...`; `go test ./...`; `go vet ./...`.
- Kết quả: PASS — toàn bộ Go test PASS, vet sạch; test locked/station-blocked xác nhận
  phiên đóng với `disabled`, không có `deleted`, và row `locked=1&enabled=1` không stream.
- File: `gnss/internal/relay/store.go`, `types.go`, `manager_test.go`.
- Sai lệch: không. E2E dùng binary mới cần `docker compose up -d --build gnss` ở P10-6.

### P10-4 — Migration 035 ràng buộc bất biến (2026-11-02 09:56 +07:00)

- Việc: tạo `035_relay_state_invariants.sql` (backfill `enabled=0` cho row khóa/đã
  xóa, thêm 2 CHECK `chk_relay_locked_disabled`, `chk_relay_deleted_disabled`).
- Lệnh: `docker compose build migrate`; `docker compose run --rm migrate`; kiểm tra
  `schema_migrations`, vi phạm, constraint, phiên bản MySQL.
- Kết quả: PASS — `admin 035_relay_state_invariants.sql applied` (admin=1);
  `schema_migrations` có version **35**; vi phạm **0**; 2 CHECK tồn tại; MySQL **8.0.46**
  (CHECK được thực thi).
- File: `db/migrations/admin/035_relay_state_invariants.sql`.
- Sai lệch: migrations được **bake vào image** của service `migrate` (không mount
  volume) nên phải `docker compose build migrate` trước khi chạy; ghi vào README ở P10-6.
