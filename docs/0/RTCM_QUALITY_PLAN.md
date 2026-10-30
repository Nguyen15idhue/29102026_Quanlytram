# KẾ HOẠCH RTCM ANALYTICS & CHẤT LƯỢNG TRẠM/RELAY (Phase 6)

> Tài liệu bổ sung cho `KE_HOACH_CHI_TIET.md` và `TASKS.md`.
> Phase 6 mở rộng MVP sau Phase 5; không thay đổi các bất biến Phase 0–5.

## 1. Mục tiêu & phạm vi

- Dùng `github.com/go-gnss/rtcm` để **parse RTCM3** trong Go, chỉ đọc.
- Quản lý chất lượng cho **hai loại đối tượng**:
  - **Trạm thường (`station`)**: chất lượng luồng của trạm/mountpoint,
    lấy từ caster nội bộ (Phase 4) hoặc station probe (GET-only, Phase 6).
  - **Trạm relay (`relay_job`)**: chất lượng `upstream` (nguồn) và
    `downstream` (đầu ra relay), gồm cả so sánh suy giảm.
- Phát hiện sớm: mất gói, sai CRC, thiếu MSM, thiếu metadata trạm, ARP nhảy,
  sai station ID, CNR thấp, tuổi dữ liệu cao, relay làm mất type/giảm rate.
- Có **backend** tổng hợp + API + realtime; có **frontend quản trị realtime**
  với hai nhóm màn hình: Trạm và Relay.
- Không sửa byte RTCM, không serialize lại, không chặn luồng relay/caster.

## 2. Quyết định bổ sung

| # | Quyết định | Hệ quả |
|---|---|---|
| D25 | Dùng `github.com/go-gnss/rtcm` (Apache-2.0), module `rtcm3` | Chỉ parse; kiểm tra license trước phân phối |
| D26 | Chất lượng dùng chung theo `target_type` + `target_id` + `direction` | `station` và `relay_job`; **không FK** giữa relay và station |
| D27 | Realtime: Go giữ RAM, Node pull internal API, Socket.IO phát cho FE | Node không nằm trên đường byte |
| D28 | Chỉ lưu aggregate/sample, không lưu raw RTCM/payload | Giảm dung lượng, tránh lộ dữ liệu |
| D29 | Điểm chất lượng minh bạch, ngưỡng cấu hình được | Không auto-disable job/probe; chỉ cảnh báo |
| D30 | Cảnh báo có debounce | Không báo lặp mỗi giây; có first_seen/last_seen/resolved_at |
| D31 | Trạm thường lấy chất lượng từ caster ingest; nếu trạm ngoài hệ thống thì dùng **station probe GET-only** | Probe mặc định disabled; mock-first; không tạo downstream |
| D32 | Relay có thêm chỉ số `parity` upstream↔downstream | Phát hiện relay suy giảm; không gộp mất chỉ số gốc |

## 3. Kiến trúc & luồng dữ liệu

```
Trạm thường:
  Caster nội bộ (Phase 4) ──ingest──┐
  Station probe (GET-only) ────────┤
                                    ▼
                             RTCM Analyzer (go-rtcm, parse-only)
                                    │
Trạm relay:                         │
  Relay Bridge ──upstream───────────┤
               └─downstream─────────┘
                                    │
                    RAM ring 1s / target / direction
                                    │
                    MySQL runtime: sample 60s + hourly + alerts
                                    │
Node API ──pull 1s (HMAC)──> /internal/rtcm/snapshot
   │
   ├─ REST /api/stations/:id/quality, /api/relay-jobs/:id/quality
   └─ Socket.IO room station:<id> / relay:<id> (sau kiểm tra quyền)
                                    │
React FE ──REST + Socket.IO──> màn hình chất lượng Trạm + Relay
```

- Analyzer chạy song song, không nằm trong vòng ghi byte.
- Queue parse có giới hạn; đầy thì drop sample, tăng counter, không chặn relay/caster.
- Parse lỗi/không hỗ trợ: đếm và tiếp tục; byte vẫn được chuyển nguyên vẹn.
- Station probe chỉ GET, không POST/SOURCE; dùng endpoint được phép, mặc định tắt.

## 4. go-rtcm: dependency & cách dùng

