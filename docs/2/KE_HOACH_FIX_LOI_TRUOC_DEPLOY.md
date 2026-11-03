# KẾ HOẠCH SỬA LỖI TRƯỚC DEPLOY

- **Dự án:** Hệ thống quản lý trạm CORS/NTRIP/RTCM (`29102026_Quanlytram`)
- **Thời điểm lập:** 2026-11-02 (Asia/Ho_Chi_Minh, +07:00)
- **Commit nền:** `5f349fe` (`fix(health): chống crash khi payload cũ thiếu trường RSS`)
- **Nguồn dữ liệu:**
  1. Khảo sát mã nguồn + chạy kiểm chứng runtime ngày 2026-11-02 (Docker Compose local, đọc-only).
  2. Rà soát lại `docs/2/BAO_MAT_MA_NGUON.md` (báo cáo lập 2026-11-01, commit nền `b5763fd`) tại commit hiện tại.
- **Tính chất:** tài liệu kế hoạch. **Không sửa mã nguồn, không tạo migration, không đổi cấu hình.**
- **Quy ước mức:**
  - **Blocker:** chặn deploy, gây lỗi chức năng hoặc mất dữ liệu/không nhận dữ liệu trạm.
  - **High:** phải sửa trước khi chạy production, có thể gây sự cố vận hành hoặc leo thang quyền.
  - **Medium:** sửa trong đợt hardening trước cutover.
  - **Low:** hardening tùy chọn, không chặn deploy.
- **Nguyên tắc:** mock-first, không test với endpoint NTRIP công cộng chưa được phép, không chạm cổng `2101`/`8081`, không log secret.

---

## 1. Bảng tổng hợp ưu tiên

### 1.1. Lỗi chức năng/vận hành phát hiện trong phiên khảo sát

| ID | Mức | Vùng | Vị trí | Tóm tắt | Đã xác minh |
|---|---|---|---|---|---|
| FIX-01 | **Blocker** | API mountpoint | `server/src/routes/mountpoints.ts:405-452` | Tìm kiếm mountpoint trả 500 do câu COUNT thiếu JOIN `stations` | Live (500 + log) |
| FIX-02 | **Blocker** | Caster ingest | `gnss/internal/caster/connection.go:137-156` | Source ingest không có read/idle deadline, source im lặng giữ slot vĩnh viễn | Static |
| FIX-03 | **Blocker** | Station source | `gnss/internal/relay/station_source.go:18-20,282` | Idle timeout cứng 30s, thấp hơn nhịp dữ liệu thực tế → reconnect liên tục | Live (timeout mỗi 30s) |
| FIX-04 | **High** | Relay lifecycle | `gnss/internal/relay/manager.go:188-198` | Đổi config chỉ chờ session cũ 2s rồi start job mới → 2 POST cùng downstream | Static |
| FIX-05 | **High** | Caster giới hạn | `gnss/internal/caster/manager.go:27,41-42,444-450`; `gnss/internal/config/config.go:118-119` | Trần 50 kết nối/IP mặc định xung đột fan-in hợp lệ 100 trạm/1 IP | Static |
| FIX-06 | **High** | Caster rover | `gnss/internal/caster/connection.go:117-135` | `ReadString('\n')` không giới hạn độ dài, không deadline → cạn RAM | Static |
| FIX-07 | Medium | Relay pause | `server/src/routes/relayJobs.ts:1532,1826`; `server/src/routes/mountpoints.ts:675-690` | Cờ pause bị xoá vô điều kiện ngoài transaction; bỏ `station_id` để lại `paused_by_station_id` treo | Static |
| FIX-08 | Medium | Chất lượng/cảnh báo | `server/src/routes/stations.ts`, `server/src/routes/relayJobs.ts` (không resolve alert) | Xoá trạm/relay không resolve `quality_alerts` → 678 cảnh báo treo | Live (DB) |
| FIX-09 | Medium | Realtime | `server/src/realtime/data.ts:100-121`, `filter.ts` | Go internal timeout → danh sách relay rỗng thay vì fallback DB | Static |
| FIX-10 | Medium | Lịch sử relay | `server/src/routes/relayJobs.ts:1013-1020` | Lấy quality sample không lọc `direction` → sinh event "state changed" giả | Static |
| FIX-11 | Medium | Caster hub | `gnss/internal/caster/manager.go:494-505` | Source ngắt kết nối đóng toàn bộ rover ngay, không có grace | Static |
| FIX-12 | Medium | Reconcile | `gnss/internal/probe/manager.go:165`; `gnss/internal/relay/station_source.go:425` | `context.WithCancel(m.rootCtx)` có thể nil nếu Reconcile gọi trước `Run` | Static |
| FIX-13 | Medium | Relay config | `gnss/internal/relay/store.go:118-144` | Một credential không giải mã được làm `LoadAll` fail toàn bộ | Static |
| FIX-14 | Medium | Relay routing | `gnss/internal/relay/manager.go` (kiểm tra duplicate) | Chỉ chặn trùng cặp upstream/downstream; 2 job cùng downstream vẫn được tạo | Static |
| FIX-15 | Low | Relay metrics | `gnss/internal/relay/job.go:87-88,137`; `server/src/realtime/socket.ts:421-423` | Monitor không reset giữa session; backoff reset sau sleep; `lastSessionId=MAX(id)` làm mất event khi burst | Static |
| FIX-16 | Low | Timeline/uptime | `server/src/lib/statusTimeline.ts:101-113`; `server/src/lib/dataUptime.ts:83-88,126-133` | Bucket nhìn trước; mẫu số uptime tính cả khoảng chưa có dữ liệu | Static |

### 1.2. Lỗi bảo mật còn tồn tại (rà soát lại `BAO_MAT_MA_NGUON.md`)

| ID gốc | Mức hiện tại | Trạng thái tại `5f349fe` | Quyết định |
|---|---|---|---|
| F-02 | **High (production)** | Còn (seed vẫn `status='active'`, ghi đè role/company) | Sửa trước deploy |
| F-04 | **High** | Còn (tái dùng `client_password_enc` cho host tùy ý) | Sửa trước deploy |
| F-07 | **High** | Còn (import bỏ qua `assertCanTarget`) | Sửa trước deploy |
| F-01 | Medium | Còn (`123456`, chưa có buộc đổi lần đầu) | Sửa trước deploy |
| F-06 | High | **Một phần**: đã có trần tổng 500; vẫn thiếu throttle xác thực sai; trần 50/IP phản tác dụng | Sửa (xem FIX-05) |
| F-03 | Medium–High nếu Internet | Còn (caster plaintext, publish `0.0.0.0:1509/1508`) | Sửa theo mô hình triển khai |
| F-10 | Medium (production) | Còn (`SESSION_COOKIE_SECURE=false`, không fail-fast) | Sửa trước deploy |
| F-13 | Medium | Còn (`writeAudit` nuốt lỗi; không audit login) | Sửa trước deploy |
| F-09 | Medium | Còn (`trust proxy=1` vô điều kiện) | Sửa trước deploy |
| F-18 | Low–Medium | Còn (lộ trạng thái tài khoản, lệch thời gian) | Nên sửa cùng F-09/F-13 |
| F-19 | Low | Còn (`/health` trả `err.message`) | Sửa nhanh |
| F-08 | Low | Còn (mapConfig thiếu CSRF) | Sửa nhanh |
| F-14 | Low | Còn (Go HTTP thiếu Read/Write/Idle timeout) | Sửa nhanh |
| F-15 | Low | Còn (tile không permission riêng) | Sửa nhanh |
| F-05 | Low (cần quyền ghi DB) | Còn (AES-GCM không AAD, không rotation) | Sửa khi làm multi-tenant mạnh |
| F-21 | Low | Còn (audit scope `own` dùng subtree) | Sửa nhanh |
| F-12 | Low (Medium nếu DB ngoài host) | Còn (MySQL không TLS) | Chỉ sửa khi DB ra ngoài host |
| F-11 | Low (dev) / Medium (prod) | Còn (compose chạy Vite dev) | Chỉ sửa khi đóng gói production |
| **F-16** | Low | **Đã sửa** (tick truyền `tenantIds`) | Đóng |
| F-17, F-20, F-22, F-23 | Info/Low | Không phải lỗi chặn deploy | Bỏ qua theo yêu cầu |

