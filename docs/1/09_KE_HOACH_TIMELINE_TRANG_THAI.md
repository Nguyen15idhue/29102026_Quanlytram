# 09 — KẾ HOẠCH TIMELINE TRẠNG THÁI ONLINE/OFFLINE/NO_DATA

> Ngày lập: 2026-11-02
> Trạng thái: **KẾ HOẠCH — chưa triển khai**
> Phạm vi: timeline trạng thái ở tab **Dữ liệu** của trạm và relay job,
> API timeline, cách ghi nhận dữ liệu/service lifecycle, UI timeline,
> test và tiêu chí nghiệm thu.
> Nguyên tắc: một nguồn sự thật duy nhất cho trạng thái; cùng một thời điểm
> phải cho cùng kết quả ở cả 4 khung 1h/24h/7d/30d; không đổi stack.
> Tham chiếu: `AGENTS.md`, `docs/0/RTCM_QUALITY_PLAN.md`,
> `docs/0/UI_UX_PLAN.md`, `docs/1/08_KE_HOACH_TRANG_HUONG_DAN.md`.

## 1. Kết luận rà soát hiện trạng

### 1.1. Hành vi đang sai

Cùng một khoảng thời gian nhưng mỗi khung ra một kết quả khác nhau:

| Khung | Hiển thị hiện tại | Thực tế |
|---|---|---|
| 1 giờ | 58m30s `no_data`, 1m30s `online`, 0s `offline` | Hệ thống đã tắt trong khoảng này → phải `offline` |
| 24 giờ | 19h04m `online`, 29m50s `offline`, 20s `no_data` | Đoạn qua đêm 23:37 → 08:21 bị tính `online` |
| 7 ngày / 30 ngày | Cùng số liệu 24h; đoạn 23:37 → 08:21 `online 8h44m` | Sai; qua đêm hệ thống đã dừng |
| Trước khi tạo | Thanh timeline như bắt đầu từ lúc có dữ liệu | `none` bị trong suốt, gần như mất khỏi thanh |

### 1.2. Bằng chứng dữ liệu

Ca thực tế ngày 02/11 (giờ UTC, +07 = giờ VN):

- Sample cuối trước khi dừng: `2026-11-01 17:23:15Z` = **00:23:15 ngày 02/11**.
- Session `station_source_sessions` id 53:
  - `start_ts = 2026-11-01 16:36:55Z`
  - `end_ts = 2026-11-02 01:17:14Z`
  - `close_reason = service_restart`
- Sample đầu sau khi chạy lại: `2026-11-02 01:18:14Z` = **08:18:14 ngày 02/11**.
- Khoảng trống thực tế: **00:23 → 08:18 (~7h55m)**, nhưng session lại ghi
  “đang kết nối” gần như suốt khoảng này.

### 1.3. Nguyên nhân gốc

1. **Session đóng sai thời điểm.** `station_source_sessions.CloseOpen` chạy lúc
   service khởi động lại và ghi `end_ts = thời điểm restart`, không phải thời
   điểm mất kết nối thực
   (`gnss/internal/relay/station_source.go:98-104`).
2. **Trạng thái phụ thuộc cửa sổ đang xem.** API chỉ nạp sample trong
   `[rangeFrom, now]`. Khung 1h không còn sample trước lúc tắt nên rơi vào
   nhánh “đang kết nối, không có dữ liệu” → `no_data`; khung 24h/7d/30d có
   sample cả hai phía nên nội suy nối thành `online`.
3. **Nối sample không giới hạn khoảng cách.** `streamingAt()` coi sample
   `streaming` cuối trước khi tắt và sample `streaming` đầu sau khi chạy lại là
   một dòng liên tục, dù cách nhau gần 8 giờ
   (`server/src/lib/statusTimeline.ts:148-160`).
4. **`no_data` bị dùng để lấp downtime.** Khi không có sample mà session còn
   mở, `no_data` được giữ vô hạn thay vì `offline` vì không có kết nối thật.
