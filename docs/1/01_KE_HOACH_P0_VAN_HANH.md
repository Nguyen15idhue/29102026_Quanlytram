# 01 — KẾ HOẠCH P0: TỔ CHỨC LẠI TRẢI NGHIỆM VẬN HÀNH

> Ngày lập: 2026-10-30
> Cập nhật: 2026-10-31 — bổ sung đánh giá sẵn sàng vận hành và kế hoạch
> chuyển đổi từ 2 hệ thống cũ (§19–§23)
> Trạng thái: Đã chốt hướng triển khai; **chưa Go-live thay thế hệ thống cũ**
> Phạm vi: P0 — trước khi bổ sung báo cáo/notification/import-export
> Tài liệu liên quan: `docs/0/PHASES_7_12_PLAN.md`, `docs/0/UI_UX_PLAN.md`,
> `docs/OPS.md`, `TASKS.md`, `SESSION.md`

## 1. Mục tiêu

Chuyển UI từ “hiển thị dữ liệu kỹ thuật” sang “hỗ trợ ra quyết định vận hành”.

P0 phải trả lời được:

1. Trạm đang hoạt động hay mất kết nối?
2. Chất lượng dữ liệu có đáng tin không?
3. Một mountpoint đang liên quan đến trạm, relay, listener và tài khoản nào?
4. Sự cố bắt đầu từ đâu, ảnh hưởng bao nhiêu trạm/tài khoản?
5. VPS, Node, Go, MySQL có đang khỏe không?

## 2. Quyết định đã chốt

| # | Quyết định |
|---|---|
| 1 | Đổi menu theo cấu trúc 7 nhóm; P0 chỉ bật mục đã có route |
| 2 | Chi tiết trạm dùng **route + drawer**: `/stations/:id` |
| 3 | P0 dùng dữ liệu sẵn có; chưa thêm bảng lịch sử kết nối probe |
| 4 | Hợp nhất bản đồ tại `/map`; redirect `/stations/map`, `/online/map` |
| 5 | System Health dùng Node/Go/MySQL + host metrics cơ bản; không Prometheus |
| 6 | Thứ tự P0: trạm → Mountpoint Explorer → bản đồ → System Health → Dashboard → menu |

## 3. Ngoài phạm vi P0

- Import/export NTRIP, mountpoint, relay.
- Notification center, event configuration.
- Log viewer nâng cao, system params, branding/logo.
- Báo cáo hiệu suất/chất lượng theo ngày/tuần/tháng.
- Sky Plot đầy đủ khi nguồn chưa có ephemeris/GSV.
- Phân tích bất thường tự động, so sánh nhiều trạm.
- Prometheus/Grafana, Redis, Kafka, Kubernetes.

## 4. Nguyên tắc dữ liệu

### 4.1. Một nguồn dữ liệu chuẩn

| Dữ liệu | Nguồn chuẩn |
|---|---|
| Quality score | Go `quality.Analyzer` |
| Transport status | Go runtime/quality snapshot |
| Desired/applied revision | `cors_runtime.relay_job_state` |
| Mountpoint/account/relay | `cors_admin` |
| Lịch sử kết nối caster | `cors_runtime.caster_connections` |
| Lịch sử relay | `cors_runtime.relay_sessions/relay_events/relay_hourly` |
| Audit cấu hình | `cors_admin.audit_logs` |
| Host/service health | Node system collector + Go internal metrics |

Frontend không tự tính lại quality score. Frontend chỉ format/hiển thị dữ liệu API.

### 4.2. Tách transport status và quality status

Không dùng một nhãn `streaming/stale/error/unknown` cho mọi thứ.

**Transport status**

| Giá trị | Điều kiện đề xuất |
|---|---|
| `online` | Có dữ liệu trong ≤ 5 giây, state `streaming` |
| `stale` | Có dữ liệu nhưng tuổi 5–30 giây |
| `offline` | Không có dữ liệu > 30 giây hoặc chưa từng có sample |
| `error` | Runtime/quality state `error` |
| `unknown` | Chưa đủ dữ liệu để kết luận |

**Quality status**

| Giá trị | Điều kiện đề xuất |
|---|---|
| `good` | Score ≥ 85, có metadata 1005/1006, có MSM |
| `warning` | Score 60–84, hoặc thiếu metadata/CNR |
| `critical` | Score < 60 hoặc không có MSM/cell |
| `unknown` | Chưa có sample |

**Metadata status**

- `ok`: có 1005/1006 + Station ID + ARP.
- `warning`: thiếu antenna hoặc thiếu 1005/1006.
- `critical`: không có metadata trong khi vẫn streaming.

### 4.3. Reliability của score

Mỗi trạm/relay phải trả thêm:

- `window_sec`
- `sample_count`
- `valid_sample_count`
- `data_completeness` = valid / expected
- `observation_started_at`
- `score_updated_at`
- `last_data_at`

Mục đích: tránh hiểu nhầm “score 92” chỉ dựa trên 30 giây dữ liệu.

## 5. Cấu trúc route và menu

### 5.1. Route P0

| Route | Màn hình |
|---|---|
| `/` | Dashboard vận hành |
| `/stations` | Danh sách trạm |
| `/stations/:id` | Danh sách trạm + drawer chi tiết |
| `/map` | Bản đồ vận hành hợp nhất |
| `/map?station=:id` | Bản đồ + drawer chi tiết trạm |
| `/online` | Danh sách kết nối online |
| `/mountpoints` | Danh sách mountpoint |
| `/mountpoints/explorer` | Mountpoint Explorer |
| `/relay-jobs` | Relay jobs |
| `/system/health` | System Health |
| `/alerts` | Cảnh báo |
| `/history` | Lịch sử relay/audit |
| `/web-users` | Người dùng web |
| `/roles` | Phân quyền |
| `/profile` | Trang cá nhân |

Redirect:

- `/stations/map` → `/map?layer=stations`
- `/online/map` → `/map?layer=online`

### 5.2. Menu P0

Chỉ bật mục đã có route. Các mục tổng hợp Chất lượng/Báo cáo/Cấu hình bật ở P1 để tránh menu rỗng.