> Ghi chú: các mục F-17 (port tùy ý), F-20 (chính sách mật khẩu), F-22 (secret trên máy dev), F-23 (chưa quét CVE) không đưa vào phạm vi sửa đợt này; giữ nguyên trong báo cáo bảo mật làm việc vận hành định kỳ.

### 1.3. Trạng thái thực hiện (cập nhật liên tục)

Bảng đầy đủ 34 mục nằm tại `docs/2/THUC_HIEN_FIX_LOI.md`; dưới đây chỉ ghi các mục đã xong.

| ID | Trạng thái | Lô | Ngày (+07) | Bằng chứng |
|---|---|---|---|---|
| FIX-01 | Đã sửa | C1 | 2026-11-03 | vitest 22 file/130 PASS; live `q=DOCS` → 200, `total=4`; không `q` → `total=8` |
| FIX-02 | Đã sửa | C2 | 2026-11-03 | `go test ./internal/caster` PASS; 2 test idle/active |
| FIX-03 | Đã sửa | C2 | 2026-11-03 | `go test ./internal/relay ./internal/config` PASS; cadence 60ms/150ms, mặc định 120s, sàn 30s |
| FIX-04 | Đã sửa | C3 | 2026-11-03 | `TestWaitJobDone*` PASS; `StopTimeout` 15s, hoãn start khi phiên cũ chưa đóng |
| FIX-05 | Đã sửa | C3 | 2026-11-03 | per-IP mặc định 200, trần tổng 500; `TestDefaultPerIPLimitAllowsValidFanIn` PASS |
| FIX-06 | Đã sửa | C3 | 2026-11-03 | rover 1 KB, idle 5 phút, `recover()`; 2 test rover PASS |
| SEC-F02 | Đã sửa | C4 | 2026-11-03 | `ON DUPLICATE KEY UPDATE id=id`; `seedUser.test.ts` PASS |
| SEC-F04 | Đã sửa | C4 | 2026-11-03 | credential gắn host/port/TLS; chặn SSRF; test outbound/sourceTarget PASS |
| SEC-F07 | Đã sửa | C4 | 2026-11-03 | `assertCanTarget` từng dòng + giới hạn field + audit diff |
| SEC-F01 | Đã sửa | C5 | 2026-11-03 | migration admin 36; live 403 → đổi mật khẩu → 200 (`qa_mustchange`) |
| SEC-F10 | Đã sửa | C6 | 2026-11-03 | fail-fast production; `__Host-`; HSTS; configSecurity PASS |
| SEC-F13 | Đã sửa | C6 | 2026-11-03 | audit retry + fail-closed; login success/fail/logout; audit.test PASS |
| SEC-F09 | Đã sửa | C6 | 2026-11-03 | `TRUST_PROXY` mặc định tắt; cookie name dùng chung socket |
| SEC-F18 | Đã sửa | C6 | 2026-11-03 | dummy Argon2 + `INVALID_CREDENTIALS` thống nhất |
| SEC-F06 | Đã sửa | C7 | 2026-11-03 | throttle (username,IP) + toàn cục; 2 test PASS |
| SEC-F03 | Đã sửa | C7 | 2026-11-03 | compose bind 127.0.0.1; TLS listener tùy chọn; go test PASS |
| FIX-07 | Đã sửa | C8 | 2026-11-03 | resume có FOR UPDATE; reset pause khi đổi station |
| FIX-08 | Đã sửa | C8 | 2026-11-03 | resolve alert khi xoá + purge mồ côi lúc khởi động |
| FIX-09 | Đã sửa | C8 | 2026-11-03 | fallback `relay_job_state`, `stale` + banner |
| FIX-10 | Đã sửa | C8 | 2026-11-03 | lọc `direction`, mặc định upstream; test PASS |
| FIX-11 | Đã sửa | C9 | 2026-11-03 | grace 10s giữ rover; 2 test PASS |
| FIX-12 | Đã sửa | C9 | 2026-11-03 | `rootContext()` + recover API; 2 test PASS |
| FIX-13 | Đã sửa | C9 | 2026-11-03 | bỏ qua job lỗi credential, `relayDegraded` |
| FIX-14 | Đã sửa | C9 | 2026-11-03 | 409 `DOWNSTREAM_BUSY`; test duplicate PASS |
| FIX-15 | Đã sửa | C10 | 2026-11-03 | reset monitor/backoff/cursor; test PASS |
| FIX-16 | Đã sửa | C10 | 2026-11-03 | framesAt `[at-window, at)`; mẫu số quan sát |
| SEC-F08 | Đã sửa | C11 | 2026-11-03 | CSRF mapConfig sau requireAuth |
| SEC-F15 | Đã sửa | C11 | 2026-11-03 | tile cần `map.view` + rate-limit 240/phút |
| SEC-F19 | Đã sửa | C11 | 2026-11-03 | `/health` không trả `err.message` |
| SEC-F21 | Đã sửa | C11 | 2026-11-03 | `idsForScope('own')` = `[userId]`; test PASS |

---

## 2. Chi tiết lỗi chức năng cần sửa

### FIX-01 [Blocker] Tìm kiếm mountpoint trả 500

**Vị trí:** `server/src/routes/mountpoints.ts:405-452` (route `GET /api/mountpoints`).

**Hiện tượng / bằng chứng**
- Khi có `q`, điều kiện WHERE thêm `(m.name LIKE ? OR s.name LIKE ?)`.
- Câu đếm dùng `SELECT COUNT(*) AS total FROM mountpoints m WHERE ${where}` — không JOIN `stations` → MySQL báo `Unknown column 's.name' in 'where clause'`.
- Đã tái hiện live: `GET /api/mountpoints?page=1&pageSize=10&q=DOCS` → **500**; log server: `[api] unhandled error Unknown column 's.name' in 'where clause'`.
- Trang `frontend/src/pages/Mountpoints.tsx` gửi `q` qua `listQuery`, nên gõ tìm kiếm là hỏng danh sách.

**Cách sửa**
- Thêm `LEFT JOIN stations s ON s.id = m.station_id` vào câu COUNT (đồng bộ với câu SELECT), hoặc tách điều kiện tìm kiếm thành subquery `EXISTS`.
- Rà soát các route khác có cùng mẫu "WHERE tham chiếu alias không có trong FROM" (đặc biệt các route có phân trang + join).