5. **`none` bị ẩn.** CSS `.timeline-segment.none { background: transparent; }`
   (`frontend/src/styles.css:3628-3630`) làm đoạn trước khi tạo không nhìn thấy;
   thanh timeline lại chuẩn hoá theo các segment được trả về.

### 1.4. Mã nguồn liên quan

| Khu vực | File |
|---|---|
| Trạng thái timeline | `server/src/lib/statusTimeline.ts` |
| API trạm | `server/src/routes/stations.ts` (`/:id/timeline`) |
| API relay | `server/src/routes/relayJobs.ts` (`/:id/timeline`) |
| Trạng thái live trạm | `server/src/lib/stationDetail.ts` |
| Ghi session nguồn trạm | `gnss/internal/relay/station_source.go` |
| Sample chất lượng | `gnss/internal/quality/analyzer.go` (`emitSamples`) |
| UI timeline | `frontend/src/components/EntityTimeline.tsx`, `frontend/src/styles.css` |
| Type API | `frontend/src/types.ts` |

### 1.5. Thay đổi WIP từ lần trước

Đã có trong working tree, cần gộp vào kế hoạch này thay vì giữ như một bản vá
dở dang:

- Giữ: `segments`, bucket lấy trạng thái chiếm phần lớn thời gian, đọc lùi
  sample trước `rangeFrom`, trả `resolutionSec`.
- Làm lại: định nghĩa `no_data` theo số gói tin, bỏ nối sample quá xa, thêm
  service lifecycle, hiển thị `none`, reason offline.
- Không đưa vào phạm vi: các thay đổi không liên quan đang có trong working tree
  (`Dashboard`, `ops.ts`, `dashboard.spec.ts`, ...).

## 2. Quyết định đã chốt

| # | Quyết định |
|---|---|
| 1 | `no_data`: kết nối còn sống nhưng **không có dữ liệu** hoặc **dữ liệu ít hơn `xx` gói tin** |
| 2 | `offline`: **không có kết nối**, **service dừng**, hoặc **trạm/job bị tắt/khoá** |
| 3 | Phân biệt `system_down` (Go/Node/MySQL dừng) với `source_lost` (mất nguồn/mất mạng/thiết bị lỗi) |
| 4 | Giữ khung rolling `now−1h/24h/7d/30d`; `1 tháng` = **30 ngày**, nhãn UI “30 ngày” |
| 5 | Tỷ lệ online giữ công thức hiện tại, tính riêng cho từng khung |
| 6 | Ngưỡng nối sample streaming ≤ **2 phút** |
| 7 | Không marker restart trên timeline; chỉ ghi log |
| 8 | `none` (trước khi tạo) phải hiển thị ở **mọi khung** nếu `createdAt` nằm trong khung |

### 2.1. Giá trị `xx`

- Tên cấu hình: `timeline.minFramesPerWindow`.
- Đơn vị: **số frame RTCM trong một cửa sổ sample 60 giây**
  (`quality_samples.frames`, `window_sec = 60`).
- Giá trị đề xuất mặc định: **10 frame/60 giây**.
- Lưu ở `settings` phía Node (admin), cho phép chỉnh không cần build lại.
- Có thể mở rộng override theo `target_type` (station/relay) và `direction`
  (upstream/downstream/ingest); giai đoạn đầu dùng một giá trị chung.
- Giá trị cuối cùng sẽ chốt ở Phase 1 sau khi đo phân bố frame thực tế của các
  mountpoint đang vận hành.

## 3. Định nghĩa trạng thái và quy tắc nền

### 3.1. Trạng thái tại thời điểm `t`

Thứ tự ưu tiên:

1. `t < createdAt` → `none`.
2. Trạm/job bị tắt hoặc khoá tại thời điểm hiện tại → `offline`
   (lịch sử trước đó vẫn tính theo dữ liệu).
3. `t` nằm trong khoảng `system_down` → `offline` (reason `system_down`).
4. Không có kết nối tại `t` → `offline` (reason `source_lost`/`disabled`).
5. Có kết nối tại `t`:
   - số frame trong cửa sổ 60 giây kết thúc tại `t` **≥ `xx`** → `online`.
   - số frame **< `xx`** (kể cả 0) → `no_data`.