```text
TỔNG QUAN
  Dashboard

TRẠM
  Danh sách trạm
  Bản đồ trạm

BẢN ĐỒ
  Bản đồ vận hành
  Danh sách online

CORS
  Tài khoản NTRIP
  Mountpoint
  Mountpoint Explorer
  Listener
  Kết nối

RELAY
  Relay jobs

HỆ THỐNG
  Sức khỏe
  Cảnh báo
  Lịch sử
  Người dùng
  Phân quyền
```

P1 bổ sung: `Trạm > Chất lượng`, `Trạm > Lịch sử`, `Relay > Giám sát luồng`,
`Relay > Chất lượng`, `Báo cáo`, `Cấu hình`.

## 6. P0.1 — Tổ chức lại chi tiết trạm

### 6.1. Mục tiêu

- Bỏ trùng lặp tab Tổng quan/Kết nối.
- Tách 5 tab theo mục đích.
- Thêm route + drawer, deep link được.
- Thêm transport/quality status và reliability.

### 6.2. Tab chi tiết trạm

| Tab | Nội dung |
|---|---|
| Tổng quan | Định danh, loại trạm, thiết bị, vị trí, nguồn, owner, trạng thái tổng hợp |
| Kết nối | Mountpoint, relay job, upstream/downstream, probe, desired/applied, kết nối hiện tại, reconnect gần nhất |
| Chất lượng | Score, availability, CNR, satellite, RMS, cycle slip, alert, reliability |
| Metadata | 1005/1006, Station ID, ARP, antenna, message type/rate, bitrate |
| Lịch sử | Transport/quality changes, caster connections, relay sessions, audit cấu hình |

### 6.3. API

Mở rộng `GET /api/stations/:id`:

```json
{
  "item": {
    "transportStatus": "online",
    "qualityStatus": "good",
    "metadataStatus": "ok",
    "reliability": {
      "windowSec": 900,
      "sampleCount": 15,
      "validSampleCount": 14,
      "dataCompleteness": 0.93,
      "observationStartedAt": "2026-10-30T12:00:00.000Z",
      "scoreUpdatedAt": "2026-10-30T12:15:00.000Z"
    }
  }
}
```

Thêm:

- `GET /api/stations/:id/connections`
- `GET /api/stations/:id/history?from=&to=&page=&pageSize=`
- `GET /api/stations/:id/metadata`

### 6.4. Nguồn dữ liệu tab Kết nối

- `mountpoints` theo `station_id`.
- `relay_jobs` khớp `upstream_mount` với mountpoint.
- `station_probes`.
- `caster_connections` join mountpoint.
- `relay_job_state` cho desired/applied.
- `relay_sessions` gần nhất.

### 6.5. Nguồn dữ liệu tab Lịch sử

Gộp thành danh sách sự kiện thống nhất:

- `quality_samples`: thay đổi transport/quality state, score.
- `caster_connections`: mở/đóng kết nối.
- `relay_sessions`: bắt đầu/kết thúc relay.
- `audit_logs`: thay đổi cấu hình trạm.

Không thêm bảng mới trong P0. Probe history chưa có; ghi rõ “chưa lưu lịch sử probe” trong UI nếu cần.

### 6.6. UI/file

- Tách `frontend/src/components/StationDetailDrawer.tsx`.
- Sửa `frontend/src/pages/Stations.tsx`.
- Thêm route `/stations/:id` trong `frontend/src/App.tsx`.
- Dùng `useParams`/`useSearchParams` để mở/đóng drawer.
- Giữ nguyên `QualityPanel`, bổ sung reliability block.

### 6.7. Nghiệm thu

- `/stations/80` mở drawer đúng trạm.
- 5 tab hiển thị đúng nội dung, không trùng.
- Transport và quality status độc lập.
- Reliability hiển thị window/sample/completeness/updated.
- Tab Kết nối có mountpoint + relay + desired/applied.
- Tab Lịch sử có ít nhất 2 nguồn dữ liệu thật.
- Đóng drawer quay lại đúng list/filter.

## 7. P0.2 — Mountpoint Explorer

### 7.1. Mục tiêu

Truy vết một mountpoint:

- Trạm nguồn.
- Relay upstream/downstream.
- Listener đang phục vụ.
- Tài khoản NTRIP có ACL.
- Kết nối online.
- Quality/bitrate/message rate.
- Cảnh báo mở.

### 7.2. API

`GET /api/mountpoints/explorer?q=&page=&pageSize=`

`GET /api/mountpoints/:id/explorer`

Response rút gọn:

```json
{
  "item": {
    "id": 20,
    "name": "THA_HauLoc",
    "station": { "id": 80, "code": "THA_HauLoc", "name": "THA Hậu Lộc" },
    "sourceState": "online",
    "quality": { "score": 88, "state": "streaming", "updatedAt": "..." },
    "bitrateBps": 120000,
    "messageRate": 12.4,
    "relays": [{ "id": 93, "name": "import THA_HauLoc", "direction": "upstream" }],
    "listeners": [{ "id": 1, "name": "caster-1509", "role": "both" }],
    "accounts": [{ "id": 5, "username": "rover01", "enabled": true }],
    "onlineConnections": 3,
    "alertsOpen": 1
  }
}
```

### 7.3. Nguồn dữ liệu

- `mountpoints`
- `account_mountpoint_acl`
- `caster_listener_mountpoints`
- `caster_connections`
- `relay_jobs`
- `quality_samples`
- `rtcm_message_stats`
- `quality_alerts`

### 7.4. UI

- Route `/mountpoints/explorer`.
- Bảng: mountpoint, trạm, source state, quality, relay, listener, account, online, alert.
- Click mở panel/drawer chi tiết.
- Filter theo trạm, trạng thái, owner, có cảnh báo.
- Nút “Mở trạm”, “Mở relay”, “Mở listener”.

### 7.5. Nghiệm thu

- Tìm được mountpoint `THA_HauLoc`.
- Hiển thị đúng relay #93, listener, account ACL.
- Số online khớp `/api/connections`.
- Không lộ secret/credential.
- RBAC: chỉ thấy dữ liệu trong scope.

## 8. P0.3 — Bản đồ vận hành hợp nhất

### 8.1. Mục tiêu

Một bản đồ duy nhất, có layer, filter, panel và mở chi tiết trạm.

### 8.2. Route

- `/map`
- `/map?station=:id`
- `/map?layer=stations`
- `/map?layer=online`

Redirect route cũ.

### 8.3. Layer

- Tất cả trạm.
- Trạm online.
- Trạm stale/lỗi.
- Trạm có tài khoản online.
- Trạm chưa có 1005.
- Theo vùng/owner.