**Nghiệm thu**
- `GET /api/mountpoints?q=<từ khoá>` trả 200, `total` khớp số dòng lọc.
- Tìm theo tên trạm và tên mountpoint đều đúng; không đổi kết quả khi không có `q`.

**Test**
- Unit/integration: mock DB hoặc DB test, tạo 2 trạm + 3 mountpoint, tìm theo tên trạm → `total=2`.
- Playwright: mở trang Mountpoint, gõ từ khoá, bảng không hiện lỗi.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C1.**
- File: `server/src/lib/mountpointList.ts` (mới), `server/src/routes/mountpoints.ts`,
  `server/tests/mountpointList.test.ts` (mới).
- Cách sửa: tách câu COUNT thành `mountpointCountSql()` có
  `LEFT JOIN stations s ON s.id = m.station_id`, đồng bộ với câu SELECT.
  Đã rà 13 route có `COUNT(*) AS total`: chỉ mountpoint thiếu JOIN; stations,
  relayJobs, alerts, audit, webUsers… đều dùng đúng alias trong FROM.
- Test: `cd server; npm run build; npm test` → 22 file / 130 test PASS.
- Live (server restart): `GET /api/mountpoints?page=1&pageSize=10&q=DOCS`
  → 200, `total=4`; không `q` → 200, `total=8`.

---

### FIX-02 [Blocker] Caster ingest không có idle timeout

**Vị trí:** `gnss/internal/caster/connection.go:137-156` (`sourceReadLoop`).

**Hiện tượng**
- `listener.go:52-54` đặt deadline cho header rồi xoá (`SetReadDeadline(time.Time{})`).
- `sourceReadLoop` đọc vô hạn, không đặt lại deadline. Một source giữ TCP nhưng không gửi byte sẽ giữ slot SOURCE của mountpoint mãi mãi; rover nhận dữ liệu cũ hoặc không nhận.
- Relay upstream và station-source đã có idle timeout (60s/30s), caster thì chưa.

**Cách sửa**
- Thêm `IdleTimeout` cho caster source (mặc định 60s, cấu hình `CASTER_SOURCE_IDLE_TIMEOUT_SEC`), `SetReadDeadline` mỗi vòng đọc, đóng với lý do `timeout`.
- Giữ TCP keepalive 30s đã có; chỉ áp cho source, rover dùng timeout riêng nếu cần.

**Nghiệm thu**
- Mock source gửi 1 byte rồi im lặng → kết nối bị đóng sau timeout, slot được giải phóng, source mới kết nối được.
- Source gửi đều 1s → không bị đóng.

**Test:** Go unit test với `net.Pipe`; chạy `go test ./internal/caster`.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C2.**
- Thêm `caster.Options.SourceIdleTimeout` (mặc định 60s, sàn 5s),
  `CASTER_SOURCE_IDLE_TIMEOUT_SEC`; `sourceReadLoop` đặt `SetReadDeadline`
  mỗi vòng đọc và đóng với lý do `timeout`.
- Test: `TestSourceReadLoopClosesIdleSource`, `TestSourceReadLoopKeepsActiveSource`
  PASS; `go test ./internal/caster` PASS.

---

### FIX-03 [Blocker] Station source idle timeout 30s gây reconnect liên tục

**Vị trí:** `gnss/internal/relay/station_source.go:18-20,282`; `gnss/internal/config/config.go` (chưa có biến cấu hình).

**Hiện tượng / bằng chứng live**
- `defaultStationIdleTimeout = 30 * time.Second`, không đọc từ env.
- Trạm 480 (`TestHauLoc`, pull `rtktk.online`) nhận 1 burst rồi im lặng; session kết thúc `timeout` đúng 30s, reconnect sau 1s: 5 session/10 phút (`station_source_sessions` id 64-67).
- Quality sample chỉ 2 byte/0 frame mỗi phút; timeline 24h `current=no_data`.
- Nhịp dữ liệu thực tế ~60s/lần → timeout 30s luôn cắt kết nối.

**Cách sửa**
- Đưa timeout thành cấu hình `STATION_SOURCE_IDLE_TIMEOUT_SEC` (mặc định 90–120s, đủ cho trạm nhịp 60s), clamp tối thiểu 30s.
- Không tính NMEA/keepalive là dữ liệu RTCM khi đánh giá "no data" (nếu đang tính).
- Ghi log kèm `station_id`, timeout, thời điểm byte cuối; tránh log mật khẩu.

**Nghiệm thu**
- Trạm nhịp 60s không bị ngắt; session kéo dài > 5 phút.
- Trạm chết thật bị đóng trong khoảng timeout cấu hình.
- `current` trên timeline không còn nhảy `no_data` liên tục với trạm có dữ liệu.

**Test:** Go unit test cadence 60s với idle 120s PASS; cadence 1s PASS; không gửi gì → timeout.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C2.**
- `defaultStationIdleTimeout` 30s → 120s; thêm `STATION_SOURCE_IDLE_TIMEOUT_SEC`
  (mặc định 120s, sàn 30s) trong `gnss/internal/config`.
- Log timeout kèm `station_id`, tên trạm, ngưỡng và thời điểm byte cuối;
  không log mật khẩu.
- Test: `TestStationSourceIdleTimeoutDefault`, `TestRunStationSourceKeepsSlowCadence`,
  `TestStationSourceIdleTimeoutClamp` PASS; test timeout cũ vẫn PASS.

---

### FIX-04 [High] Restart relay khi đổi config chỉ chờ 2 giây

**Vị trí:** `gnss/internal/relay/manager.go:188-198`.

**Hiện tượng**
- `job.stop("config_changed")` rồi `select { case <-job.done: case <-time.After(2s) }` và start job mới bất kể session cũ đã thoát chưa.
- `RunSession` có thể còn sống tới 60s (idle) hoặc 10s (write); hai POST cùng downstream → caster trả `409 source_busy`, job mới vào backoff, `relay_job_state` bị ghi đua.

**Cách sửa**
- Chờ `job.done` không giới hạn ngắn; nếu quá hạn (ví dụ 15s) thì log cảnh báo và **không** start job mới cho tới khi session cũ đóng, hoặc huỷ cứng context và đợi đóng socket.
- Đảm bảo chỉ một writer ghi `relay_job_state` cho mỗi job; dùng revision tăng dần.

**Nghiệm thu**
- Đổi config liên tiếp 10 lần không sinh 2 session song song; không có `409 source_busy` trong log.
- `relay_sessions` không có 2 dòng chồng thời gian cho cùng job.

**Test:** Go test với mock downstream từ chối kết nối thứ hai; kiểm tra số session.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C3.**
- Bỏ chờ cứng 2s: thêm `Options.StopTimeout` (mặc định 15s) và
  `Manager.waitJobDone`; hết hạn thì log cảnh báo và **hoãn start** (continue),
  reconcile vòng sau thử lại, không mở phiên thứ hai ghi cùng downstream.
- Test: `TestWaitJobDoneReturnsTrueWhenSessionClosed`,
  `TestWaitJobDoneHonorsTimeout` PASS.