`no_data` **không còn giới hạn 10 giây**. Nó tồn tại chừng nào kết nối còn sống
nhưng dữ liệu chưa đạt ngưỡng. Khi mất kết nối, chuyển ngay `offline`.

### 3.2. Nguồn sự thật

1. **Kết nối**: session interval + trạng thái runtime, nhưng bị vô hiệu trong
   khoảng `system_down`.
2. **Dữ liệu**: `quality_samples.frames` (cửa sổ 60 giây) và `age_ms` để xác
   định độ tươi; live dùng snapshot RAM của Go.
3. **Service lifecycle**: bảng `service_runs` để biết Go/MySQL đã dừng và
   khoảng downtime.
4. Không dùng `end_ts` ghi lúc restart làm mốc ngắt thật.

### 3.3. Quy tắc nối sample

- Hai sample `streaming` liên tiếp chỉ nối `online` nếu khoảng cách ≤ **120
  giây**.
- Khoảng cách lớn hơn: không nối; trạng thái giữa hai sample do kết nối và
  service lifecycle quyết định.
- Nếu không có sample trước `t` nhưng kết nối mới bắt đầu < 60 giây → `no_data`
  (chưa đủ cửa sổ đo); quá 60 giây không có frame → `no_data` nếu còn kết nối.

### 3.4. Khung thời gian

- `asOf` = thời điểm server xử lý request.
- `rangeFrom = asOf − 1h/24h/7d/30d`; `to = asOf` (hoặc `deletedAt`).
- `1m` = 30 ngày; nhãn UI “30 ngày”.
- Segment/bucket phủ kín `[rangeFrom, to]`, không chồng lấn.
- `none` bắt buộc có trong `segments` nếu `createdAt > rangeFrom`.
- `none` phải hiển thị được (nền xám, có trong legend và danh sách).
- Tổng `none + online + offline + no_data` = độ dài khung (sai số ≤ 1 giây).

### 3.5. Tỷ lệ online

Giữ công thức hiện tại, tính riêng cho từng khung:

`uptimePct = onlineSec / (onlineSec + offlineSec + noDataSec)`

`none` hiển thị riêng, không vào mẫu số.

### 3.6. Phân biệt lý do offline

Trạng thái vẫn chỉ có 4 giá trị; lý do là trường phụ `offlineReason`:

| Reason | Khi nào |
|---|---|
| `system_down` | Go/MySQL dừng, gap heartbeat/service run |
| `source_network` | lỗi mạng, timeout, EOF từ `classify()` |
| `source_silent` | nguồn im lặng, không phân biệt được mất điện hay mất mạng |
| `source_auth` | sai xác thực |
| `disabled` | trạm/job tắt hoặc khoá |

Không thể phân biệt tuyệt đối “mất điện” với “mất mạng” nếu không có tín hiệu
ngoài band; nhóm chung `source_lost`, sub-reason ghi log.

## 4. Thiết kế kỹ thuật

### 4.1. Status engine dùng chung

Một hàm `statusAt(t)` cho cả 4 khung và badge live, không phụ thuộc cửa sổ:

```text
statusAt(t):
  if t < createdAt: return none
  if disabledAtQueryTime: return offline(disabled)     // chỉ current
  if systemDown(t): return offline(system_down)
  if not connectedAt(t): return offline(source_lost)
  frames = framesInWindow(t, 60s)
  if frames >= xx: return online
  return no_data
```

- `statusAt(t)` **không** dùng dữ liệu ngoài `t`.
- API nạp sample lùi 120 giây trước `rangeFrom` để nội suy đúng biên.
- Cùng `t` phải trả cùng kết quả với mọi `bucketSec`/`resolutionSec`.

### 4.2. `framesInWindow(t, 60s)`

- `quality_samples.frames` là số frame trong `window_sec` (mặc định 60 giây)
  của sample gần nhất phủ `t`.