### 8.4. API

`GET /api/map/overview?layer=&q=&region=&owner=`

Item:

```json
{
  "id": 80,
  "code": "THA_HauLoc",
  "name": "THA Hậu Lộc",
  "lat": 19.999947,
  "lon": 105.969244,
  "has1005": true,
  "transportStatus": "online",
  "qualityStatus": "good",
  "qualityScore": 88,
  "sourceType": "relay_caster",
  "mountpointCount": 1,
  "relayJobCount": 1,
  "onlineAccounts": 3,
  "region": "Thanh Hóa",
  "ownerName": "Super Admin"
}
```

### 8.5. UI

- Sidebar: search, layer toggles, danh sách trạm.
- Marker màu theo quality/transport.
- Click marker mở panel bên phải.
- Panel: trạng thái, quality, mountpoint, relay, online accounts, nút mở drawer.
- Giữ phân biệt tài khoản online và trạm đang phát RTCM.

### 8.6. Nghiệm thu

- `/stations/map` và `/online/map` redirect đúng.
- Marker chỉ có khi có 1005.
- Layer bật/tắt đúng.
- Click marker mở panel; mở drawer `/stations/:id`.
- Filter/search giữ URL khi refresh.
- Không hiển thị marker giả.

## 9. P0.4 — System Health

### 9.1. Mục tiêu

Biết VPS và service có khỏe không, không cần Prometheus.

### 9.2. API

`GET /api/system/health`

Quyền P0: dùng `settings.view` (admin). Không thêm permission/migration trong P0.

Response:

```json
{
  "ts": "...",
  "node": {
    "ok": true,
    "uptimeSec": 3600,
    "cpuPercent": 4.2,
    "rssBytes": 120000000,
    "heapUsedBytes": 50000000,
    "eventLoopLagMs": 3,
    "socketClients": 12
  },
  "host": {
    "cpuCount": 4,
    "load1": 0.4,
    "totalMemBytes": 8000000000,
    "freeMemBytes": 3000000000,
    "diskTotalBytes": 100000000000,
    "diskFreeBytes": 40000000000,
    "diskUsedPct": 60,
    "networkInBytes": null,
    "networkOutBytes": null
  },
  "mysql": {
    "ok": true,
    "latencyMs": 2,
    "schemaVersion": 12,
    "poolTotal": 10,
    "poolIdle": 8,
    "poolActive": 2
  },
  "go": {
    "ok": true,
    "latencyMs": 3,
    "schemaVersion": 4,
    "goroutines": 42,
    "heapAllocBytes": 20000000,
    "gcCount": 12,
    "uptimeSec": 3600
  }
}
```

### 9.3. Nguồn dữ liệu

- Node: `os`, `process`, `fs.statfs`, `performance.eventLoopUtilization`.
- Network: `/proc/net/dev` trên Linux/Docker; fallback `null`.
- MySQL: ping + pool stats + schema version.
- Go: internal API `GET /internal/health/metrics` (HMAC).
- Socket.IO: `io.engine.clientsCount`.

### 9.4. UI

Route `/system/health`.

Cards:
- Node API.
- Host CPU/RAM/Disk.
- MySQL.
- Go relay.
- Socket clients.
- Network nếu có.

Mỗi card có:
- trạng thái ok/warn/error.
- giá trị hiện tại.
- ngưỡng cảnh báo.
- thời điểm cập nhật.

### 9.5. Nghiệm thu

- API trả đủ metric hoặc `null` + lý do.
- Không lộ DSN/secret.
- UI refresh 10–15 giây.
- Không ảnh hưởng đường byte RTCM.
- Khi Go/MySQL down, card tương ứng báo lỗi, không treo trang.

## 10. P0.5 — Dashboard vận hành & alert impact

### 10.1. Mục tiêu

Dashboard trả lời 3 câu hỏi trong vài giây.

### 10.2. Bố cục

1. Tổng quan: trạm, mountpoint, relay, listener, kết nối online.
2. Sức khỏe: Node/Go/MySQL/host.
3. Sự cố cần xử lý: severity, thời gian, đối tượng ảnh hưởng, ack.
4. Hoạt động: sự kiện mới, thay đổi cấu hình, audit.

### 10.3. API

`GET /api/ops/dashboard?window=60`

`GET /api/alerts?includeImpact=1`

Impact mapping:

- station alert → station + mountpoints + relay jobs + online accounts.
- relay alert → relay job + station qua mountpoint + accounts.
- caster/connection alert → listener/mountpoint/station.

Response impact:

```json
{
  "impact": {
    "stations": 2,
    "mountpoints": 3,
    "relayJobs": 1,
    "onlineAccounts": 12,
    "items": [
      { "type": "station", "id": 80, "name": "THA Hậu Lộc" }
    ]
  }
}
```

### 10.4. Nội dung sự cố

- Level/severity.
- Title/code/eventType.
- Target.
- First seen/last seen/age.
- Ack status/người ack.
- Impact counts.
- Nút mở trạm/relay/mountpoint.
- Desired/applied revision nếu liên quan relay.

### 10.5. Nghiệm thu

- Dashboard có 4 vùng.
- Alert critical/major hiển thị đầu tiên.
- Click sự cố mở đúng đối tượng.
- Số ảnh hưởng khớp API.
- Desired/applied hiển thị khi có relay.
- Không auto-disable job/probe.

## 11. P0.6 — Menu, route và deep link

### 11.1. Việc cần làm

- Cập nhật `frontend/src/components/Layout.tsx`.
- Cập nhật `frontend/src/App.tsx`.
- Thêm redirect route cũ.
- Title topbar theo route.
- Active menu đúng cho `/stations/:id`, `/map?station=`.
- Mobile drawer vẫn hoạt động.

### 11.2. Nghiệm thu

- Menu 7 nhóm, chỉ mục có route.
- Deep link `/stations/80` mở drawer.
- `/map?station=80` mở drawer trên map.
- Refresh giữ filter/page.
- 390/768/1440 không tràn.
- Keyboard/focus hoạt động.

## 12. API contract P0