---

### FIX-05 [High] Trần 50 kết nối/IP chặn fan-in hợp lệ

**Vị trí:** `gnss/internal/caster/manager.go:27,41-42,444-450`; `gnss/internal/config/config.go:118-119`.

**Hiện tượng**
- `MaxConnectionsPerIP` mặc định 50, áp cho **mọi** kết nối (source + rover) trước khi phân biệt thành công/thất bại.
- Theo bối cảnh đã chốt trong `BAO_MAT_MA_NGUON.md` §1.4: 100 trạm từ một hệ thống nguồn là hợp lệ; không giới hạn theo IP.

**Cách sửa**
- Bỏ trần per-IP cho kết nối thành công, hoặc nâng mặc định ≥ 200 và chỉ áp sau khi xác thực.
- Giữ trần tổng 500 (cấu hình được) và trần theo account/mountpoint.
- Throttle riêng **xác thực sai** theo cặp (username, IP) + tổng toàn cục (xem F-06 của báo cáo bảo mật).

**Nghiệm thu**
- Mock 150 source hợp lệ từ cùng IP dưới trần tổng → tất cả được nhận.
- 20 lần sai liên tiếp cùng username+IP → backoff; IP/username khác không ảnh hưởng.
- Vượt trần tổng → 503 sớm, RAM ổn định.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C3.**
- Nâng mặc định `MaxConnectionsPerIP` 50 → 200 (đủ fan-in 100 trạm/IP),
  giữ trần tổng 500; cập nhật `.env.example` và `config.go`.
- Throttle xác thực sai theo (username, IP) nằm ở SEC-F06 (Đợt 3).
- Test: `TestDefaultPerIPLimitAllowsValidFanIn` PASS; test trần per-IP cũ
  (`TestRegisterEnforcesPerIPLimit`) vẫn PASS.

---

### FIX-06 [High] Rover đọc dòng không giới hạn → cạn RAM

**Vị trí:** `gnss/internal/caster/connection.go:117-135` (`roverReadLoop`).

**Hiện tượng**
- `c.br.ReadString('\n')` không giới hạn kích thước và không có deadline. Client gửi dữ liệu không có `\n` → buffer tăng tới OOM; không có `recover()` bao ngoài nên panic có thể làm chết cả service (mất mọi relay/station).
- Header đã giới hạn 16 KB nhưng chỉ trong handshake.

**Cách sửa**
- Dùng `bufio.Scanner` với `Buffer(..., MaxLine)` hoặc `ReadSlice` + đếm, giới hạn dòng NMEA (ví dụ 1 KB); vượt → đóng `protocol_error`.
- Đặt read deadline cho rover (ví dụ 5 phút không dữ liệu) hoặc chỉ deadline khi đọc dở.
- Thêm `recover()` ở goroutine connection để lỗi một client không làm chết process.

**Nghiệm thu**
- Client gửi 10 MB không newline → kết nối bị đóng, RSS không tăng vọt.
- Client gửi GGA hợp lệ vẫn cập nhật `fixType`.
- Các kết nối khác không bị ảnh hưởng khi một client lỗi.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C3.**
- `roverReadLoop` dùng `ReadSlice('\n')`, giới hạn dòng 1 KB → vượt đóng
  `protocol_error`; thêm `RoverIdleTimeout` 5 phút
  (`CASTER_ROVER_IDLE_TIMEOUT_SEC`).
- Thêm `recover()` ở goroutine connection: panic một client chỉ đóng kết nối,
  không làm chết service.
- Test: `TestRoverReadLoopRejectsOversizedLine` (10 KB không newline),
  `TestRoverReadLoopUpdatesFixType` PASS; `go test ./internal/caster` PASS.

---

### FIX-07 [Medium] Cờ pause relay bị ghi đè / treo tham chiếu

**Vị trí:** `server/src/routes/relayJobs.ts:1532,1826`; `server/src/routes/mountpoints.ts:675-690`.

**Hiện tượng**
- Resume/enable relay xoá cả `paused_by_station_id` và `paused_by_mountpoint_id` vô điều kiện, không kiểm tra `locked`, không khoá dòng (`SELECT ... FOR UPDATE`) → ghi đè pause vừa được trạm/mountpoint set.
- PATCH mountpoint bỏ `station_id` nhưng giữ `pausedBy` cũ → trạm cũ resume sẽ bật lại mountpoint đã tách.

**Cách sửa**
- Chỉ xoá cờ pause đúng nguồn (station hay mountpoint) và chỉ khi `locked=0`; dùng transaction + `FOR UPDATE`.
- Khi `station_id` chuyển sang null/khác, reset `paused_by_station_id` tương ứng.
- Giữ nguyên `desired_revision` tăng khi pause/resume để Go reconcile đúng.

**Nghiệm thu**
- Test đua: pause station trong lúc resume relay → relay vẫn `paused`.
- Bỏ station khỏi mountpoint → không còn `paused_by_station_id` treo.
- Ma trận trạng thái relay vẫn PASS 14 test hiện có.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C8.**
- Thêm `resumeRelayJob()` dùng transaction + `SELECT ... FOR UPDATE`; chỉ bật
  lại và xoá cờ khi trạm/mountpoint nguồn không còn chặn, ngược lại giữ `enabled=0`.
- Áp dụng cho enable đơn lẻ và bulk enable.
- PATCH mountpoint: đổi/bỏ `station_id` thì reset `paused_by_station_id`.
- Test: server build + 148 test PASS.

---

### FIX-08 [Medium] Quality alert không được resolve khi xoá trạm/relay

**Vị trí:** `server/src/routes/stations.ts` (xoá trạm), `server/src/routes/relayJobs.ts` (soft-delete job); không có câu UPDATE `quality_alerts.resolved_at`.

**Hiện tượng / bằng chứng live**
- 692 alert chưa resolve; **678** thuộc relay job đã xoá, **9** thuộc trạm không còn tồn tại; phần lớn từ 2026-10-30.
- API `GET /api/quality/alerts` trả `total=692` → trang chất lượng nhiễu, dashboard khó đọc.

**Cách sửa**
- Khi soft-delete relay/station hoặc xoá cứng: set `resolved_at = UTC_TIMESTAMP(3)` cho alert đang mở của target đó (kèm audit).
- Bổ sung job dọn alert mồ côi định kỳ (target không còn tồn tại) hoặc lọc mặc định theo target còn sống.
- Cân nhắc thêm cột `resolution`/`resolved_reason` để phân biệt tự resolve và ack.

**Nghiệm thu**
- Xoá 1 relay có alert mở → alert chuyển resolved, `total` giảm tương ứng.
- Chạy dọn alert mồ côi trên DB test → 0 alert trỏ target không tồn tại.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C8.**
- `lib/qualityAlerts.ts`: resolve alert khi xoá trạm/relay (đơn lẻ và bulk),
  thêm `purgeOrphanQualityAlerts()` chạy lúc khởi động.
- Audit ghi thêm `resolvedAlerts` (không chứa secret).
- Test: server build + 148 test PASS.

---

### FIX-09 [Medium] Realtime mất toàn bộ relay khi Go timeout

**Vị trí:** `server/src/realtime/data.ts:100-121`; `server/src/realtime/filter.ts:170-191`.