- Nếu không có sample phủ `t`: lấy sample gần nhất trước `t` và chỉ dùng nếu
  `t - sample.ts <= window_sec`; ngược lại `frames = 0`.
- Live: bổ sung `framesRecent` vào snapshot Go (tính từ `targetState.recent`)
  để badge không phụ thuộc sample 1 phút.

### 4.3. Service lifecycle

Migration runtime mới (`007_service_runs.sql` hoặc số kế tiếp):

```sql
service_runs(
  id, service, started_at, last_seen_at, stopped_at, stop_reason
)
```

- Go cập nhật `last_seen_at` mỗi 15 giây.
- Khi start: đóng run cũ tại `last_seen_at`, mở run mới.
- Khi graceful stop: ghi `stopped_at`, `stop_reason = service_stop`.
- Khoảng `last_seen_at` cũ → `started_at` mới = `system_down`.
- Nếu trong khoảng đó vẫn có sample → không gán `system_down`, ưu tiên dữ liệu.
- Retention theo `maintenance` (mặc định 90 ngày).

### 4.4. Hợp đồng API

Response timeline (station và relay):

```text
asOf, rangeFrom, to, range, resolutionSec, bucketSec
buckets[]                      // trạng thái chiếm phần lớn thời gian
segments[]                     // đầy đủ, gồm none, cắt đúng biên khung
onlineSec, offlineSec, noDataSec, noneSec, totalSec, uptimePct
current, currentReason
offlineReasons?                // reason -> giây
```

- `segments` là nguồn cho thanh bar và danh sách.
- `none` luôn có nếu `createdAt > rangeFrom`.
- `resolutionSec` hiển thị ở footer.
- `asOf` hiển thị/chia sẻ giữa 4 khung để tránh lệch vài giây.

### 4.5. UI

- `EntityTimeline` dùng `segments`; thanh bar chuẩn hoá theo toàn bộ khung.
- `.timeline-segment.none` đổi sang xám (`--timeline-none` hoặc
  `--border-strong`), đảm bảo tương phản AA cả light/dark.
- Danh sách segment hiển thị cả `none`.
- Dòng offline hiển thị thêm reason dạng text nhỏ (không thêm marker band).
- Footer hiển thị `resolutionSec` và `asOf`.
- Giữ 4 tab và bố cục hiện tại.

## 5. Kế hoạch triển khai

### Phase 0 — Baseline và tái hiện (0.5 ngày)

- Chốt working tree, gộp WIP timeline, loại các thay đổi không liên quan.
- Xác nhận server/frontend chạy đúng bản build mới (tránh stale `dist` trên
  bind mount; kiểm tra API có `segments`).
- Viết script so sánh trạng thái tại cùng thời điểm giữa 4 khung.
- Tái hiện ca 00:23 → 08:18 bằng fixture/log.
- **DoD:** có bằng chứng lỗi trước khi sửa; baseline test PASS.

### Phase 1 — Status engine và định nghĩa mới (1–1.5 ngày)

- Viết lại `statusAt(t)` theo mục 3.1, 3.3.
- Thêm `framesInWindow` và cấu hình `timeline.minFramesPerWindow` (mặc định 10).
- Bỏ nối sample quá 120 giây.
- Bỏ nhánh `no_data` vô hạn khi không có sample.
- API trạm/relay nạp đủ ngữ cảnh, dùng chung `asOf`.
- Đồng bộ `stationDetail.transportStatusFor` với định nghĩa mới.
- **Files:** `statusTimeline.ts`, `stations.ts`, `relayJobs.ts`,
  `stationDetail.ts`, `settings` schema/seed.
- **DoD:** cùng `t` cho cùng status ở 4 khung; unit test gap/downtime PASS.

### Phase 2 — Service lifecycle và reason (1–2 ngày)

- Migration `service_runs`; cập nhật kiểm tra schema runtime của Go.
- Go: heartbeat, start/stop, log downtime; retention.
- Map `close_reason` của session sang reason nguồn.
- `system_down` ưu tiên hơn `source_lost`; nếu có sample trong gap thì không
  gán `system_down`.