| Method | Endpoint | Quyền | Mục đích |
|---|---|---|---|
| GET | `/api/stations/:id` | `stations.view` | Thêm status/reliability |
| GET | `/api/stations/:id/connections` | `stations.view` | Mountpoint/relay/probe/connection |
| GET | `/api/stations/:id/history` | `stations.view` | Lịch sử tổng hợp |
| GET | `/api/stations/:id/metadata` | `stations.view`/`quality.view` | 1005/1006/ARP/message |
| GET | `/api/mountpoints/explorer` | `mountpoints.view` | Danh sách explorer |
| GET | `/api/mountpoints/:id/explorer` | `mountpoints.view` | Chi tiết explorer |
| GET | `/api/map/overview` | `stations.view` | Marker/layer |
| GET | `/api/system/health` | `settings.view` | System health |
| GET | `/api/ops/dashboard` | đăng nhập + scope | Dashboard vận hành |
| GET | `/api/alerts?includeImpact=1` | `alerts.view` | Alert impact |

## 13. Database/migration P0

P0 không cần migration schema mới.

Ghi chú:

- `caster_connections` đã có lịch sử đóng/mở.
- `relay_sessions/events/hourly` đã có.
- `quality_samples/alerts` đã có.
- `audit_logs` đã có.
- Probe history chưa có; P0 hiển thị “chưa lưu lịch sử probe”.
- Nếu sau này cần lịch sử probe, tạo bảng riêng ở P1.

## 14. Kế hoạch kiểm thử

### 14.1. Server unit/integration

- `server/tests/stationStatus.test.ts`
  - transport/quality/metadata status.
  - reliability/completeness.
- `server/tests/mountpointExplorer.test.ts`
  - join station/relay/listener/account.
  - RBAC scope.
- `server/tests/systemHealth.test.ts`
  - metric null fallback.
  - không lộ secret.
- `server/tests/opsDashboard.test.ts`
  - alert impact counts.
  - desired/applied.

### 14.2. Go

- `go test ./...`.
- Test internal health metrics.
- Không thay đổi parser/relay byte path.

### 14.3. Playwright

File mới: `frontend/tests/ops-p0.spec.ts`

Luồng:

1. `/stations/80` mở drawer, 5 tab.
2. Tab Kết nối có mountpoint/relay/desired-applied.
3. Tab Lịch sử có event.
4. `/mountpoints/explorer` mở THA_HauLoc.
5. `/map` layer/filter/marker/panel/drawer.
6. `/system/health` có Node/Go/MySQL/host.
7. Dashboard 4 vùng, alert impact.
8. Redirect `/stations/map`, `/online/map`.
9. Responsive 1440/768/390, dark mode.
10. Keyboard/focus drawer/menu.

### 14.4. Regression

- `npm test` server.
- `npm run build` frontend.
- `go test ./...`, `go vet ./...`.
- Playwright toàn bộ.
- `docker compose up -d --build server web gnss`.
- Kiểm tra health Node/Go.

## 15. Thứ tự thực hiện

| Bước | Việc | Phụ thuộc |
|---|---|---|
| 1 | P0.1 Trạm: status/reliability/API/tabs/route drawer | Không |
| 2 | P0.2 Mountpoint Explorer | P0.1 API station |
| 3 | P0.3 Bản đồ hợp nhất | P0.1 drawer |
| 4 | P0.4 System Health | Không |
| 5 | P0.5 Dashboard + alert impact | P0.1/P0.4 |
| 6 | P0.6 Menu/route/redirect | P0.1–P0.5 |
| 7 | Regression + Playwright + docs | P0.1–P0.6 |

## 16. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Host metric khác nhau Windows/Linux | Trả `null` + lý do; không bịa số |
| Probe không có lịch sử | Ghi rõ chưa lưu; P1 thêm bảng nếu cần |
| Alert impact map sai khi mountpoint nhiều trạm | Ưu tiên station_id của mountpoint; ghi rõ unknown nếu thiếu |
| Map tải toàn bộ trạm | Giới hạn 1000, filter server-side; P1 thêm clustering |
| Deep link drawer làm mất filter list | Lưu query params; đóng drawer quay lại đúng URL |
| Trùng lặp dữ liệu giữa các màn | Dùng cùng API/field; frontend không tự tính lại score |
| System health gây tải DB | Cache 10–15 giây; timeout ngắn; không query nặng |

## 17. Definition of Done P0

1. P0.1–P0.6 đạt nghiệm thu từng mục.
2. Server test + Go test + frontend build + Playwright PASS.
3. Không secret trong response/log/diff.
4. RBAC được kiểm tra ở server.
5. Responsive 1440/768/390, dark mode, keyboard/focus.
6. `SESSION.md` cập nhật kết quả và bằng chứng.
7. Không chuyển P1 khi P0 còn FAIL chưa xử lý.

## 18. Backlog sau P0

### P1

- Import/export NTRIP, mountpoint, relay.
- Notification center.
- Event configuration.
- Log viewer có filter.
- Báo cáo hiệu suất/chất lượng/kết nối.
- Cấu hình hệ thống, branding/logo.
- Lịch sử thay đổi cấu hình nâng cao.

### P2

- Sky Plot đầy đủ khi nguồn có ephemeris.
- Xu hướng chất lượng ngày/tuần/tháng.
- So sánh nhiều trạm.
- Phân tích nguyên nhân mất kết nối.
- Phát hiện bất thường tự động.

---

## 19. Đánh giá mức độ sẵn sàng vận hành (2026-10-31)

> Cách kiểm tra: graphify snapshot `graphify-out/graph.json` (1734 nodes, build
> 2026-10-30 17:28) để lần module, sau đó đối chiếu trực tiếp mã nguồn/diff.
> Graph chưa gồm các thay đổi chưa commit (`admin/012_station_source.sql`,
> rework nguồn trạm/1005); các kết luận dưới đây đã kiểm tra cả mã hiện tại.

### 19.1. Kết luận ngắn