- Module: `github.com/go-gnss/rtcm v0.0.9` (hoặc bản mới hơn sau khi kiểm tra).
- Package: `github.com/go-gnss/rtcm/rtcm3`.
- API chính:
  - `DeserializeFrame`, `DeserializeFrameBytes` để tách frame.
  - `MessageNumber(payload)` để đếm nhanh type.
  - `DeserializeMessage(payload)` hoặc `DeserializeMessageXXXX` cho type hỗ trợ.
- Type ưu tiên:
  - Metadata trạm: `1005`, `1006`, `1007`, `1008`, `1033`.
  - MSM GPS: `1074–1077`; GLONASS: `1084–1087`; Galileo: `1094–1097`;
    SBAS: `1104–1107`; QZSS: `1114–1117`; BeiDou: `1124–1127`.
  - Bias/khác: `1230`, `1029` (text), `1033` (receiver/antenna descriptor).
- Unknown type: chỉ đếm `message_type`, không decode.
- MSM7 có CNR; MSM4/5/6 có thể không có CNR → đánh dấu `cnr_available`.
- Không dùng API serialize/encapsulate để ghi lại luồng.

## 5. Chỉ số chất lượng

### 5.1. Theo đối tượng và hướng

| Đối tượng | Direction | Nguồn |
|---|---|---|
| `station` | `ingest` | Caster ingest hoặc station probe |
| `relay_job` | `upstream` | Nguồn relay nhận vào |
| `relay_job` | `downstream` | Đầu ra relay đẩy đi |

### 5.2. Nhóm chỉ số

| Nhóm | Chỉ số |
|---|---|
| Transport | session state, uptime, reconnect, bytes/s, last-data age, gap |
| Integrity | frames, CRC errors, parse errors, unknown types, frame length bất thường |
| RTCM content | type distribution/rate, MSM epochs, satellite/signal/cell counts, avg CNR |
| Station metadata | 1005/1006, station ID, ARP ECEF, ARP jump, 1007/1008/1033 |
| Relay parity | so sánh type/rate upstream vs downstream, mất type, lệch rate, lệch tuổi dữ liệu |

### 5.3. Điểm 0–100 (mặc định, cấu hình được)

| Thành phần | Điểm | Cách tính mặc định |
|---|---:|---|
| Transport | 25 | streaming + không gap quá 2× chu kỳ kỳ vọng |
| Integrity | 20 | giảm theo tỷ lệ CRC/parse errors |
| MSM | 25 | đủ constellation/MSM kỳ vọng + tỷ lệ sat/cell so baseline |
| Metadata | 15 | có 1005/1006, station ID khớp, ARP ổn định, có antenna |
| Signal | 10 | CNR trung bình (MSM7); nếu không có CNR thì dùng completeness |
| Latency | 5 | tuổi epoch so với hiện tại |

- Trạm thường: điểm theo `ingest`.
- Relay: điểm `upstream`, điểm `downstream`, và điểm job = `min(upstream, downstream)`.
- `parity` là chỉ số riêng (0–100), không thay thế điểm upstream/downstream.
- Baseline MSM lấy trung vị 10 phút gần nhất; tránh so với hằng số cứng.
- Ngưỡng lưu trong `settings` (admin) + override theo station/job nếu cần.

### 5.4. Cảnh báo mặc định

- Mất dữ liệu > 30 s.
- CRC/parse error rate > 5% trong 1 phút.
- Thiếu 1005/1006 hoặc station ID không khớp > 2 chu kỳ.
- ARP nhảy > 5 m giữa hai mẫu liên tiếp.
- MSM satellite/cell giảm > 50% so baseline 10 phút.
- CNR trung bình < 25 dBHz (khi có CNR).
- Relay: downstream mất ≥ 1 MSM type hoặc rate < 70% upstream trong 1 phút.
- Debounce: 3 cửa sổ liên tiếp; alert có `first_seen`, `last_seen`, `resolved_at`.

## 6. Mô hình dữ liệu (dự kiến)