- Log `service start/stop` kèm downtime; không marker UI.
- **Files:** migration runtime, `gnss/cmd/corsd/main.go`,
  `gnss/internal/quality` hoặc package lifecycle mới, `statusTimeline.ts`.
- **DoD:** dừng Go/MySQL rồi chạy lại → gap `offline` reason `system_down`;
  dừng nguồn/thiết bị → `offline` reason `source_*`; 4 khung khớp nhau.

### Phase 3 — API contract (0.5 ngày)

- Trả `asOf`, `segments` đầy đủ, `currentReason`, `resolutionSec`.
- `none` bắt buộc; tổng thời lượng = độ dài khung.
- `1m` = 30 ngày; nhãn UI “30 ngày”.
- Test contract: schema response, tổng, biên khung.
- **DoD:** API đủ dữ liệu cho UI, không còn phụ thuộc `buckets` cũ.

### Phase 4 — UI (1 ngày)

- `EntityTimeline`: dùng `segments`, bar full window, danh sách có `none`.
- `styles.css`: `none` hiển thị rõ, dark mode AA.
- Tooltip/dòng offline hiển thị reason.
- Footer `resolutionSec` + `asOf`.
- Playwright: switch 4 khung, kiểm tra `none`, gap shutdown, reason;
  screenshot 1440/768/390.
- **DoD:** 0 FAIL Playwright; không còn “mất khoảng trước khi tạo”.

### Phase 5 — Xác minh và rollout (1 ngày)

- Fixture tái hiện shutdown (T0, T1, T2) cho station và relay.
- Chạy server test/tsc, frontend build, Playwright.
- Manual E2E stop/start container **chỉ khi được xác nhận** (không tự dừng
  dịch vụ thật theo `AGENTS.md`).
- Cập nhật `SESSION.md`, ghi bằng chứng PASS/FAIL.
- **DoD:** checklist mục 8 PASS.

## 6. Test matrix

### Unit

- Hai sample streaming cách 8 giờ → giữa gap không phải `online`.
- Hai sample streaming cách ≤ 2 phút → vẫn `online`.
- Kết nối sống, 0 frame → `no_data`.
- Kết nối sống, frame < xx → `no_data`; frame ≥ xx → `online`.
- Không kết nối → `offline`, kể cả khi còn session cũ.
- `system_down` trong gap → `offline` reason `system_down`.
- `none` trước `createdAt`; tổng status = độ dài khung.
- Cùng `t` trả cùng status với 4 cấu hình bucket/resolution.

### Integration (fixture DB)

- Ca thật: sample cuối 00:23:15, restart 08:17:14, sample đầu 08:18:14.
- 1h/24h/7d/30d đều `offline` trong 00:23 → 08:18 (sai số resolution).
- `system_down` hiển thị đúng reason; bug `online 8h44m` biến mất.
- Trạm tạo giữa khung → `none` xuất hiện ở cả 4 khung.
- Kết nối sống nhưng 0 frame → `no_data` (không `offline`).
- Kết nối sống, frame thấp hơn xx → `no_data`.
- Kết nối sống, frame đạt ngưỡng → `online`.

### E2E / Playwright

- Mở tab Dữ liệu trạm 480, đổi 4 khung.
- Kiểm tra bar có đoạn `none` xám trước 12:47 01/11.
- Kiểm tra đoạn qua đêm là `offline` ở 24h/7d/30d.
- Kiểm tra tooltip reason.
- Ảnh 1440/768/390; 0 console error.

### Manual (khi được phép)

- Dừng Go/MySQL, chờ, chạy lại; kiểm tra 4 khung.
- Chỉ dừng nguồn thiết bị; kiểm tra reason `source_lost` khác `system_down`.

## 7. Tiêu chí nghiệm thu theo ca thực tế

Với T0 = 00:23:15, T1 = 08:17:14, T2 = 08:18:14, now = 08:21:

1. **1 giờ (07:21 → 08:21)**: `offline` ~57 phút, `online` ~3 phút,
   `no_data` chỉ ở biên cửa sổ đo.