| Câu hỏi | Kết luận |
|---|---|
| Hệ thống hiện tại đủ chạy **song song/thử nghiệm có kiểm soát**? | **CÓ** — relay, caster, CRUD, RBAC, quality, realtime, alert, history, backup đã có |
| Đủ **bỏ hẳn 2 hệ thống cũ** ngay hôm nay? | **CHƯA** — thiếu công cụ migrate hệ thống quản lý trạm, cấu hình domain/TLS production, load test 67 job và Phase 12 |
| Đã có công cụ chuyển dữ liệu relay cũ? | **CÓ** — CLI `importRelay` map đúng `config.json` (67 job bản 2026-10-31) |
| Đã có công cụ chuyển NTRIP account/mountpoint/listener? | **CHƯA** — chỉ trạm và web user có import `.xlsx`; chưa có bulk import cho 3 thực thể còn lại |
| Giữ nguyên đầu vào cũ **password-only, không username, tự nhận kết nối**? | **KHÔNG** — caster mới cần mountpoint/account/ACL tồn tại và Basic có username; xem G9/G10 và §20.2 |
| Có thể chạy mới và cũ **cùng lúc trên cùng VPS/port 1509**? | **KHÔNG** — xung đột cổng; phải dùng cổng tạm hoặc cắt cửa sổ bảo trì |

### 19.2. Năng lực đã có (đủ để vận hành lõi)

| Năng lực | Bằng chứng | Trạng thái |
|---|---|---|
| Relay GET upstream → POST/SOURCE downstream, TLS/SOCKS5/NMEA, backoff, loop guard | Phase 2; `gnss/internal/relay`, `gnss/internal/ntrip` | DONE (mock + real allowlist) |
| NTRIP caster v1/v2, auth Basic, ACL, max connection, listener 1509/1508 | Phase 4; `gnss/internal/caster`, `docker-compose.yml:92-95` | DONE |
| Trạm/mountpoint/relay/NTRIP account/web user/role CRUD + RBAC + audit | Phase 1–10; `server/src/routes/*` | DONE core |
| Chất lượng RTCM, alert/ack, realtime Socket.IO, lịch sử phiên/sự kiện | Phase 5–6 | DONE (mock + real probe) |
| Import/export trạm và web user `.xlsx` | `server/src/routes/stations.ts:279-433`, `server/src/routes/webUsers.ts:162-240` | DONE |
| Import relay cũ bằng CLI | `server/src/db/importRelay.ts` | DONE (chưa diễn tập trên 67 job) |
| Backup/restore MySQL | `scripts/backup-mysql.ps1`, `scripts/restore-mysql.ps1` | DONE (thủ công) |

### 19.3. Khoảng trống chặn Go-live

| # | Khoảng trống | Ảnh hưởng | Cần làm trước cutover |
|---|---|---|---|
| G1 | Chưa có P0 UX vận hành: `/stations/:id`, `/map`, `/mountpoints/explorer`, `/system/health` chưa có trong `frontend/src/App.tsx` | Vận hành vẫn phải mở nhiều màn rời; khó trả lời “sự cố ảnh hưởng gì” | Làm P0.1–P0.6 |
| G2 | Không có bulk import/export NTRIP account, mountpoint, caster listener (TASKS P9/P10 ghi “import/export” nhưng mã hiện chỉ có stations + web users) | Không migrate được hệ thống quản lý trạm quy mô lớn | Viết script migrate hoặc bổ sung API import |
| G3 | Password NTRIP lưu Argon2id, API tạo account yêu cầu plaintext ≥ 8 ký tự (`server/src/routes/ntripAccounts.ts:16-31`) | Không copy trực tiếp hash từ hệ cũ; “auth ngẫu nhiên” có thể không đạt regex/độ dài | Export plaintext từ hệ cũ hoặc script hash trực tiếp; nếu không, đặt lại mật khẩu |
| G4 | Chưa cấu hình domain/TLS/reverse proxy production; web đang `:3000` HTTP (`docker-compose.yml:109-110`, `frontend/nginx.conf` listen 80), `SESSION_COOKIE_SECURE=false` mặc định | Cookie không Secure, không HTTPS cho `rtktk.online` | Thêm reverse proxy 80/443 + cert; đặt `CORS_ORIGIN`, `SESSION_COOKIE_SECURE=true` |
| G5 | Cổng 1509 đang thuộc hệ cũ; compose cũng publish 1509 | Không thể chạy song song trên cùng cổng | Diễn tập bằng 1508/port tạm; cutover theo cửa sổ bảo trì |
| G6 | Phase 12 TODO: load 50–100, security review, E2E, release/rollback runbook | Chưa chứng minh được 66–67 job + rover thật ổn định | Chạy load test ≥ 67 job mock + E2E trước cutover |
| G7 | P11-02..05 defer: notification nâng cao, system params/log viewer, báo cáo, retention/backup UI | Thiếu công cụ vận hành dài hạn, không chặn cutover kỹ thuật | Chấp nhận có ghi chú hoặc làm trước khi mở rộng |
| G8 | Backup hiện chạy tay, ghi ra ổ cùng máy | Rủi ro mất dữ liệu khi VPS hỏng | Lên lịch backup định kỳ + copy ra ngoài VPS |
| G9 | Hệ cũ dùng **password-only, không username**; caster mới bắt buộc Basic có username hoặc tắt auth | Không thể giữ nguyên credential/thiết bị đầu vào | Thêm auth mode `password_only` theo mountpoint hoặc tạo username tổng hợp + cập nhật thiết bị |
| G10 | Hệ cũ **tự nhận kết nối**, không cần tạo trạm/mountpoint trước; caster mới yêu cầu mountpoint + account + ACL tồn tại | Thiết bị không publish được nếu chưa provision | Provision trước theo danh sách, hoặc thêm auto-provision có kiểm soát |

### 19.4. Go/No-Go

Chỉ Go-live thay thế hệ thống cũ khi **tất cả** điều kiện sau PASS:

1. G1 hoàn tất hoặc có chấp thuận bằng văn bản rằng vận hành bằng UI hiện tại.
2. G2/G3 có script migrate và đã diễn tập trên bản sao dữ liệu cũ.
3. G4 HTTPS/domain hoạt động; cookie `Secure`; không mixed content.
4. G5 có cửa sổ cutover và phương án cổng đã thống nhất.
5. G6 load test ≥ 67 job và E2E PASS.
6. Backup/restore đã kiểm chứng trong 7 ngày gần nhất.
7. Rollback đã diễn tập (mục 22).

---

## 20. Chuyển đổi dữ liệu từ 2 hệ thống cũ

### 20.1. Hệ thống 1 — Relay caster → caster

Nguồn cập nhật 2026-10-31: `db/data/config.json` (67 job). Bản backup cũ
`F:\3.Laptrinh\1. Project\1. GNSS\relayrtcm\backup\config.json` (65 job) chỉ
đọc, không sửa.

Thực tế đã kiểm tra (chỉ đọc metadata, không đọc credential):