**Hiện tượng**
- Snapshot relay lấy từ `/internal/snapshot`; lỗi/timeout → `relay=[]` và `goOk=false`, nhưng filter không fallback sang `relay_job_state` trong DB.
- UI realtime làm relay "biến mất" thay vì hiển thị trạng thái gần nhất/offline.

**Cách sửa**
- Khi `goOk=false`, dùng `relay_job_state` + cấu hình job để dựng snapshot tối thiểu, đánh dấu `stale=true`.
- UI hiển thị banner "mất kết nối Go, dữ liệu có thể cũ" và không xoá marker/row.
- Cache snapshot cuối cùng có TTL ngắn (ví dụ 10s) để chống nhấp nháy.

**Nghiệm thu**
- Mock Go timeout → danh sách relay giữ nguyên số lượng, badge `stale`.
- Go phục hồi → dữ liệu cập nhật lại, banner mất.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C8.**
- Khi Go timeout: dựng `relay` từ `relay_job_state` (jobs đang có), đặt
  `stale=true`; filter chuyển cờ vào snapshot.
- UI Layout hiện banner "Mất kết nối Go, dữ liệu relay có thể cũ" và giữ row.
- Test: `realtime.test.ts` thêm test giữ cờ stale + đủ job; 148 test PASS.

---

### FIX-10 [Medium] History relay trộn upstream/downstream

**Vị trí:** `server/src/routes/relayJobs.ts:1013-1020`.

**Hiện tượng**
- Câu lấy `quality_samples` chỉ lọc `target_type='relay_job' AND target_id=?`, thiếu `direction`; hai dòng upstream/downstream cùng `ts` tạo event "state changed" giả và làm sai đồ thị score.
- Route station detail đã lọc `direction='ingest'`, nên không đồng bộ.

**Cách sửa**
- Thêm tham số `direction` (mặc định `upstream`), hoặc trả series riêng cho từng chiều.
- UI hiển thị 2 series hoặc bộ lọc chiều rõ ràng.

**Nghiệm thu**
- Job có cả 2 chiều: số event "state changed" bằng số lần đổi trạng thái thật.
- API trả đúng series theo `direction`.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C8.**
- Thêm query `direction` (mặc định `upstream`) cho `quality_samples`; response
  trả kèm `direction`.
- Test: `historyDirection.test.ts` PASS.

---

### FIX-11 [Medium] Source ngắt → đóng toàn bộ rover ngay

**Vị trí:** `gnss/internal/caster/manager.go:494-505`.

**Hiện tượng**
- `removeSource` trả toàn bộ rover và đóng với `source_disconnected`; mỗi lần upstream/relay restart (hoặc timeout) đá toàn bộ rover, gây reconnect storm.
- Chưa có grace window để source mới lên thay.

**Cách sửa**
- Thêm grace 5–15s: giữ rover, chờ source mới; hết hạn mới đóng.
- Trong thời gian chờ, rover nhận `ICY 200` nhưng không có dữ liệu (không gửi byte rác).
- Cấu hình `CASTER_SOURCE_GRACE_SEC`.

**Nghiệm thu**
- Source ngắt rồi kết nối lại trong grace → rover giữ nguyên session.
- Quá grace → rover đóng đúng lý do.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C9.**
- Thêm `SourceGrace` (mặc định 10s, `CASTER_SOURCE_GRACE_SEC`); source ngắt
  thì detach, giữ rover, hết grace mà chưa có source mới mới đóng
  `source_disconnected`.
- Test: `TestHubDetachSourceKeepsRoversForGrace`,
  `TestSourceGraceClosesRoverAfterTimeout` PASS.

---

### FIX-12 [Medium] Nguy cơ panic khi reconcile trước Run

**Vị trí:** `gnss/internal/probe/manager.go:165`; `gnss/internal/relay/station_source.go:425`.

**Hiện tượng**
- `context.WithCancel(m.rootCtx)` với `rootCtx=nil` sẽ panic nếu endpoint `/internal/.../reconcile` được gọi trước khi `Run` gán `rootCtx`.
- `relay/manager.go:84` đã có guard `Background`, hai module kia chưa.

**Cách sửa**
- Trong `Run`, gán `rootCtx` mặc định `context.Background()`; hoặc trong Reconcile kiểm tra nil và dùng `Background`.
- Thêm `recover()` ở HTTP internal handler để trả 500 thay vì chết process.

**Nghiệm thu**
- Gọi reconcile trước Run không panic; trả kết quả hợp lệ.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C9.**
- Thêm `rootContext()` cho probe và station-source: trả `Background` khi chưa
  `Run`; reconcile dùng context đó thay vì `m.rootCtx` nil.
- Thêm `recoverHandler` bao toàn bộ internal API: panic trả 500 thay vì chết process.
- Test: `TestReconcileBeforeRunDoesNotPanic`,
  `TestStationSourceReconcileBeforeRunDoesNotPanic` PASS.

---

### FIX-13 [Medium] Một credential lỗi làm hỏng toàn bộ cấu hình relay

**Vị trí:** `gnss/internal/relay/store.go:118-144`.

**Hiện tượng**
- `LoadAll` decrypt từng credential; một dòng lỗi (`return nil, err`) làm toàn bộ danh sách job không tải được → mọi thay đổi cấu hình ngừng áp dụng (session đang chạy vẫn sống), log lặp mỗi 10s.

**Cách sửa**
- Bỏ qua dòng lỗi, log `relay_job_id` + lý do (không log ciphertext), tiếp tục các job còn lại.
- Trả cờ `degraded` trong health/internal status để UI cảnh báo.

**Nghiệm thu**
- 1 credential hỏng + 5 job tốt → 5 job vẫn reconcile; health báo `degraded`.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C9.**
- `LoadAll` bỏ qua job lỗi credential, log `job id + lý do` (không log ciphertext),
  đặt cờ `Degraded()`; health Go trả `relayDegraded: true` khi có job bị bỏ.
- Test: Go build/vet/test PASS (hành vi DB kiểm bằng log + cờ, không cần DB test).

---

### FIX-14 [Medium] Cho phép 2 job ghi cùng downstream

**Vị trí:** `gnss/internal/relay/manager.go` (kiểm tra duplicate/loop).

**Hiện tượng**
- Chỉ chặn cặp `(upstream, downstream)` trùng; hai job khác upstream nhưng **cùng downstream** vẫn được tạo → caster chỉ cho 1 source/mountpoint, job thứ hai lỗi `409` và backoff vô hạn.

**Cách sửa**
- Chặn trùng `downstream_key` (trừ khi downstream là chế độ cho phép fan-in có kiểm soát).
- API trả 409 rõ ràng khi tạo/sửa; UI cảnh báo trước khi lưu.

**Nghiệm thu**
- Tạo job B cùng downstream với job A → 409 `DOWNSTREAM_BUSY`.
- Import file có 2 job cùng downstream → báo lỗi theo dòng, không tạo.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C9.**
- `duplicateJobIDs` chặn cả trùng downstream; API create/update trả 409
  `DOWNSTREAM_BUSY`; import báo lỗi theo dòng khi trùng trong file hoặc với job
  đang bật.