```sql
-- cors_runtime (Go ghi)
rtcm_message_stats(
  target_type ENUM('station','relay_job'), target_id BIGINT,
  mountpoint_id BIGINT NOT NULL DEFAULT 0,
  direction ENUM('ingest','upstream','downstream'),
  hour_start_utc DATETIME(3), message_type INT,
  count BIGINT, bytes BIGINT, last_seen_at DATETIME(3),
  PRIMARY KEY(target_type, target_id, mountpoint_id, direction, hour_start_utc, message_type)
)

quality_samples(
  id, target_type, target_id, mountpoint_id BIGINT NOT NULL DEFAULT 0,
  direction, ts DATETIME(3), window_sec INT,
  score TINYINT, state VARCHAR(32),
  frames BIGINT, bytes BIGINT, crc_errors BIGINT, parse_errors BIGINT,
  unknown_messages BIGINT, msm_epochs BIGINT,
  satellites INT, signals INT, cells INT, avg_cnr DECIMAL(5,2),
  reported_station_id INT NULL, arp_x BIGINT NULL, arp_y BIGINT NULL, arp_z BIGINT NULL,
  arp_delta_m DECIMAL(8,3) NULL, antenna VARCHAR(64) NULL,
  age_ms INT, gaps INT, cnr_available TINYINT(1), details JSON NULL,
  KEY(target_type, target_id, mountpoint_id, direction, ts)
)

quality_alerts(
  id, target_type, target_id, mountpoint_id BIGINT NOT NULL DEFAULT 0,
  direction, code VARCHAR(64),
  severity ENUM('info','warning','critical'),
  first_seen DATETIME(3), last_seen DATETIME(3), resolved_at DATETIME(3) NULL,
  details JSON NULL, KEY(target_type, target_id, mountpoint_id, last_seen)
)

-- cors_admin (Node ghi)
station_probes(
  id, station_id, mountpoint_id NULL, enabled,
  probe_interval_sec, credential_id NULL,
  owner_web_user_id, created_by, created_at, updated_at
)
quality_alert_acks(
  alert_id BIGINT, web_user_id BIGINT, acked_at DATETIME(3), note VARCHAR(255),
  PRIMARY KEY(alert_id, web_user_id)
)
```

- Không FK xuyên schema; `target_id` trỏ tới `stations.id` hoặc `relay_jobs.id`.
- `mountpoint_id` dùng cho chất lượng theo mountpoint của trạm; relay dùng `0`.
- `reported_station_id` là station ID trong RTCM 1005/1006, không phải FK.
- Station probe (nếu dùng) có cấu hình riêng trong admin, mặc định disabled.
- Sample DB: 60 s/target/direction; retention 30 ngày.
- Hourly aggregate: 90 ngày; alert: 90 ngày.
- RAM ring: 5 phút, cập nhật 1 s.
- Không lưu raw frame/payload.

## 7. API & realtime

### 7.1. REST (Node)

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/quality/overview?targetType=&window=&owner=` | `quality.view` |
| GET | `/api/stations/:id/quality?mountpointId=&direction=ingest&window=` | `quality.view` |
| GET | `/api/stations/:id/rtcm/messages?mountpointId=&from=&to=` | `quality.view` |
| GET | `/api/relay-jobs/:id/quality?direction=upstream/downstream&window=` | `quality.view` |
| GET | `/api/relay-jobs/:id/rtcm/messages?from=&to=&direction=` | `quality.view` |
| GET | `/api/quality/alerts?targetType=&status=open&severity=` | `quality.view` |
| POST | `/api/quality/alerts/:id/ack` | `quality.ack` |
| GET | `/api/quality/export?targetType=&format=csv&from=&to=` | `quality.view` |
| GET | `/api/stations/:id/probes` | `stations.view` |
| POST | `/api/stations/:id/probes` | `stations.edit` |
| PATCH/DELETE | `/api/station-probes/:id` | `stations.edit` |
| POST | `/api/station-probes/:id/enable` | `stations.edit` |
| POST | `/api/station-probes/:id/disable` | `stations.edit` |

- Scope all/subtree/own; kiểm tra ở server, không chỉ ẩn UI.
- Trạm: scope theo `owner_web_user_id` của station/mountpoint.
- Relay: scope theo `owner_web_user_id` của relay job.
- Response không chứa payload RTCM, credential, DSN.
- Export CSV có giới hạn dòng + audit.

### 7.2. Internal (Go, HMAC)

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/internal/rtcm/snapshot` | Snapshot RAM 1 s cho station + relay |
| GET | `/internal/rtcm/health` | Analyzer queue/drop/parse errors |

### 7.3. Socket.IO

- Auth bằng session cookie; room `station:<id>`/`relay:<id>` sau kiểm tra quyền.
- Event: `quality.snapshot`, `quality.updated`, `quality.alert`, `quality.alert.ack`.
- Payload có `targetType`, `targetId`, `direction`, `score`, `ts`.
- Throttle ~1 s; reconnect snapshot để đồng bộ.
- Đổi role/ownership: cập nhật room/ngắt socket.

## 8. FE quản trị realtime