2. **24 giờ**: đoạn 00:23 → 08:18 là `offline`; không còn `online 8h44m`.
3. **7 ngày / 30 ngày**: cùng mốc chuyển trạng thái với 24h; khác phần `none`
   ngoài 24h.
4. **Trước khi tạo**: `none` hiển thị xám ở cả 4 khung nếu `createdAt` nằm
   trong khung.
5. **Tổng**: `none + online + offline + no_data` = đúng độ dài khung.
6. **Badge**: lúc 08:21 badge `online`; nếu đang tắt thì badge `offline`.
7. **Log**: có `service start/stop` và downtime; không marker trên timeline.

## 8. Checklist Definition of Done

- [x] `statusAt(t)` độc lập khung; cùng `t` cho cùng status ở 4 khung.
- [x] `no_data` theo định nghĩa mới (`< xx` frame/60s), không còn giới hạn 10s.
- [ ] `offline` chỉ khi không kết nối / service dừng / tắt-khoá.
- [ ] `system_down` và `source_lost` phân biệt được trong reason/log.
- [x] Không nối sample cách nhau > 120 giây.
- [x] Khung `1h/24h/7d/30d` đúng `now−range`, `1m` = 30 ngày.
- [x] `segments` phủ kín khung, gồm `none`, hiển thị được.
- [x] Tổng 4 trạng thái = độ dài khung.
- [x] Tỷ lệ online giữ công thức hiện tại, tính riêng từng khung.
- [ ] Badge live và timeline cùng nguồn.
- [ ] Server test/tsc PASS; frontend build PASS; Playwright PASS.
- [ ] `SESSION.md` cập nhật bằng chứng.

## 9. Rủi ro và câu cần chốt

- **`xx` mặc định:** đề xuất 10 frame/60s; cần xác nhận sau khi đo phân bố
  frame thực tế.
- **MySQL dừng:** Go không ghi được heartbeat; downtime suy ra từ
  `last_seen_at`, có thể lệch vài giây.
- **Mất điện vs mất mạng:** không phân biệt tuyệt đối; nhóm `source_lost`,
  sub-reason ghi log.
- **Độ phân giải 7d/30d:** 60 giây, mốc chuyển trạng thái lệch tối đa 60 giây
  so với 1h/24h.
- **Tỷ lệ online:** kế hoạch giữ công thức hiện tại (loại `none`); nếu muốn
  tính trên toàn khung gồm `none`, cần quyết định lại.

## 10. Tiến độ thực hiện

| Phase | Trạng thái | Ngày | Bằng chứng | Lệnh đã chạy | Ghi chú |
|---|---|---|---|---|---|
| 0 — Baseline | PASS | 2026-11-02 | Script `scripts/verify-timeline.ps1` tái hiện lỗi: 24h/7d/30d `online` tại 00:30 và 04:00 (đang downtime); độ phủ 1h PASS, 24h/7d/30d FAIL (segment 72.371s). Server tsc PASS; vitest 89/90, 1 FAIL `stationDetail.test.ts:19` do WIP đổi semantics. | `npx tsc -p tsconfig.json --noEmit`; `npm test`; `scripts/verify-timeline.ps1 -Kind station -Id 480 ...` | WIP timeline được giữ để làm lại ở Phase 1; không commit các thay đổi không liên quan (`Dashboard`, `ops.ts`, ...). |
| 1 — Status engine | PASS | 2026-11-02 | `statusAt(t)` dùng frame/60s + kết nối; bỏ nối gap >120s; `segments` gồm `none`; 92/92 vitest PASS, tsc PASS. | `npx tsc -p tsconfig.json --noEmit`; `npm test` | Chưa có service downtime (Phase 2) nên gap mất kết nối đang là `no_data`; sẽ chuyển `offline` khi có `service_runs`. |
| 2 — Service lifecycle | Chưa làm |  |  |  |  |
| 3 — API contract | Chưa làm |  |  |  |  |
| 4 — UI | Chưa làm |  |  |  |  |
| 5 — Xác minh | Chưa làm |  |  |  |  |