- UI hiện lỗi từ API khi lưu (không cần thêm cảnh báo trước).
- Test: `TestDuplicateJobIDsBlocksSameDownstream` PASS.

---

### FIX-15 [Low] Sai số liệu session relay

**Vị trí:** `gnss/internal/relay/job.go:87-88,137`; `server/src/realtime/socket.ts:421-423`.

- Monitor không `Reset()` giữa session → frame dở của session cũ ghép vào session mới; `SetFrames` cộng dồn nên thống kê `relay_sessions` sai.
- `backoff.Reset()` chạy sau `sleep` → session dài vừa đứt vẫn chờ `RetryMax` (30s).
- `lastSessionId = MAX(id)` nhưng chỉ lấy `LIMIT 200` → burst > 200 làm mất event.

**Cách sửa:** reset monitor khi bắt đầu session; gọi `backoff.Reset()` trước `Next()`; dùng `lastSessionId = max(id) của các dòng đã fetch` + phân trang.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C10.**
- `Monitor.Reset()` xoá cả buffer và counters; gọi trước mỗi `RunSession`.
- `backoff.Reset()` chuyển lên trước `Next()` (relay job và station source).
- Socket chỉ tiến `lastSessionId` tới dòng cuối đã fetch (LIMIT 200), burst lớn
  sẽ lấy tiếp ở tick sau.
- Test: `TestMonitorResetClearsCountersAndBuffer` PASS; Go test PASS.

---

### FIX-16 [Low] Sai lệch timeline/uptime

**Vị trí:** `server/src/lib/statusTimeline.ts:101-113`; `server/src/lib/dataUptime.ts:83-88,126-133`.

- `framesAt` lấy mẫu đầu tiên ≥ mốc → bucket đầu sau gap có thể báo online sớm.
- `totalSec` tính cả khoảng trước khi có dữ liệu → uptime% thấp hơn thực; tổng bucket không khớp summary.
- Relay yêu cầu `up>0 && down>0` cùng key 1s; nếu Go ghi lệch `ts` sẽ ra ~0% uptime.

**Cách sửa:** lấy mẫu trong cửa sổ `[at-window, at)`; mẫu số là thời gian có quan sát; đồng bộ tổng bucket với summary; kiểm tra lệch `ts` của 2 chiều.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C10.**
- `framesAt` chỉ dùng sample đã ghi tại/trước mốc, cửa sổ `[at-window, at)`,
  không nhìn sample tương lai.
- Uptime lấy mẫu số là tổng thời gian quan sát (`observedSec`, chặn theo range),
  nên tổng bucket khớp summary.
- Test: `statusTimeline.test.ts` cập nhật kỳ vọng theo semantics mới; 148 test PASS.

---

## 3. Chi tiết lỗi bảo mật cần sửa (theo `BAO_MAT_MA_NGUON.md`)

### 3.1. Nhóm ưu tiên 1 — sửa trước deploy

#### SEC-F02 [High] Seed ghi đè trạng thái/quyền tài khoản
- **Vị trí:** `server/src/db/seed.ts:127-136`; `docker-compose.yml` command server.
- **Còn tồn tại:** `ON DUPLICATE KEY UPDATE` vẫn đặt `status='active'` và ghi đè `role_id`, `parent_user_id`, `company_id`, `display_name`, `email`.
- **Tác động:** khoá/disable tài khoản seed để ứng phó sự cố → restart là tự mở lại; thay đổi role/company bị revert.
- **Cách sửa:** chỉ `INSERT ... ON DUPLICATE KEY UPDATE id=id` (không đụng cột nghiệp vụ), hoặc gate seed bằng `SEED_ENABLED=true` + `NODE_ENV!=='production'`; audit khi tạo mới.
- **Nghiệm thu:** lock `user1` → chạy seed → vẫn `locked`; đổi role → chạy seed → không đổi.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C4.**
- Tách `server/src/db/seedUser.ts` với `ON DUPLICATE KEY UPDATE id = id`;
  không còn ghi đè status/role/parent/company/display_name/email.
- Audit `seed.user.create` khi tạo mới (không ghi mật khẩu/hash).
- Test: `server/tests/seedUser.test.ts` PASS.

#### SEC-F04 [High] Tái dùng credential trạm cho host khác
- **Vị trí:** `server/src/routes/stations.ts` (`POST /source/mountpoints`, đoạn decrypt `client_password_enc`).
- **Còn tồn tại:** khi có `stationId`, password lấy từ DB và gửi Basic tới `body.host` bất kỳ.
- **Tác động:** người có `stations.add` đổi host sang máy mình kiểm soát → nhận mật khẩu trạm.
- **Cách sửa:** chỉ dùng credential đã lưu khi `host/port/tls` trùng bản ghi `station_sources`; nếu khác, bắt nhập lại mật khẩu. Chặn `169.254.0.0/16`, `127.0.0.0/8`, `::1`, multicast; giữ RFC1918 cho upstream nội bộ. Resolve DNS và kiểm tra toàn bộ IP (chống rebinding). Audit + throttle theo user.
- **Nghiệm thu:** host B khác host A → không gửi credential cũ; `169.254.169.254` bị chặn; RFC1918 vẫn hoạt động.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C4.**
- Chỉ dùng lại credential khi host/port/TLS trùng `station_sources`
  (`lib/sourceTarget.ts`); khác thì trả 400 `SOURCE_CREDENTIAL_MISMATCH`.
- `lib/outbound.ts` chặn loopback/link-local (gồm `169.254.169.254`)/multicast,
  cho phép RFC1918; kết nối bằng chính IP đã kiểm tra (chống rebinding).
- Thêm rate-limit 10/phút theo user, audit `station.source.mountpoints`
  (không ghi mật khẩu).
- Test: `outbound.test.ts`, `sourceTarget.test.ts` PASS; live chặn
  `169.254.169.254` trả 400.

#### SEC-F07 [High] Import người dùng bỏ qua kiểm soát cấp bậc
- **Vị trí:** `server/src/routes/webUsers.ts:397-430`.
- **Còn tồn tại:** nhánh update chỉ kiểm tra công ty/admin/super_admin cuối; không gọi `assertCanTarget`; `UPDATE` cho đổi `role_id/status/parent_user_id/company_id`.
- **Tác động:** actor cấp thấp import file có thể hạ cấp/khóa user cấp cao hơn (không phải admin), đổi parent/company trong cùng công ty.
- **Cách sửa:** gọi `assertCanTarget(req, target)` từng dòng trước UPDATE; chỉ cho import cập nhật `display_name/email` nếu không đủ quyền; audit per-row/diff.
- **Nghiệm thu:** level 40 sửa user level 60 → 403/skip; own import ngoài subtree → skip.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C4.**
- Gọi `assertCanTarget(req, target)` từng dòng trước UPDATE; lỗi quyền thì
  ghi lỗi theo dòng và bỏ qua, không abort cả file.
- Không đủ quyền đổi role/status/parent/company thì chỉ cập nhật
  `display_name/email`; audit per-row `import.update` kèm diff quyền.
- Test: server build + 138 test PASS (RBAC hiện có).