| Thuộc tính | Giá trị |
|---|---|
| Số job | 67 |
| Job đang bật | 66 |
| Job có credential upstream | 67 |
| Job có credential downstream | 62 |
| Job dùng SSL upstream/downstream | 0/0 |
| Job có `lat`/`lon` | 67/67 |
| Số host nguồn/đích | 6/4 |
| Trường trong config | `id, enable, src_*, dst_*, lat, lon, nmea_interval_sec` |

Đối chiếu công cụ: `server/src/db/importRelay.ts` map đúng toàn bộ trường trên
(`OldRelayJob` dòng 8–30, `normalizeJob` dòng 110–147), mã hoá secret bằng
`APP_ENC_KEY`, `external_key = id`, lưu `source_sha256`, idempotent, có
`--dry-run`, `--ids`, `--force`, `--owner`.

**Lưu ý bắt buộc:**

- Job import được tạo **disabled** (`enabled = 0`, dòng 303) → phải bật và test
  từng job sau khi import.
- Tên job là `import <id>` → cần đổi tên theo quy ước vận hành nếu muốn.
- Import chạy trong mạng compose để resolve `mysql`; mount file read-only một
  lần, không mount thư mục backup vào app thường trực. Ví dụ:
  `docker compose run --rm -v "F:\3.Laptrinh\1. Project\1. GNSS\29102026_Quanlytram\db\data:/import:ro" server node dist/db/importRelay.js --file /import/config.json --dry-run`
- Không chạy relay cũ, không chiếm `8081`, không sửa backup (AGENTS §5).

**Điều kiện nghiệm thu:** 67/67 job có `external_key`; 100% credential giải mã
được; danh sách job bật khớp phê duyệt; không secret trong log/DB dump/audit;
relay test (mock/allowlist) byte-exact; loop guard không báo chu trình.

### 20.2. Hệ thống 2 — Quản lý trạm `rtktk.online:1509` (auth ngẫu nhiên)

Không có dữ liệu hệ này trong máy phát triển; phải export từ VPS cũ.

#### 20.2.1. Đặc tả đầu vào hệ cũ (theo xác nhận 2026-10-31)

| Thuộc tính | Giá trị hệ cũ | Hệ mới có đáp ứng? |
|---|---|---|
| Host/port | `rtktk.online:1509` | Có — caster mặc định 1509 |
| Giao thức | NTRIP **v1** | Có — hỗ trợ v1/v2 |
| Auth | **Chỉ password ngẫu nhiên, không username** | **Không** — Basic auth yêu cầu username; `authorize()` tra `accountByUsername`, username rỗng không khớp (`gnss/internal/caster/listener.go:255-268`) |
| Payload | RTCM **3.2** | Có — parser RTCM3/3.x theo frame, không phụ thuộc version 3.2 |
| Provision | Mở kết nối là nhận; **không cần tạo trạm/mountpoint trước** | **Không** — phải có mountpoint `enabled` + account + ACL trước (`listener.go:86-95`) |
| Mountpoint | **Giống hệt trạm đầu vào** (1 trạm ↔ 1 mountpoint cùng tên/mã) | Có thể map — tạo `stations` + `mountpoints` cùng code/name |

Hệ quả: nếu giữ nguyên thiết bị đầu vào, hệ mới sẽ trả 404 (mountpoint chưa
tồn tại) hoặc 401 (không có account/username). Đây là **điểm chặn cutover**
lớn nhất của hệ thống 2, không chỉ là thiếu công cụ import.

#### 20.2.2. Phương án tương thích (chọn trước khi migrate)

| Phương án | Cách làm | Ưu | Nhược | Khuyến nghị |
|---|---|---|---|---|
| A. Username tổng hợp | Tạo account `stn_<MãTrạm>` + password mới; cập nhật cấu hình thiết bị/nguồn gửi | Không đổi code; giữ auth | Phải chạm cấu hình từng thiết bị; “no user” không còn đúng | Dùng nếu thiết bị cho phép sửa username |
| B. Auth `password_only` | Thêm mode mountpoint: chỉ kiểm tra password (hash theo mountpoint hoặc account gắn mountpoint), username được phép rỗng | Giữ nguyên thiết bị; vẫn có auth | Phải sửa schema + Go caster + API/UI + test | **Khuyến nghị** nếu không sửa được thiết bị |
| C. Tắt auth mountpoint | Đặt `requires_auth=0` | Chạy ngay | Mất bảo vệ; ai biết mountpoint cũng publish/đọc được | Chỉ dùng tạm trong diễn tập, có firewall/IP allowlist |
| D. Auto-provision | Tự tạo station/mountpoint/account khi SOURCE kết nối lần đầu | Gần hành vi cũ nhất | Rủi ro chiếm mountpoint, rác dữ liệu, khó RBAC | Không khuyến nghị cho production |

**Khuyến nghị chốt:** ưu tiên **B** (thêm `password_only` theo mountpoint) +
script provision trước danh sách trạm; nếu thiết bị sửa được username thì dùng
**A** để giữ mô hình auth chuẩn. Không dùng **C** cho production và không dùng
**D** khi chưa có cơ chế xác thực/allowlist.

**Yêu cầu kỹ thuật nếu chọn B:**

- `mountpoints` thêm `auth_mode ENUM('basic','password_only','none')` (hoặc
  `password_hash` theo mountpoint) — cần migration admin mới.
- Go caster: khi `password_only`, so khớp password với hash của mountpoint,
  không tra username; vẫn ghi `account_id = NULL` vào connection.
- API/UI mountpoint: nhập/đổi password, không trả hash; audit redaction.
- Test: đúng/sai password; username rỗng; ACL; rover; SOURCE/POST v1/v2.

#### 20.2.3. Provision trước (thay cho “mở kết nối là được”)

Vì hệ mới không auto-provision, cần tạo trước theo quy ước **1 trạm = 1
mountpoint cùng mã**:

1. Tạo `stations` (code = tên trạm/mountpoint đầu vào, `source_type` phù hợp).
2. Tạo `mountpoints` cùng `name`, gắn `station_id`, `requires_auth` theo phương
   án A/B/C ở trên.
3. Tạo `ntrip_accounts` + `account_mountpoint_acl` (nếu dùng A/B).
4. Gắn mountpoint vào `caster_listeners` (1509).
5. Test SOURCE/POST + rover trước khi mở cho thiết bị thật.