- Menu mới: **Chất lượng** với hai tab **Trạm** và **Relay**.
- Tab Trạm:
  - Tổng quan trạm: score, mất MSM/metadata, alert mở.
  - Chi tiết: score, message type/rate, sat/cell, CNR, age/gap.
  - Metadata: station ID, ARP, antenna, ARP jump.
- Tab Relay:
  - Tổng quan relay: score upstream/downstream, parity, alert.
  - Chi tiết: hai luồng upstream/downstream, so sánh type/rate.
- Alert list/filter/ack; loading/empty/error; responsive 1440/768/390.
- Taste `inspect.mjs --app` 0 FAIL; test luồng + a11y.

## 9. Phase 6 — Tasks

| ID | Task | Phụ thuộc |
|---|---|---|
| P6-01 | Thêm go-rtcm; parser bounded; test frame/type/CRC | Phase 3 |
| P6-02 | Mô hình quality chung station/relay + score + baseline | P6-01 |
| P6-03 | Nguồn station: caster ingest + station probe GET-only | P6-02, Phase 4 (ingest) |
| P6-04 | Internal snapshot + Node REST + RBAC + Socket.IO | P6-02, Phase 5 |
| P6-05 | FE chất lượng Trạm + Relay realtime | P6-04 |
| P6-06 | Alert debounce/ack/export + retention | P6-04 |
| P6-07 | Test/hardening, load, license, tài liệu | P6-05 |

## 10. Test plan

| ID | Nội dung | Kỳ vọng |
|---|---|---|
| 6-T1 | Parse 1005/1006/1007/1008/1077/1087/1097/1127/1230 | Đúng type/field chính |
| 6-T2 | CRC sai, length sai, truncated, unknown type | Đếm lỗi, không panic |
| 6-T3 | Byte-in == byte-out khi analyzer chạy | Không sửa byte, không chặn |
| 6-T4 | Mảnh read, nhiều frame/read, queue đầy | Không block relay/caster |
| 6-T5 | Score: đủ/thiếu MSM, CNR thấp, age cao | Điểm đúng công thức |
| 6-T6 | Station ID mismatch, ARP jump, thiếu 1005/1006 | Alert đúng, debounce |
| 6-T7 | Relay upstream vs downstream mất type/rate | Phát hiện suy giảm relay |
| 6-T8 | Station ingest (caster) + station probe GET-only | Chất lượng trạm đúng; probe không tạo downstream |
| 6-T9 | DB down/up, Go restart | Không chặn RTCM; flush có giới hạn |
| 6-T10 | API/RBAC scope station + relay | Không lộ ngoài scope |
| 6-T11 | Socket auth/room/throttle/đổi quyền | Đúng quyền, <2 s |
| 6-T12 | FE Trạm/Relay realtime, loading/empty/error, a11y | 0 FAIL + luồng đúng |
| 6-T13 | 50–100 job/station, retention, secret scan, license | Không crash; không lộ secret |

## 11. Rủi ro & giới hạn

- Parse RTCM tốn CPU; dùng bounded queue, sampling, không parse lại toàn bộ.
- go-rtcm không hỗ trợ đầy đủ mọi type; unknown chỉ đếm.
- MSM4/5/6 thiếu CNR → score dùng completeness, ghi rõ `cnr_available`.
- Station probe tạo thêm kết nối tới trạm; mặc định tắt, chỉ endpoint được phép,
  mock-first; tránh trùng với caster ingest.
- Không phát hiện tuyệt đối vòng relay xuyên hệ thống ngoài.
- Chất lượng phụ thuộc baseline; trạm/job mới cần thời gian warm-up.
- Không auto-disable job/probe; admin quyết định.
- Dữ liệu vị trí trạm là metadata; vẫn lọc theo scope khi hiển thị/export.
- License go-rtcm Apache-2.0: xác minh lại trước phân phối.

## 12. Phụ thuộc & triển khai

- P6-01/P6-02 có thể bắt đầu sau Phase 3.
- P6-03 cần Phase 4 cho caster ingest; station probe có thể làm sớm hơn.
- P6-04/P6-05 cần Socket.IO/realtime của Phase 5.
- Migration dự kiến: `runtime/<next>_rtcm_quality.sql`,
  `admin/<next>_quality_permissions.sql` (permission + `station_probes`).
  `<next>` chốt sau migration Phase 4/5; không trùng version đã có (admin 003 đã dùng).
- Cập nhật `docs/api.md`, `TASKS.md`, `SESSION.md` khi triển khai.