#### SEC-F01 [Medium] Mật khẩu mặc định `123456` không buộc đổi
- **Vị trí:** `server/src/routes/webUsers.ts:397`; `server/src/db/seed.ts:230`.
- **Còn tồn tại:** đúng đặc tả import nhưng chưa có `must_change_password`.
- **Cách sửa:** thêm cột `must_change_password` (migration mới), chặn API nghiệp vụ cho tới khi đổi (trừ `/profile`), audit; hiển thị banner UI.
- **Nghiệm thu:** user import đăng nhập → chỉ vào được trang đổi mật khẩu; đổi xong mới dùng hệ thống.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C5.**
- Migration `036_must_change_password.sql` thêm cột `must_change_password`
  (schema admin 36).
- `requireAuth` trả 403 `MUST_CHANGE_PASSWORD` cho mọi API nghiệp vụ, chỉ mở
  `/api/auth/me|login|logout` và `/api/profile*`; đổi mật khẩu thành công xoá cờ.
- Import user tạo mới đặt cờ 1; UI chuyển về `/profile` và hiện banner.
- Live: user QA login → `/api/stations` 403; đổi mật khẩu → 200; đã xoá user QA.
- Test: `passwordPolicy.test.ts` PASS; server 26 file/138 PASS; FE build PASS.

### 3.2. Nhóm ưu tiên 2 — production hardening

#### SEC-F06 [High] Caster thiếu kiểm soát xác thực sai
- **Vị trí:** `gnss/internal/caster/listener.go:34-55`, `manager.go:444-450`.
- **Trạng thái:** đã có trần tổng 500 (tốt) nhưng **chưa có** throttle xác thực sai; trần 50/IP gây hại (FIX-05).
- **Cách sửa:** đếm lỗi xác thực theo `(username, ip)` + toàn cục, backoff sau N lần; chỉ áp cho trường hợp sai, không áp cho kết nối thành công; log/audit lỗi (không log password).
- **Nghiệm thu:** 20 lần sai cùng username+IP → backoff; 150 source hợp lệ cùng IP vẫn PASS dưới trần tổng.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C7.**
- `authorize` nhận `remoteIP`; đếm lỗi theo `(username, IP)` và toàn cục,
  backoff 5s→60s sau 5 lần sai, chặn toàn cục 10s sau 100 lỗi/phút.
- Chỉ áp dụng cho lần xác thực sai; xác thực thành công xoá bộ đếm.
- Test: `TestAuthFailureThrottleBlocksOnlyFailedPair`,
  `TestAuthFailureGlobalThrottle` PASS.

#### SEC-F03 [Medium–High nếu Internet] Caster plaintext
- **Vị trí:** `docker-compose.yml:116-117` (`1509:1509`, `1508:1508` bind 0.0.0.0); caster listener không TLS.
- **Cách sửa:** nếu Internet → thêm TLS listener (`crypto/tls`, cert/key) hoặc stunnel/haproxy; nếu nội bộ → publish vào IP nội bộ/VPN + firewall theo dải mạng khách hàng, không allowlist từng IP.
- **Nghiệm thu:** plaintext bị từ chối khi bật TLS; `docker compose port gnss 1509` không mở public khi mô hình nội bộ.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C7.**
- Compose publish `127.0.0.1:1509`/`127.0.0.1:1508` (mô hình nội bộ/VPN).
- Caster hỗ trợ TLS listener khi đặt `CASTER_TLS_CERT`/`CASTER_TLS_KEY`
  (`crypto/tls`, TLS ≥ 1.2); plaintext bị từ chối khi bật TLS.
- Test: `go build ./...`, `go vet ./...`, `go test ./...` PASS;
  `docker compose config --quiet` OK.

#### SEC-F10 [Medium] Cookie phiên production
- **Vị trí:** `server/src/config.ts:46`; `server/src/routes/auth.ts` (Set-Cookie); `frontend/nginx.conf` (HSTS).
- **Cách sửa:** fail-fast nếu `NODE_ENV=production` và `SESSION_COOKIE_SECURE!=='true'`; đổi tiền tố `__Host-` khi HTTPS; thêm HSTS ở nginx.
- **Nghiệm thu:** production thiếu biến → server không start; Set-Cookie có `Secure; HttpOnly; SameSite=Lax; __Host-`.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C6.**
- Fail-fast khi `NODE_ENV=production` và `SESSION_COOKIE_SECURE!=='true'`;
  tên cookie tự thêm tiền tố `__Host-` khi bật Secure; HSTS ở `nginx.conf`.
- Test: `configSecurity.test.ts` PASS; chạy thật `NODE_ENV=production node -e
  "require('./dist/config')"` → throw đúng thông điệp.

#### SEC-F13 [Medium] Audit mất im lặng + không audit đăng nhập
- **Vị trí:** `server/src/lib/audit.ts:55`; `server/src/routes/auth.ts`.
- **Cách sửa:** retry có giới hạn + log error; với thao tác quyền nhạy cảm có thể fail-closed; audit login success/fail/lock/logout kèm IP/UA (đã redact).
- **Nghiệm thu:** DB audit lỗi → hành động nhạy cảm báo lỗi/cảnh báo; login sai 5 lần có bản ghi audit.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C6.**
- `writeAudit` thử lại 1 lần, log lỗi; hành động nhạy cảm (delete/lock/import/
  change_password/role/permission/seed) fail-closed với 500 `AUDIT_WRITE_FAILED`.
- Audit `login_success`, `login_failed` (unknown_user/locked/company_disabled/
  bad_password) và `logout`, kèm IP; payload đã redact.
- Test: `audit.test.ts` 4 test PASS.

#### SEC-F09 [Medium] `trust proxy` vô điều kiện
- **Vị trí:** `server/src/app.ts:54`.
- **Cách sửa:** chỉ bật khi có env `TRUST_PROXY` (số hop hoặc dải CIDR proxy tin cậy); mặc định tắt. Ghi nhận cả socket IP và XFF có đánh dấu nguồn.
- **Nghiệm thu:** gửi XFF giả khi không qua proxy → limiter/session dùng socket IP.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C6.**
- `trust proxy` chỉ bật khi có env `TRUST_PROXY` (số hop hoặc dải CIDR);
  mặc định tắt, request dùng socket IP.
- `sessionCookieName()` áp dụng cho cả HTTP middleware và Socket.IO handshake.

#### SEC-F18 [Low–Medium] Login lộ trạng thái tài khoản
- **Vị trí:** `server/src/routes/auth.ts:51-66`.
- **Cách sửa:** verify dummy Argon2 khi không tìm thấy user; trả cùng `INVALID_CREDENTIALS` cho mọi trường hợp không đăng nhập được (trừ khi có kênh thông báo khác); audit login fail.
- **Nghiệm thu:** thời gian/response user tồn tại vs không tồn tại tương đương.

**Trạng thái thực hiện (2026-11-03, +07): Đã sửa — lô C6.**
- Verify Argon2id với hash giả khi không tìm thấy user/khóa/công ty bị vô hiệu;
  mọi trường hợp đều trả `401 INVALID_CREDENTIALS`, audit lý do nội bộ.
- Test: server build + 145 test PASS.

### 3.3. Nhóm ưu tiên 3 — sửa nhanh, rủi ro thấp