Danh sách trạm để provision lấy từ: export DB/UI hệ cũ, log kết nối cũ, hoặc
danh sách thiết bị vận hành đang quản lý. Nếu hệ cũ không lưu danh sách, phải
chốt danh sách với người vận hành trước cutover — không suy đoán.

**Cần thu thập từ hệ cũ:**

- Danh sách trạm: mã, tên, toạ độ, owner, trạng thái.
- Mountpoint: tên, trạm gắn với, auth mode, max connection, service type.
- Credential đầu vào: password (plaintext nếu có thể); username nếu hệ cũ có
  (hệ cũ xác nhận **không username**).
- Listener/caster: tên, port, role, mountpoint được phục vụ.
- Vì hệ cũ tự nhận kết nối và mountpoint = trạm đầu vào, lấy danh sách mountpoint
  thực tế từ log/DB kết nối cũ; không chỉ dựa vào danh mục cấu hình.
- Tuỳ chọn: lịch sử kết nối/phiên (không bắt buộc cho Go-live).

**Map sang schema mới:**

| Dữ liệu cũ | Đích trong hệ mới | Ghi chú |
|---|---|---|
| Trạm | `stations` + `source_type`, `ntrip_version`, `ntrip_mode` | `admin/012_station_source.sql`; chọn `caster_ingest`/`manual`/`relay_caster`; code = tên đầu vào |
| Mountpoint | `mountpoints (station_id, name)` | 1 trạm ↔ 1 mountpoint cùng tên/mã; `station_id` nên có để gắn quality |
| Tài khoản rover | `ntrip_accounts` + `account_mountpoint_acl` | Username regex `^[A-Za-z0-9_.-]+$`, dài 3–64; password ≥ 8; hash Argon2id |
| Auth ngẫu nhiên (no user) | `auth_mode = password_only` (phương án B) hoặc username tổng hợp (A) | Không copy hash cũ; không dùng `requires_auth=0` cho production |
| Caster | `caster_listeners` + `caster_listener_mountpoints` | Port mặc định 1509; không dùng 2101/8081 |
| Owner | `owner_web_user_id` | Map từ user cũ; nếu không có thì gán super admin và ghi audit |

Lưu ý: NTRIP v1 + RTCM 3.2 không cần chuyển đổi định dạng; chỉ cần đúng
mountpoint, auth mode và listener 1509. Password ngẫu nhiên cũ chỉ migrate được
nếu export được plaintext hoặc đặt lại; nếu không, phải phối hợp đổi credential
với đơn vị vận hành trạm.

**Công cụ hiện có:** import `.xlsx` chỉ cho trạm (`/api/stations/import`,
`stations.ts:315-433`) và web user (`/api/web-users/import`). **Không có**
endpoint import cho NTRIP account, mountpoint, listener, role.

**Khuyến nghị:** viết script migrate một lần
(`server/src/db/importLegacyCaster.ts`) đọc CSV/SQL export từ hệ cũ, chạy
`--dry-run` trước, dùng transaction, hash password bằng `hashPassword`, ghi
`source_sha256`, audit `import`, không log secret. Không mở API import công khai
cho credential.

**Điều kiện nghiệm thu:** số trạm/mountpoint/account/listener khớp báo cáo đối
chiếu; rover test auth thành công trên từng mountpoint; ACL đúng; max
connection đúng; không lộ credential; audit có bản ghi import.

#### 20.2.4. Kết quả quét caster 1509/1508 (2026-10-31)

Đã quét trực tiếp `rtktk.online` bằng NTRIP sourcetable (không dùng credential)
và đối chiếu với `db/data/config.json`:

| Port | STR trong sourcetable | Mountpoint được relay tham chiếu |
|---|---:|---:|
| 1509 | 26 | 29 |
| 1508 | 6 | 3 |

- Gộp không phân biệt hoa/thường: **36 trạm**; 31 trạm có trong sourcetable,
  5 trạm chỉ có trong relay config (`DTP_TanHong`, `GLI2`, `HUG_ViThuy`,
  `PYN_SongHinh`, `YBI_NghiaLo`).
- Chỉ có trong sourcetable, không có trong relay: `BG.TP`, `hauloc`,
  `MocChautest`, `TNN_DaiTu`.
- Một cặp lệch hoa/thường đã gộp: `TNN_TPThaiNguyen` ↔ `TNN_TpThaiNguyen`.
- Sourcetable **động**: `BG.TP` lúc có lúc không giữa các lần quét; lần chốt
  17:23 có `BG.TP` nên đã đưa vào file. Khi cutover phải quét lại và đối chiếu.
- Toạ độ trong sourcetable là `0.00` (placeholder), nên file import để trống
  `lat/lon`; chỉ điền khi có 1005/1006 hoặc probe.
- Cột `region` được suy đoán từ tiền tố mountpoint (THA, SLA, YBI, ...), cần
  đối chiếu trước khi dùng chính thức.

File sinh ra (chạy lại bằng `node scripts/scan-caster-stations.mjs`):

- `db/data/sourcetable_1509.txt`, `db/data/sourcetable_1508.txt` — raw.
- `db/data/caster_stations.xlsx` — import trực tiếp qua `/api/stations/import`.
- `db/data/caster_stations.csv` / `.json` — đối chiếu, kèm port/relay job/alias.
- `db/data/caster_mountpoints.csv` / `.xlsx` — danh sách mountpoint cho bước
  tạo mountpoint (chưa có API import mountpoint).
- `db/data/caster_scan_summary.md` — tổng hợp và cảnh báo.

Lưu ý: file xlsx chỉ tạo `stations`; chưa tạo `mountpoints`, account, ACL hay
listener. Muốn thiết bị publish được vẫn phải làm bước provision/script
`importLegacyCaster` (P0.7/P0.12).

#### 20.2.5. Kiểm tra stream 2 trạm test (2026-10-31)

Đọc trực tiếp `rtktk.online:1509` bằng tài khoản được cấp (không lưu
credential), 60 giây/mountpoint:

| Mount | Status | Frame | CRC lỗi | MSM epoch | Toạ độ 1006 |
|---|---|---:|---:|---|---|
| `hauloc` | ICY 200 OK | 264 | 0 | 60/60 mỗi hệ GPS/GLO/GAL/BDS | 19.999947, 105.969244; h -8.87 m; antenna 0.41 m |
| `MocChautest` | ICY 200 OK | 265 | 0 | 60/60 mỗi hệ GPS/GLO/GAL/BDS | 20.846817, 104.639403; h 804.11 m; antenna 2.46 m |