| Mục | Vị trí | Cách sửa | Nghiệm thu |
|---|---|---|---|
| SEC-F08 | `server/src/routes/mapConfig.ts:21` | Thêm `mapConfigRouter.use(csrfProtection)` sau `requireAuth` | `PUT /api/map/config` thiếu header → 403 |
| SEC-F19 | `server/src/app.ts:110-116` | `/health` chỉ trả `{status, db}`; chi tiết ghi log hoặc endpoint nội bộ | Tắt DB → response không lộ host/user/DSN |
| SEC-F14 | `gnss/cmd/corsd/main.go:144-148` | Thêm `ReadTimeout 10s`, `WriteTimeout 30s`, `IdleTimeout 60s`, `MaxHeaderBytes 16KB` | Slowloris trên 7080 bị đóng theo timeout |
| SEC-F15 | `server/src/routes/map.ts:68-69` | Thêm `requirePermission('map','view')` + rate-limit theo user | User thiếu quyền → 403; burst → 429 |
| SEC-F21 | `server/src/routes/ops.ts:57,249` | `idsFor('own')` trả `[userId]`, không dùng subtree | User own chỉ thấy audit của mình |
| SEC-F05 | `server/src/lib/crypto.ts:18`, `gnss/internal/secret/aes.go` | AAD = `table:column:recordId`; payload `v2:keyid:...` hỗ trợ 2 khoá | Hoán đổi ciphertext giữa 2 bản ghi → decrypt fail |
| SEC-F12 | `server/src/db/pool.ts`, `gnss/internal/db/db.go` | Chỉ bật TLS khi DB ra ngoài host; giữ nguyên khi DB trong Docker network | `SHOW GRANTS` đúng thiết kế; DSN không log |
| SEC-F11 | `docker-compose.yml` service `web` | Khi production dùng `frontend/Dockerfile` + nginx, bỏ bind mount, thêm CSP/XFO/HSTS, non-root | `curl -I` có header; process không phải root |

**Trạng thái thực hiện nhóm 3.3 (2026-11-03, +07):**
- SEC-F08 (C11): `mapConfigRouter` dùng `csrfProtection` sau `requireAuth`.
- SEC-F19 (C11): `/health` bỏ `message`, log lỗi server-side; payload chỉ còn
  `status/db/time` (và `schemaVersion` khi thành công).
- SEC-F15 (C11): tile yêu cầu `requirePermission('map','view')` + rate-limit
  240/phút theo user.
- SEC-F21 (C11): `idsForScope()` trả `[userId]` cho `own`; test PASS.
- Test: server build + 30 file/150 PASS.

### 3.4. Mục đã đóng
- **F-16** (realtime tick dùng `tenantIds`) — đã sửa tại `server/src/realtime/socket.ts` (tick truyền `state.tenantIds`). Đóng, không cần làm lại.
- **F-06 một phần** — trần tổng 500 đã có; phần throttle xác thực sai chuyển thành SEC-F06 ở trên.

---

## 4. Thứ tự thực hiện đề xuất

| Đợt | Nội dung | Điều kiện hoàn thành |
|---|---|---|
| **Đợt 1 — Blocker vận hành** | FIX-01, FIX-02, FIX-03, FIX-04, FIX-05, FIX-06 | Build + unit test PASS; tái hiện 500 không còn; station 480 không reconnect mỗi 30s; 150 source/IP PASS mock |
| **Đợt 2 — Bảo mật tài khoản** | SEC-F02, SEC-F04, SEC-F07, SEC-F01 | Test seed/lock, credential-host binding, import leo cấp; audit đầy đủ |
| **Đợt 3 — Production hardening** | SEC-F10, SEC-F13, SEC-F09, SEC-F06 (throttle), SEC-F03 | Fail-fast production, audit login, XFF, backoff xác thực; TLS/VPN theo mô hình |
| **Đợt 4 — Trung bình** | FIX-07 → FIX-14 | Test đua pause, alert resolve, realtime fallback, history direction, grace rover, reconcile nil, credential lỗi đơn lẻ, chặn trùng downstream |
| **Đợt 5 — Low/hardening** | FIX-15, FIX-16, SEC-F08, F14, F15, F19, F21, F05, F12, F11 | Sửa + test theo từng mục; có thể gộp vào đợt hardening cuối |

**Cổng chất lượng trước khi đóng từng đợt**
1. `cd server && npm run build && npm test`
2. `cd gnss && go build ./... && go vet ./... && go test ./...`; bổ sung `go test -race` trên CI Linux.
3. `cd frontend && npm run build`
4. Playwright các spec liên quan (ít nhất `relay-state`, `station-detail`, `timeline`, `mountpoint-explorer`, `p1-rbac`) với stack đang chạy.
5. Mock-first cho mọi thay đổi NTRIP/RTCM; không dùng endpoint công cộng chưa được phép.
6. Không secret trong diff; cập nhật `SESSION.md` + checklist trong `TASKS.md`.

---

## 5. Phụ lục — Bằng chứng khảo sát ngày 2026-11-02

- **Môi trường:** Docker Desktop bật lại, `docker compose up -d`; 4 container healthy.
- **Health:** Node `{"status":"ok","db":"ok","schemaVersion":35}`; Go `{"db":"ok","schemaVersion":7,"status":"ok"}`.
- **Dữ liệu:** 7 trạm, 8 mountpoint, 208 relay job (205 soft-delete), 7 tài khoản NTRIP, 5 listener, 6 web user, 33.583 quality sample, 692 quality alert chưa resolve.
- **API:** 15+ endpoint trả 200; `GET /api/mountpoints?q=DOCS` trả 500 kèm log `Unknown column 's.name'`.
- **Kết nối trạm/relay:**
  - Relay 227 (`Mốc châu`): `runtime_state=streaming` trong DB nhưng list trả `relayState=offline`; quality sample sau 16:26 chỉ 0–2 byte, **0 frame**; trước restart (16:23) còn 246 frame/phút.
  - Trạm 480 (`TestHauLoc`): 5 session/10 phút, `close_reason=timeout` đúng 30s; quality 2 byte/0 frame mỗi phút; timeline 24h `current=no_data`.
  - Caster: 0 source/rover đang mở; không có lỗi/panic trong log Go.
- **Tài nguyên:** gnss ~18 MB, server ~339 MB, mysql ~503 MB, web ~201 MB; không có cảnh báo bộ nhớ.
- **Ghi chú:** đây là quan sát tại một thời điểm; nguyên nhân phía upstream `rtktk.online` cần đối chiếu với nhà cung cấp trước khi kết luận dứt điểm.

---

## 6. Ghi chú cuối

- Tài liệu này chỉ ghi nhận kế hoạch; **không thay đổi mã nguồn**.
- `docs/2/BAO_MAT_MA_NGUON.md` được đọc và đối chiếu lại tại commit `5f349fe`, **không chỉnh sửa nội dung**; các ID `F-xx` trong tài liệu này dùng để tham chiếu ngược.
- Các mục Low/Info không ảnh hưởng vận hành hoặc không phải lỗ hổng trực tiếp được giữ nguyên trong `docs/2/BAO_MAT_MA_NGUON.md` và xử lý theo lịch hardening định kỳ.
- Khi sửa xong từng mục, cập nhật lại bảng trạng thái tại §1 (đổi "Còn" → "Đã sửa" + commit) và ghi bằng chứng test vào `SESSION.md`.