- Không phát hiện mất epoch, CRC lỗi hay stall > 3 giây; throughput khoảng
  940 B/s (`hauloc`) và 770 B/s (`MocChautest`).
- `MocChautest` có thêm 1 frame proprietary 4063; không ảnh hưởng MSM.
- Caster trả body dạng chunked (`\r\n<size>\r\n`) dù không có header
  `Transfer-Encoding`; probe bỏ qua 420 byte chunk header/60 giây. Nếu đọc raw
  TCP phải dechunk trước khi chuyển tiếp.
- Bằng chứng: `db/data/probes/probe_hauloc.json`,
  `db/data/probes/probe_MocChautest.json`.

### 20.3. Thứ tự migrate

1. Chốt danh sách trạm đầu vào + auth mode (A/B/C) + quy ước mã mountpoint.
2. Web user + role (để có owner).
3. Trạm (`stations`, 1 dòng/đầu vào).
4. Mountpoint (`mountpoints`) cùng tên/mã + gắn `station_id`.
5. Caster listener (port tạm khi hệ cũ còn chạy) + gắn mountpoint.
6. NTRIP account + ACL, hoặc cấu hình `password_only` theo mountpoint.
7. Relay job (import disabled) → test → bật dần.
8. Đối chiếu số lượng + test SOURCE/POST/rover end-to-end.

---

## 21. Kế hoạch cắt chuyển (cutover)

### 21.1. Chuẩn bị

- Chốt endpoint công khai: web `https://rtktk.online` (443 →
  `web:3000`), caster `rtktk.online:1509` (giữ nguyên cho rover), 1508 dự phòng.
- DNS `rtktk.online` trỏ VPS mới; cấp TLS (Let's Encrypt hoặc cert nội bộ).
- Đặt `CORS_ORIGIN=https://rtktk.online`, `SESSION_COOKIE_SECURE=true`,
  `NODE_ENV=production`; reverse proxy thêm `X-Forwarded-*`, WebSocket
  `/socket.io`.
- Mở firewall 80/443/1509/1508; giữ MySQL 3307, Node 4000, Go 7080 loopback.
- Backup hệ cũ (config/DB) và hệ mới ra ngoài VPS; xác nhận restore được.

### 21.2. Diễn tập (không ảnh hưởng production)

1. Dựng stack mới trên cổng caster tạm (ví dụ 1508/15109).
2. Import 67 relay job (disabled), migrate trạm/mountpoint/account/listener.
3. Test: rover auth, publish SOURCE/POST, relay test, quality snapshot > 0.
4. Load test mock ≥ 67 job + rover; theo dõi CPU/RAM/queue/backpressure.
5. Đo thời gian migrate + cutover; ghi runbook.

### 21.3. Cửa sổ cutover

1. Thông báo và chốt thời gian; xác nhận được phép dừng hệ cũ (AGENTS §5).
2. Dừng relay cũ và caster cũ; xác nhận cổng 1509/8081 đã giải phóng.
3. Chạy migrate lần cuối (idempotent), bật listener 1509.
4. Bật relay job theo danh sách ưu tiên; kiểm tra `applied_revision`,
   `runtime_state = streaming`.
5. Kiểm tra rover/khách hàng kết nối; quality/alert; dashboard.
6. Theo dõi tối thiểu 24–48 giờ trước khi tuyên bố hoàn tất.

### 21.4. Nghiệm thu cutover

- Web HTTPS 200; đăng nhập; cookie `Secure`; Socket.IO realtime.
- Caster 1509 nhận SOURCE/POST và rover; ACL/max conn đúng.
- 100% relay job được duyệt ở trạng thái `streaming`; quality có sample.
- Không lộ credential trong log/UI/API.
- Alert critical = 0 trong 24 giờ đầu (hoặc có xử lý).
- Backup tự động chạy và restore thử PASS.

---

## 22. Rollback

Kích hoạt khi: rover không kết nối được, relay mất byte/lỗi hàng loạt, quality
critical, hoặc domain/TLS lỗi không khắc phục trong cửa sổ cho phép.

1. Giữ nguyên binary/config/DB hệ cũ đến hết thời gian quan sát.
2. Dừng stack mới (hoặc chỉ listener 1509) để giải phóng cổng.
3. Khôi phục DNS/cổng về hệ cũ; bật lại relay/caster cũ.
4. Khôi phục DB mới từ backup nếu cần điều tra; không ghi đè dữ liệu cũ.
5. Ghi sự cố, nguyên nhân, thời điểm; chỉ cutover lại sau khi có fix + test.

**Điều kiện:** rollback phải được diễn tập trước cutover và ghi thời gian thực
hiện thực tế (mục tiêu < 15 phút).

---

## 23. Bổ sung vào DoD/backlog cho cutover

Thêm vào Definition of Done của P0:

8. Có báo cáo readiness theo §19, kết luận Go/No-Go rõ ràng.
9. Có script migrate hệ thống quản lý trạm + kết quả diễn tập trên bản sao.
10. Có runbook cutover/rollback đã diễn tập, kèm người phụ trách và cửa sổ thời gian.
11. Có cấu hình HTTPS/domain production và kiểm tra cookie `Secure`.
12. Có kết quả load test ≥ 67 relay job và E2E sau cutover.

Backlog bổ sung (ưu tiên trước Go-live):

- P0.7 — Script `importLegacyCaster` (trạm/mountpoint/account/listener/ACL)
  theo quy ước 1 trạm = 1 mountpoint; `--dry-run`, transaction, audit.
- P0.8 — Reverse proxy TLS + production env profile + healthcheck domain.
- P0.9 — Load test 67–100 job; đo CPU/RAM/p95; kiểm tra queue/backpressure.
- P0.10 — Backup định kỳ ra ngoài VPS + diễn tập restore/rollback.
- P0.11 — Hỗ trợ auth `password_only` (migration + Go caster + API/UI + test)
  nếu thiết bị không thể đổi sang username; hoặc công cụ tạo username tổng hợp.
- P0.12 — Provision trước danh sách trạm (station + mountpoint + account + ACL)
  và test SOURCE/rover trên cổng tạm trước cutover.
