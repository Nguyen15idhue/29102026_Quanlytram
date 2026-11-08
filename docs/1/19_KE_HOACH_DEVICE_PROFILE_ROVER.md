# Kế hoạch 19 — Ngụy trang User-Agent theo device profile + phục hồi các nguyên tắc relay từ mã nguồn cũ

- Ngày lập: 2026-11-08
- Trạng thái: READY — chờ bắt đầu triển khai (chưa sửa code)
- Phạm vi: `gnss/internal/deviceprofile` (mới), `gnss/internal/ntrip`,
  `gnss/internal/relay`, `gnss/internal/probe`, `gnss/internal/nmea`,
  `db/migrations/admin/047_*`, `server/src/routes/relayJobs.ts`,
  `server/src/routes/stations.ts`, `server/src/routes/deviceProfiles.ts` (mới),
  `frontend/src/pages/RelayJobs.tsx`, `frontend/src/pages/Stations.tsx`,
  `frontend/src/pages/system/*`, `docs-site/docs/07-relay.md`.
- Nguyên tắc: mock-first; **không chạy relay.exe**, không chiếm `8081`/`2101`
  của relay cũ; **không sửa/chạy gì trong `relayrtcm/backup`** (chỉ đọc tham
  chiếu); không commit secret; test trước khi tuyên bố PASS; không test với
  mountpoint công cộng.
- Căn cứ: khảo sát `relayrtcm/backup/main.go` (3.288 dòng), `history.go`,
  `README.md`; đối chiếu graphify + đọc mã nguồn hiện tại. Kết luận khảo sát:
  hiện tại **thiếu cả tầng "ngụy trang rover"** và vài chi tiết transport/retry.
- Quyết định pháp lý/nghiệp vụ (người dùng xác nhận 2026-11-08): device-profile
  spoofing **được phép** trong hệ thống này vì không phục vụ mục đích thương
  mại; chỉ dùng với caster nội bộ hoặc caster mà đơn vị có quyền truy cập.

## 1. Mục tiêu

1. **M19-1** — Không còn bất kỳ User-Agent tự khai báo nào
   (`CORS-MVP-relay`, `CORS-MVP-station`, `CORS-MVP-probe`,
   `*-relay-test`) trong mã nguồn.
2. **M19-2** — Mỗi relay job / station source / probe gửi UA theo **device
   profile** thật (12 profile port từ code cũ), version ngẫu nhiên nhưng **ổn
   định theo đối tượng** (không đổi sau mỗi lần restart).
3. **M19-3** — `Ntrip-Version`, `Connection`, chu kỳ NMEA, HDOP/số vệ tinh,
   GSA/RMC đi theo profile thay vì hằng số toàn hệ thống.
4. **M19-4** — Phục hồi các nguyên tắc transport còn thiếu: TCP keepalive +
   NoDelay, proxy timeout riêng, tương thích định dạng proxy cũ, đọc downstream
   để phát hiện caster đích đóng, buffer pool.
5. **M19-5** — Phục hồi phân loại lỗi 3 nhánh + jitter delay + stagger khởi
   động.
6. **M19-6** — Quản trị được bằng UI: chọn profile, xem trước UA, tuỳ chọn
   UA literal khi caster từ chối UA lạ; không cho nhập secret/UA quá dài.
7. **M19-7** — Có bằng chứng test: mock caster nhận đúng header, unit test
   Go/Node, Playwright, và không hồi quy các test hiện có.

## 2. Quyết định đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| D19-1 | Device-profile spoofing **được phép** (phi thương mại) | Đã xác nhận 2026-11-08; ghi vào mục 9 AGENTS.md |
| D19-2 | Bỏ hoàn toàn hậu tố `-relay`, `-station`, `-probe`, `-relay-test` | Không còn tự khai báo là hệ thống relay |
| D19-3 | Version UA **ổn định theo đối tượng** | Sinh từ PRNG seed = `(profile_code, target_id)`; không đổi sau restart, chỉ đổi khi đổi profile |
| D19-4 | Thứ tự ghép UA: `ua_prefix` + `" "` + `TênThiếtBị/Version` | Giữ đúng ngữ nghĩa `buildUserAgent()` của code cũ (`main.go` L1170–1179) |
| D19-5 | `ua_prefix` rỗng = dùng nguyên UA thiết bị | Không tự thêm gì |
| D19-6 | Fallback khi không chọn profile | Profile `gnss_internet_radio` (trung tính nhất), **không** fallback về chuỗi `CORS-MVP-*` |
| D19-7 | Cho phép UA literal (`ua_mode = literal`) để xử lý caster khó tính | Cảnh báo trên UI; vẫn không được rỗng |
| D19-8 | `Ntrip-Version` + phiên bản HTTP + `Connection` lấy theo profile | Trimble DA2/Leica GS18 dùng `Ntrip/1.0` + `keep-alive` |
| D19-9 | Mô phỏng vị trí rover **mặc định TẮT** (`static`) | Relay thường chuyển base stream; chỉ bật `rover` cho tài khoản VRS |
| D19-10 | GSA/RMC chỉ gửi khi profile yêu cầu | Xác suất 1/3, 1/4 như code cũ |
| D19-11 | Probe dùng profile **toàn cục** trong bảng `settings` | Tránh mỗi trạm một UA khác nhau từ cùng một IP |
| D19-12 | Station source dùng profile riêng theo trạm | Cột mới ở `station_sources`, không đụng `relay_jobs` |
| D19-13 | UA runtime **có** lưu vào bảng session (P19-6), không thêm cột vào `relay_jobs` | Xem D19-21 |
| D19-14 | Giữ `ua_prefix` cũ (không migrate giá trị) nhưng **đổi ngữ nghĩa** | Bỏ hậu tố `-relay`; ghi cảnh báo trong release note |
| D19-15 | Retry: `permanent` 30s, `session < 60s` 20s, `temporary` 5→60s ±10%, reset khi phiên > 60s | Port nguyên từ `main.go` L592–652 |
| D19-16 | Stagger 0–3s cho mỗi job khi Manager start | Tránh dồn kết nối khi restart service |
| D19-17 | Không port: web monitor `:8081`, SQLite history, hot-reload `config.json` | Đã có thay thế tốt hơn (Node + MySQL + reconcile) |
| D19-18 | Không port `InsecureSkipVerify` của code cũ | Giữ verify TLS hiện tại |
| D19-19 | Seed version = `fnv1a64(profile_code) ^ target_id ^ role_salt` | `role_salt` tách relay / station / probe để 2 đối tượng cùng ID không trùng version |
| D19-20 | Station source **chỉ** dùng profile ở phase này, chưa có literal | Cần literal thì thêm `client_ua_mode` ở migration 048; trước mắt dùng custom profile |
| D19-21 | Lưu UA thật đã gửi vào `relay_sessions.user_agent` + `station_source_sessions.user_agent` ở **P19-6** | Runtime migration `010_*`; ghi 1 lần mỗi phiên; phục vụ truy vết khi caster trả 401/403 |
| D19-22 | Probe dùng **một** profile toàn cục (settings); **không** xoay profile theo phiên | Xoay profile cùng tài khoản/IP là dấu hiệu account sharing → loại. Chừa `device_profiles.receiver_type_alias` để sau map theo `stations.receiver_type` |
| D19-23 | Motion chỉ áp dụng cho relay job, **không** cho station source | Station source là luồng ingest base, di chuyển sẽ sai toạ độ |
| D19-24 | Không port `WEB_USER`/`WEB_PASS` kiểu monitor cũ | Đã có session + CSRF + RBAC |
| D19-25 | Triển khai **local only** trong kế hoạch này | Không deploy VPS, không chạy `hot_update.sh`; user kiểm tra tay trước |

## 3. Hiện trạng và bằng chứng

### 3.1 User-Agent đang tự khai báo

| Vị trí | Nội dung hiện tại |
|---|---|
| `gnss/internal/ntrip/ntrip.go` L243–248 | `userAgent()` fallback cứng `"CORS-MVP-relay"` |
| `gnss/internal/relay/bridge.go` L135–139 | `cfg.UAPrefix` hoặc `"CORS-MVP"` rồi cộng `"-relay"` |
| `gnss/internal/relay/manager.go` L266–270 | `"CORS-MVP" + "-relay-test"` |
| `gnss/internal/relay/station_source.go` L221 | `toNtripEndpoint(cfg.Endpoint, "CORS-MVP-station")` |
| `gnss/internal/probe/manager.go` L233 | `UserAgent: "CORS-MVP-probe"` |

Hệ quả: mọi luồng NTRIP client (relay upstream, downstream, station source,
probe, nút Test) có cùng một chữ ký; đặt `ua_prefix = "CHC LandStar/8.1.0"` sẽ
thành `CHC LandStar/8.1.0-relay` — càng lộ hơn mặc định.

### 3.2 Transport còn thiếu so với code cũ

| Nguyên tắc code cũ | Hiện tại |
|---|---|
| `DeviceProfile` + `generateUserAgent()` + `buildUserAgent()` (`main.go` L78–106, L1170–1222) | Không có |
| `Ntrip-Version`/`Connection` theo thiết bị (L81–82, L690–691) | `ntrip.go` L261–278, L349–368 luôn `Connection: close`, chỉ 2 giá trị v1/v2 |
| TCP `KeepAlive=30s` + `SetNoDelay(true)` (L977, L1000–1012) | `gnss/internal/proxy/proxy.go` L14 chỉ `net.Dialer{Timeout}` |
| Proxy timeout riêng 10s + fallback context (L921–958) | Không có |
| Proxy 3 định dạng `host:port:user:pass`, `host:port`, URI (L872–917) | `proxy.go` L19–25 chỉ nhận URI |
| Buffer pool 32KB (L45–46, L69–75, L798–819) | `bridge.go` L260 `make([]byte, opts.ReadBuffer)` mỗi phiên |
| Goroutine đọc dest để phát hiện đóng (L795–814) | Không có; `bridge.go` chỉ đọc upstream |
| Chunked decode (L702–708) | Đã có, tốt hơn (`ntrip.go` L153–155) |
| TLS per endpoint (L1016–1033) | Đã có (`ntrip.go` L98–119) |

### 3.3 Retry/backoff

- Hiện tại: `relay/backoff.go` L9–52 (exp + jitter 0.8–1.2), `relay/job.go`
  L144–162 (reset khi phiên > 30s), L164–173 (`RetryAfter`), L175–194
  (`classify` chỉ để ghi history, **không đổi delay**).
- Code cũ: 3 nhánh delay + jitter ±10% + reset khi phiên > 60s
  (`main.go` L592–652), delay khởi động ngẫu nhiên 0–3s (L543–553).

### 3.4 NMEA

- Đã port tốt: fix RTK Fixed 75% / Float 18% / DGPS 7%, HDOP/sats/age, cửa sổ
  data 30s, jitter ±10% (`relay/nmea_sender.go` L105–143).
- Còn thiếu: `GSA`/`RMC` (`nmea/nmea.go` L94–112 có nhưng relay chỉ gửi GGA),
  altitude jitter (L1525–1527 code cũ), chu kỳ theo profile, mô phỏng di
  chuyển (`main.go` L1386–1485).

### 3.5 Dữ liệu/UI hiện có

- `relay_jobs.ua_prefix VARCHAR(100)` (`db/migrations/admin/002_relay.sql` L37).
- `station_sources.client_*` (`015_station_sources.sql`) chưa có UA/profile.
- `settings(setting_key, setting_value JSON)` (`005_alerts_settings.sql` L27–35)
  dùng được cho cấu hình toàn cục.
- UI: `frontend/src/pages/RelayJobs.tsx` L1222–1227 (ô "UA prefix" trần),
  L1416 (hiển thị detail); `stations.ts` L137–138, L2572–2594,
  L2675–2712 (upsert station source).
- Migration mới nhất: `046_drop_port_defaults.sql` → kế tiếp là `047`.

## 4. Kiến trúc đích

### 4.1 Gói mới `gnss/internal/deviceprofile`

```go
package deviceprofile

type Profile struct {
    Code            string  // "chc_landstar"
    Name            string  // "CHC LandStar"
    Vendor          string  // "CHC Navigation"
    VersionTemplate string  // major.minor.patch.date | major.minor.patch | vmajor.minor.patch | major.minor
    NtripVersion    string  // "v1" | "v2"
    HTTPVersion     string  // "HTTP/1.0" | "HTTP/1.1"
    Connection      string  // "close" | "keep-alive"
    NMEAIntervalSec int
    NMEAJitterSec   int
    HDOPMin, HDOPMax float64
    SatsMin, SatsMax int
    SendGSA, SendRMC bool
    InitialDelayMS  int
    Motion          string  // "static" | "rover"
}

func Baseline() []Profile                       // 12 profile port từ code cũ
func Resolve(code string) (Profile, bool)
func Default() Profile
func UserAgent(p Profile, prefix string, seed int64) string // prefix + " " + Name/Version
func Version(template string, seed int64) string
func NMEAIntervalSec(p Profile, override int) int
func Jitter(p Profile) time.Duration
```

- `Version()` dùng `math/rand.New(rand.NewSource(seed))` để **tất định**; seed =
  `fnv64(profileCode) ^ targetID` (D19-3). Không đọc crypto/rand.
- `UserAgent()` không bao giờ trả chuỗi rỗng; prefix được `TrimSpace`.
- Không phụ thuộc DB: bảng dùng để seed/override, Go vẫn có baseline hard-code
  để chạy được khi DB thiếu dòng (degraded).

### 4.2 Luồng chọn UA

```
relay job  ──┐
station    ──┼─► Resolve(profile_code) ─► Version(seed) ─► UserAgent(prefix)
probe      ──┘        │                                        │
                      └─► NtripVersion / Connection / NMEA ◄───┘
                                   │
                             ntrip.Endpoint
```

- `ntrip.Endpoint` nhận thêm `Connection string`; `userAgent()` **chỉ** đọc
  `endpoint.UserAgent`, bỏ fallback `CORS-MVP-relay`.
- Mọi caller phải đi qua `deviceprofile.UserAgent` (không tự nối chuỗi).

### 4.3 Nguồn cấu hình

| Đối tượng | Nguồn profile | Ghi chú |
|---|---|---|
| Relay job | `relay_jobs.device_profile_id` | Có thể override `ua_mode='literal'` + `ua_prefix` |
| Station source | `station_sources.client_device_profile_id` | Fallback default |
| Probe | `settings['device_profile.probe']` | Toàn cục (D19-11) |
| Mặc định hệ thống | `settings['device_profile.default']` | Fallback `gnss_internet_radio` |

## 5. Thiết kế chi tiết

### 5.1 Migration `db/migrations/admin/047_device_profiles.sql`

```sql
CREATE TABLE IF NOT EXISTS device_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(96) NOT NULL,
  vendor VARCHAR(96) NOT NULL DEFAULT '',
  version_template ENUM('major.minor.patch','major.minor.patch.date',
                        'vmajor.minor.patch','major.minor') NOT NULL,
  ntrip_version ENUM('v1','v2') NOT NULL DEFAULT 'v2',
  http_version ENUM('HTTP/1.0','HTTP/1.1') NOT NULL DEFAULT 'HTTP/1.1',
  connection ENUM('close','keep-alive') NOT NULL DEFAULT 'close',
  nmea_interval_sec INT NOT NULL DEFAULT 10,
  nmea_jitter_sec INT NOT NULL DEFAULT 2,
  hdop_min DECIMAL(3,1) NOT NULL DEFAULT 0.8,
  hdop_max DECIMAL(3,1) NOT NULL DEFAULT 1.2,
  sats_min TINYINT UNSIGNED NOT NULL DEFAULT 10,
  sats_max TINYINT UNSIGNED NOT NULL DEFAULT 14,
  send_gsa TINYINT(1) NOT NULL DEFAULT 1,
  send_rmc TINYINT(1) NOT NULL DEFAULT 0,
  initial_delay_ms INT NOT NULL DEFAULT 0,
  motion ENUM('static','rover') NOT NULL DEFAULT 'static',
  receiver_type_alias VARCHAR(96) NOT NULL DEFAULT '',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  builtin TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_profiles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Seed 12 dòng đúng dữ liệu `main.go` L94–105:

| code | name | version_template | ntrip | connection | interval/jitter | hdop | sats | GSA | RMC | delay |
|---|---|---|---|---|---|---|---|---|---|---|
| gnss_internet_radio | GNSSInternetRadio | major.minor.patch | v2 | close | 10/2 | 0.8–1.2 | 10–14 | 1 | 0 | 0 |
| efix_efield | EFIX eField | major.minor.patch.date | v2 | close | 12/3 | 0.7–1.0 | 12–16 | 1 | 1 | 1000 |
| chc_landstar | CHC LandStar | major.minor.patch.date | v2 | close | 11/2 | 0.9–1.3 | 9–13 | 0 | 1 | 0 |
| chc_i83 | CHC i83 | major.minor.patch | v2 | close | 15/4 | 0.8–1.4 | 10–15 | 1 | 0 | 2000 |
| comnav_t300 | COMNAV T300 | major.minor.patch | v2 | close | 9/1 | 0.7–1.1 | 11–15 | 0 | 0 | 1000 |
| trimble_da2 | Trimble DA2 | major.minor | **v1** | **keep-alive** | 10/2 | 0.6–0.9 | 12–18 | 1 | 1 | 0 |
| hitarget_v90 | Hi-Target V90 | major.minor.patch | v2 | close | 13/3 | 0.8–1.2 | 10–14 | 0 | 1 | 1000 |
| south_s82t | South S82T | major.minor.patch | v2 | close | 11/2 | 0.9–1.3 | 9–13 | 1 | 0 | 0 |
| stonex_s900a | Stonex S900A | major.minor.patch | v2 | close | 14/3 | 0.8–1.4 | 10–14 | 0 | 0 | 2000 |
| unistrong_g970 | UniStrong G970 | major.minor.patch | v2 | close | 10/2 | 0.7–1.1 | 11–15 | 1 | 1 | 1000 |
| emlid_reachrs2 | Emlid ReachRS2 | vmajor.minor.patch | v2 | close | 12/2 | 0.8–1.1 | 11–14 | 0 | 0 | 1000 |
| leica_gs18 | Leica GS18 | major.minor.patch | v2 | **keep-alive** | 11/3 | 0.6–0.9 | 13–18 | 1 | 1 | 0 |

Cột bổ sung:

```sql
ALTER TABLE relay_jobs
  ADD COLUMN device_profile_id BIGINT UNSIGNED NULL AFTER ua_prefix,
  ADD COLUMN ua_mode ENUM('profile','literal') NOT NULL DEFAULT 'profile' AFTER device_profile_id,
  ADD CONSTRAINT fk_relay_jobs_device_profile
    FOREIGN KEY (device_profile_id) REFERENCES device_profiles(id) ON DELETE SET NULL;

ALTER TABLE station_sources
  ADD COLUMN client_device_profile_id BIGINT UNSIGNED NULL AFTER client_nmea_interval_sec,
  ADD COLUMN client_ua_prefix VARCHAR(100) NOT NULL DEFAULT '' AFTER client_device_profile_id,
  ADD CONSTRAINT fk_station_sources_device_profile
    FOREIGN KEY (client_device_profile_id) REFERENCES device_profiles(id) ON DELETE SET NULL;
```

`settings` seed (idempotent, `INSERT ... ON DUPLICATE KEY UPDATE setting_key = setting_key`):

```
device_profile.default   = {"code":"gnss_internet_radio"}
device_profile.probe     = {"code":"gnss_internet_radio"}
device_profile.motion_allowlist = {"codes":["leica_gs18","trimble_da2"]}
```

Quyền mới:

```
device_profiles.view  (module=device_profiles, action=view)
device_profiles.edit  (module=device_profiles, action=edit)
```

- `device_profiles.view` gán cho mọi role đã đăng nhập (cần để render select).
- `device_profiles.edit` chỉ `super_admin`.
- `device_profiles` không cho xoá profile `builtin=1`; chỉ tắt `enabled`.

Migration **runtime** (chỉ làm ở P19-6, cùng lúc với UI truy vết):

```sql
-- db/migrations/runtime/010_session_user_agent.sql
ALTER TABLE relay_sessions
  ADD COLUMN user_agent VARCHAR(160) NOT NULL DEFAULT '' AFTER close_reason;
ALTER TABLE station_source_sessions
  ADD COLUMN user_agent VARCHAR(160) NOT NULL DEFAULT '' AFTER close_reason;
```

`VARCHAR(160)` = tối đa 100 (prefix) + 1 + 59 (tên thiết bị + version), đủ cho
mọi profile và literal.

### 5.2 Go — `gnss/internal/ntrip`

1. `Endpoint` thêm `Connection string` (L22–33).
2. `userAgent(endpoint)` (L243–248) → trả `endpoint.UserAgent`; nếu rỗng trả
   `strings.TrimSpace(endpoint.UserAgent)` và log warn một lần, **không** dùng
   chuỗi `CORS-MVP-*`.
3. `Get()` (L261–278):
   - `httpVersion` lấy từ `endpoint.HTTPVersion` (mới) thay vì suy từ `Version`.
   - `Ntrip-Version` gửi khi `endpoint.Version` khác rỗng (kể cả v1 nếu profile
     yêu cầu — Trimble gửi `Ntrip/1.0` trên `HTTP/1.1`).
   - `Connection:` lấy từ `endpoint.Connection`, mặc định `close`.
4. `openSource()` (L340–368) áp dụng cùng logic; giữ `Content-Type` cho POST.
5. Không đổi shape response/`StatusError` để không phá API nội bộ.

### 5.3 Go — `gnss/internal/relay`

1. `types.go`:
   - `EndpointConfig` thêm `HTTPVersion`, `Connection`.
   - `JobConfig` thêm `DeviceProfile deviceprofile.Profile`, `UAMode string`,
     `Motion string` (hoặc `MotionEnabled bool`).
2. `store.go` `jobColumns` (L34–49) thêm `j.device_profile_id`, `j.ua_mode`;
   `scanJob` (L80–119) map sang `JobConfig`; resolve profile qua registry
   trong bộ nhớ (baseline) + overlay DB nếu có.
3. `bridge.go`:
   - `toNtripEndpoint()` (L109–125) nhận thêm `deviceprofile.Profile` và map
     `HTTPVersion`/`Connection`.
   - Hàm mới `resolveUserAgent(cfg, role, seed)` — thay khối L135–139:
     - `ua_mode == "literal"` → dùng `strings.TrimSpace(cfg.UAPrefix)`.
     - ngược lại → `deviceprofile.UserAgent(profile, cfg.UAPrefix, seed)`.
   - Bỏ hoàn toàn `"-relay"`.
4. `manager.go` (L266–282) dùng cùng `resolveUserAgent` (không còn
   `-relay-test`).
5. `station_source.go`:
   - `StationSourceConfig` (L32–45) thêm `DeviceProfile`, `UAPrefix`.
   - `stationSourceQuery` (L123–136) join `device_profiles` hoặc đọc
     `client_device_profile_id` + `client_ua_prefix`.
   - `RunStationSource` (L221) thay `"CORS-MVP-station"` bằng
     `deviceprofile.UserAgent(profile, cfg.UAPrefix, cfg.StationID)`.
6. `job.go`:
   - `RunSession` nhận UA đã resolve (không tự nối chuỗi).
   - Stagger: trước vòng lặp, `time.Sleep(rand(0..3s))` có tôn trọng `ctx`.
7. `nmea_sender.go`:
   - `newNMEASender(profile, jobID, lat, lon, intervalOverride)`; lấy
     `baseSats`/`baseHDOP` từ **khoảng của profile** thay vì `jobID%7`
     (L51–52).
   - Chu kỳ: `deviceprofile.NMEAIntervalSec(profile, cfg.NMEAIntervalSec)`;
     jitter từ profile (giới hạn ≤ 20% interval).
   - Gửi kèm `nmea.GSA()`/`nmea.RMC()` theo `profile.SendGSA/SendRMC` với xác
     suất 1/3, 1/4 (port `main.go` L1539–1545).
   - Altitude jitter ±0.5m (port `main.go` L1525–1527) để GGA không lặp y hệt.

### 5.4 Go — `gnss/internal/probe`

- `Options` thêm `Profile deviceprofile.Profile`, `UAPrefix string`.
- Bỏ `UserAgent: "CORS-MVP-probe"` (L233) → dùng `deviceprofile.UserAgent`.
- `cmd/corsd/main.go` (L142–152) nạp profile từ `settings` key
  `device_profile.probe` (đọc qua store mới `probe.NewSettingsStore` hoặc
  truyền từ `cfg`), fallback `deviceprofile.Default()`.

### 5.5 Go — mô phỏng rover (tuỳ chọn, mặc định TẮT)

File mới `gnss/internal/relay/rover_motion.go` port từ `main.go` L58–66,
L1386–1513:

- `type roverMotion` với `cur/target`, `speedMps`, `idleUntil`, `speedKnots`,
  `courseDeg`.
- Hằng số: bán kính 10 km, mỗi chặng ≤ 2 km, tốc độ 1–4 m/s, nghỉ 60–300s,
  coi như tới đích khi ≤ 40 m.
- Chỉ dùng khi `profile.Motion == "rover"` **và** job bật `motion` (migration
  không bật mặc định).
- Vị trí gốc vẫn là `cfg.Lat/Lon`; mọi toạ độ phát ra nằm trong bán kính.
- GGA và RMC dùng cùng một snapshot để tốc độ/hướng nhất quán.

### 5.6 Transport parity

1. `gnss/internal/proxy/proxy.go`:
   - Chuẩn hoá input: `host:port:user:pass` → `socks5://user:pass@host:port`;
     `host:port` → `socks5://host:port`; giữ URI như hiện tại.
   - `Dialer{Timeout: timeout, KeepAlive: 30s}`; sau khi có `*net.TCPConn` →
     `SetNoDelay(true)`.
   - Tham số `ProxyDialTimeout` (mặc định 10s) tách khỏi `timeout` chung.
2. `relay/bridge.go`:
   - Thêm goroutine đọc `downstream.Conn` (nếu `Conn != nil`) để phát hiện
     caster đích đóng; lỗi đọc → `writerErr`.
   - Thay `make([]byte, opts.ReadBuffer)` (L260) bằng `sync.Pool` buffer 32 KB.

### 5.7 Retry parity

`relay/retry.go` (mới) + sửa `job.go`:

```go
func classifyDelay(err error, sessionLen time.Duration, retryCount int) time.Duration
// permanent (401/403/404/rejected/eof/forcibly closed) → 30s
// sessionLen < 60s                                      → 20s
// temporary (timeout/reset/refused/unreachable/dial)    → min(5s*2^n, 60s)
// còn lại                                               → min(5s*n, 60s)
// + jitter ±10%
```

- Reset `retryCount` khi phiên > 60s (hiện 30s — D19-15).
- `RetryAfter` của caster vẫn ưu tiên cao nhất (giữ `job.go` L164–173).
- `classify()` hiện có giữ nguyên để ghi history; bổ sung nhánh `permanent`.

### 5.8 Node API

1. `server/src/routes/deviceProfiles.ts` (mới):
   - `GET /api/device-profiles` — mọi user đã đăng nhập, trả field an toàn
     (`code, name, vendor, ntripVersion, connection, nmeaIntervalSec, ...`).
   - `POST /api/device-profiles/preview` — body `{profileId|code, prefix, targetId}`
     → `{userAgent, ntripVersion, connection}`; dùng cùng thuật toán seed với
     Go (chia sẻ test-vector, xem 10.1).
   - `POST/PATCH/DELETE /api/device-profiles` — chỉ `device_profiles.edit`;
     chặn xoá `builtin=1`.
2. `server/src/routes/relayJobs.ts`:
   - `createSchema`/`updateSchema` thêm `deviceProfileId` (nullable) và
     `uaMode` enum (`profile|literal`, default `profile`); `uaPrefix` vẫn giữ
     (max 100, không nhận control char).
   - `SELECT` (L1330–1357) thêm `j.device_profile_id, j.ua_mode`.
   - `INSERT/UPDATE` (L1546–1582) thêm 2 cột.
   - Response mapping (L168–187) thêm `deviceProfileId`, `deviceProfile`
     (object tóm tắt), `uaMode`.
   - Import (L1720–1780): chấp nhận `device_profile`/`deviceProfileId`/
     `ua_mode`; giữ tương thích `src_*`/`dst_*`.
3. `server/src/routes/stations.ts`:
   - Schema (L137–138, L2572–2573) thêm `client_device_profile_id`,
     `client_ua_prefix`.
   - Response (L989, L2593–2594) thêm 2 field.
   - Upsert station source (L2675–2712) thêm 2 cột.
4. `server/src/routes/system.ts`: thêm `GET/PUT /api/system/device-profile`
   cho default + probe (dùng bảng `settings`, quyền `system_ops.edit`).

### 5.9 Frontend

1. `frontend/src/pages/RelayJobs.tsx`:
   - Thay ô "UA prefix" (L1222–1227) bằng:
     - `Select` "Thiết bị giả lập" (options từ `/api/device-profiles`), có
       option "Tuỳ chỉnh (literal)".
     - `Input` "UA prefix (tuỳ chọn)" — chỉ hiện khi `uaMode=profile`.
     - `Input` "UA literal" — chỉ hiện khi `uaMode=literal`.
     - Khối preview (read-only, mono) gọi `/api/device-profiles/preview`
       (debounce 300ms) — hiển thị đúng UA sẽ gửi.
   - Detail drawer (L1416) hiển thị profile + UA dự kiến.
   - `form.uaPrefix` (L80, L334, L490) giữ nguyên, thêm
     `form.deviceProfileId`, `form.uaMode`.
2. `frontend/src/pages/Stations.tsx`: tab "Nguồn trạm" thêm select profile +
   `client_ua_prefix`.
3. `frontend/src/pages/system/AutomationTab.tsx` (hoặc tab mới
   "Ngụy trang"): chọn profile mặc định + profile probe.
4. `frontend/src/types.ts`: thêm `DeviceProfile`, mở rộng `RelayJob`/
   `StationSource` (L120–121, L569).
5. Không hardcode danh sách profile trong frontend — luôn lấy từ API.

## 6. API thay đổi

| Endpoint | Thay đổi | Breaking |
|---|---|---|
| `GET /api/device-profiles` | mới | không |
| `POST /api/device-profiles/preview` | mới | không |
| `POST/PATCH/DELETE /api/device-profiles` | mới | không |
| `GET/PUT /api/system/device-profile` | mới | không |
| `GET /api/relay-jobs` | thêm `deviceProfileId`, `deviceProfile`, `uaMode` | không (additive) |
| `POST/PATCH /api/relay-jobs` | nhận thêm 2 field | không |
| `POST /api/relay-jobs/import` | nhận `device_profile`, `ua_mode` | không |
| `GET/POST/PATCH /api/stations` | thêm `client_device_profile_id`, `client_ua_prefix` | không |

## 7. UI thay đổi

- Form relay job: thêm select profile + preview UA + chế độ literal.
- Form trạm (nguồn trạm): thêm select profile + prefix.
- Trang Hệ thống: mục "Ngụy trang User-Agent" (mặc định + probe).
- Danh sách/chi tiết relay job: hiển thị `deviceProfile.name` thay vì chuỗi
  trống.
- Không dùng form inline; dialog/drawer theo AGENTS.md §15; nhãn tiếng Việt
  nhất quán; preview dùng font mono, `aria-live="polite"`.

## 8. Phân quyền

| Hành động | super_admin | admin | user |
|---|---|---|---|
| Xem danh sách profile | ✔ | ✔ | ✔ |
| Xem preview UA | ✔ | ✔ | ✔ |
| Tạo/sửa/xoá profile | ✔ | ✘ | ✘ |
| Gán profile vào relay job | ✔ | theo scope hiện có | theo scope hiện có |
| Gán profile vào trạm | ✔ | theo scope hiện có | ✘ (nếu đã chặn sửa trạm) |
| Đổi profile mặc định/probe | ✔ | ✘ | ✘ |

- Kiểm tra ở server (`requirePermission`), không chỉ ẩn UI.
- Ghi audit khi đổi `device_profiles`, khi đổi `device_profile_id` của job
  (audit không chứa secret; UA là dữ liệu công khai nên được phép ghi).

## 9. Tương thích và migration dữ liệu

1. `ua_prefix` cũ **giữ nguyên giá trị**, nhưng từ nay là **prefix**, không
   còn bị nối `-relay`. Job đang để trống → dùng profile mặc định.
2. Job đang có `ua_prefix` chứa chuỗi thiết bị đầy đủ (ví dụ
   `CHC LandStar/8.1.0.20241108`) sẽ thành `CHC LandStar/8.1.0.20241108 GNSSInternetRadio/2.4.7`
   nếu không chọn profile → **cần script kiểm tra**:
   - `scripts/check-device-profiles.mjs --dry-run` liệt kê job có
     `ua_prefix` chứa `/` hoặc dài > 20 ký tự.
   - Khuyến nghị admin chuyển các job này sang `ua_mode='literal'`.
3. Import JSON cũ (`src_*`/`dst_*`) vẫn chạy; nếu có `src_ua_prefix` thì map
   sang `ua_prefix`.
4. Không backfill `device_profile_id`; để NULL = default (D19-6) — tránh
   migration ghi đè lựa chọn của admin.

## 10. Test plan

### 10.1 Go — `deviceprofile`

- `TestVersionTemplates`: 4 template, giá trị nằm trong khoảng cho phép.
- `TestVersionDeterministic`: cùng `(code, seed)` → cùng version; khác seed →
  khác version (với xác suất cao, seed cố định trong test).
- `TestUserAgentNoRelaySuffix`: không chứa `relay`, `station`, `probe`.
- `TestUserAgentPrefix`: prefix rỗng = UA thiết bị; prefix `"NTRIP"` =
  `"NTRIP LandStar/..."`.
- `TestSeedParityWithNode`: bảng test-vector cố định dùng chung với Node
  (`server/tests/deviceProfilePreview.test.ts` đọc cùng file fixture
  `fixtures/device-profile-vectors.json`).

### 10.2 Go — `ntrip`

- `TestGetV1SendsNtripVersionHeader` (profile Trimble: `HTTP/1.1` +
  `Ntrip-Version: Ntrip/1.0` + `Connection: keep-alive`).
- `TestGetV2ConnectionClose` (profile mặc định).
- `TestUserAgentFromEndpoint`: header đúng byte, không có hậu tố lạ.
- `TestSourcePostUsesProfileUA`.
- Giữ nguyên `TestGetV2Chunked`, `TestSourcePostRaw`,
  `TestGetAuthFailure`, `TestGetTLS`.

### 10.3 Go — `relay` / `probe`

- `TestResolveUserAgentProfile` / `TestResolveUserAgentLiteral`.
- `TestBridgeSendsProfileUA` (mock caster trong `bridge_test.go` đọc header).
- `TestProbeUsesConfiguredProfile`.
- `TestNMEAIncludesGSAAndRMCPerProfile` (dùng `nmea_sender` + profile bật).
- `TestNMEAIntervalFromProfile` + `TestNMEAJitterBounds` (≤ 20%).
- `TestRoverMotionBounded`: sau 10.000 bước, khoảng cách tới gốc ≤ 10 km,
  tốc độ trong [1,4] m/s, có giai đoạn nghỉ.
- `TestRetryClassify`: bảng 6 case (permanent/short/temporary/unknown/
  RetryAfter/no-error) với jitter được mock.
- `TestProxyLegacyFormats`: 3 định dạng parse ra đúng addr/auth.
- `TestDownstreamCloseDetected`: downstream đóng → session kết thúc trong <2s.
- `go test ./...` + `go test -race ./internal/relay ./internal/ntrip`.

### 10.4 Node

- `relayJobs.test.ts`: schema nhận/từ chối `deviceProfileId`, `uaMode`;
  mapping response; import JSON có `device_profile`.
- `deviceProfiles.test.ts`: RBAC (user không được POST/PATCH/DELETE), không
  xoá builtin, preview trả đúng vector.
- `stations.test.ts`: upsert có `client_device_profile_id`.
- `stationCreatePort.test.ts` phải vẫn PASS (không đổi default port).

### 10.5 Frontend / Playwright

- `device-profile.spec.ts`: mở form relay job → chọn "CHC LandStar" → preview
  hiển thị `CHC LandStar/<version>` (không có `-relay`) → lưu → mở lại thấy
  đúng profile.
- `device-profile-literal.spec.ts`: chọn literal → nhập UA → preview đúng
  nguyên văn; rỗng → lỗi validate.
- `system-device-profile.spec.ts`: đổi profile probe ở trang Hệ thống.
- Chạy `npx playwright test` và `node ~/.config/opencode/skills/design-taste-frontend/scripts/inspect.mjs <url> --app`
  ở 1440/768/390, yêu cầu 0 FAIL + kiểm tra a11y thủ công.

### 10.6 Kiểm chứng bằng mock (bắt buộc trước khi kết luận)

1. `go run ./scripts/mock-ntrip` (mock caster) ghi log request line + header.
2. Tạo relay job với profile `chc_landstar`, bật job.
3. Xác nhận log mock:
   - `User-Agent: CHC LandStar/<x.y.z.YYYYMMDD>` (không `relay`).
   - `Ntrip-Version: Ntrip/2.0`, `Connection: close`.
4. Đổi sang `trimble_da2`: `HTTP/1.1` + `Ntrip-Version: Ntrip/1.0` +
   `Connection: keep-alive`.
5. Restart Go → UA **không đổi** (D19-3).
6. Đổi profile → UA đổi theo profile mới.

**Không** dùng mountpoint công cộng để test (AGENTS.md §9).

### 10.7 Gate

- `cd gnss && go test ./...` PASS.
- `cd server && npm test` PASS.
- `cd frontend && npm test` PASS + Playwright spec mới PASS.
- `node scripts/build-guide.mjs --check` PASS (nếu sửa docs-site).
- Không còn `grep -rn "CORS-MVP-relay\|CORS-MVP-probe\|CORS-MVP-station\|\-relay-test" gnss/ server/` trả kết quả.

## 11. Phân pha thực hiện

### P19-1 — Migration + baseline profile (nền)

- Viết `047_device_profiles.sql` + rollback note.
- Tạo `gnss/internal/deviceprofile` (baseline 12 profile + version/user-agent)
  kèm unit test + fixture vector dùng chung.
- Chưa nối vào relay để giảm rủi ro.
- **Nghiệm thu**: `go test ./internal/deviceprofile` PASS; migration chạy được
  trên DB trống và DB đang có dữ liệu; `information_schema` có 12 dòng.

### P19-2 — Nối UA vào relay + ntrip (bỏ `CORS-MVP-*`)

- `ntrip.Endpoint.Connection/HTTPVersion`, `userAgent()` mới.
- `resolveUserAgent()` trong `relay`, dùng cho session + Test.
- `store.go` đọc `device_profile_id`, `ua_mode`.
- **Nghiệm thu**: mock caster thấy UA theo profile; `grep` không còn
  `CORS-MVP-*`; test cũ PASS.

### P19-3 — Station source + probe

- `station_sources` cột mới, store/query, `RunStationSource`.
- Probe nhận profile từ `settings`.
- **Nghiệm thu**: station source mock thấy UA profile; probe mock thấy UA
  giống nhau giữa các trạm (D19-11).

### P19-4 — NMEA realism

- Profile-driven interval/jitter/HDOP/sats, GSA/RMC, altitude jitter.
- `rover_motion.go` + `motion` gate (mặc định TẮT).
- **Nghiệm thu**: test GSA/RMC; motion bounded; GGA không lặp y hệt.

### P19-5 — Transport + retry parity

- Proxy legacy formats + keepalive/NoDelay + proxy timeout.
- Buffer pool + downstream read probe.
- `retry.go` 3 nhánh + jitter + reset 60s + stagger 0–3s.
- **Nghiệm thu**: bảng test retry PASS; test proxy 3 định dạng PASS; test
  downstream close PASS.

### P19-6 — Node API + UI

- `deviceProfiles.ts`, mở rộng `relayJobs.ts`/`stations.ts`/`system.ts`.
- UI select + preview + literal + trang Hệ thống.
- Script kiểm tra `ua_prefix` cũ (`--dry-run`).
- **Nghiệm thu**: Playwright PASS; RBAC PASS; audit ghi nhận thay đổi.

### P19-7 — Tài liệu + tổng kiểm tra

- Cập nhật `docs-site/docs/07-relay.md` (mục "Ngụy trang User-Agent"),
  `AGENTS.md` §9 (ghi quyết định D19-1 + cấm dùng cho mục đích thương mại),
  `SESSION.md`.
- Chạy toàn bộ gate 10.7 + `graphify update .` (không trỏ vào backup).
- **Nghiệm thu**: checklist mục 12 PASS, không còn FAIL mở.

## 12. Checklist nghiệm thu

- [ ] Migration 047 chạy idempotent trên DB trống và DB prod-copy.
- [ ] 12 device profile có trong DB, đúng thông số bảng 5.1.
- [ ] Không còn chuỗi `CORS-MVP-relay`, `CORS-MVP-probe`,
      `CORS-MVP-station`, `-relay-test` trong mã nguồn.
- [ ] UA gửi đi = `TênThiếtBị/Version` (hoặc `prefix + " " + ...`), version
      ổn định qua restart.
- [ ] `Ntrip-Version`, `Connection` đúng theo profile (Trimble/Leica khác
      profile thường).
- [ ] Station source và probe dùng profile (không dùng UA relay).
- [ ] GSA/RMC gửi đúng theo profile; interval/jitter đúng khoảng.
- [ ] `motion` mặc định TẮT; bật `rover` vẫn nằm trong bán kính 10 km.
- [ ] Retry 3 nhánh + jitter + reset 60s + stagger 0–3s có test.
- [ ] Proxy nhận 3 định dạng; keepalive/no-delay bật cho kết nối ra.
- [ ] UI chọn profile + preview + literal hoạt động; RBAC đúng; audit ghi.
- [ ] Import JSON cũ không lỗi; script kiểm tra `ua_prefix` chạy được.
- [ ] `go test ./...`, `npm test` (server, frontend), Playwright PASS.
- [ ] `node scripts/mock-ntrip` xác nhận header như mục 10.6.
- [ ] `graphify update .` chạy xong, không trỏ vào `relayrtcm/backup`.
- [ ] `SESSION.md` cập nhật: đã làm / chưa làm / lỗi / cách chạy.

## 13. Rủi ro và rollback

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Caster từ chối UA lạ (một số caster whitelist UA) | Cao | `ua_mode='literal'` per job; log rõ khi 401/403; không tự đổi UA khi lỗi |
| Đổi ngữ nghĩa `ua_prefix` làm UA dài bất thường | TB | Script kiểm tra + cảnh báo; giữ literal mode |
| Version ngẫu nhiên trông giả (quá mới/quá cũ) | TB | Giới hạn khoảng như code cũ; chỉ sinh version trong template |
| Mô phỏng di chuyển làm sai VRS của người dùng thật | Cao | Mặc định TẮT; chỉ bật per job; giới hạn 10 km; ghi cảnh báo UI |
| `device_profile_id` NULL ở job cũ → UA đổi so với trước | TB | D19-6 default trung tính; thông báo trước khi deploy |
| Nhiều job cùng một IP dùng cùng profile → dễ bị nhóm | TB | Seed theo `target_id` để version khác nhau; khuyến nghị đa dạng profile |
| Vi phạm ToS caster | TB | D19-1: chỉ dùng nội bộ/được phép; ghi vào AGENTS.md |
| Probe đổi UA gây sai lệch fingerprint cũ | Thấp | Fingerprint probe chỉ dùng nội bộ (credential/GGA), không phải UA |
| Nút Test dùng UA thật gây kết nối trùng | Thấp | Test dùng cùng profile nhưng tách `target_id` seed riêng |

**Rollback:** migration chỉ thêm bảng/cột (không xoá), rollback = tắt
`device_profile_id`/`ua_mode` ở tầng code + trả `ua_prefix` literal
(`ua_mode='literal'`, `ua_prefix='CORS-MVP-relay'` nếu buộc phải khôi phục
hành vi cũ). Không cần rollback DB.

## 14. Tài liệu cần cập nhật

1. `docs-site/docs/07-relay.md` — mục "Ngụy trang User-Agent (device profile)",
   giải thích profile, preview, literal mode, cảnh báo ToS.
2. `AGENTS.md` §9 — bổ sung quy tắc: device-profile spoofing được phép cho
   mục đích phi thương mại; cấm dùng cho bán lại dịch vụ; không dùng tên
   thiết bị để gây nhầm lẫn cho khách hàng bên thứ ba.
3. `docs/0/KE_HOACH_CHI_TIET.md` — bảng cột `relay_jobs`/`station_sources`.
4. `SESSION.md` — tiến độ từng phase.
5. `README.md` (nếu có mục cấu hình relay) — thêm 2 field mới.

## 15. Điểm mở đã chốt (2026-11-08)

Cả 6 điểm mở đã được xác nhận, áp dụng đúng đề xuất:

| # | Điểm mở | Chốt | Quyết định |
|---|---|---|---|
| 1 | Seed version | `hash(profile_code) ^ target_id ^ role_salt`, không thêm cột seed | D19-3, D19-19 |
| 2 | Station source literal | Chỉ profile ở phase này; custom profile cho case đặc biệt | D19-20 |
| 3 | Probe xoay profile | Không xoay; 1 profile toàn cục + chừa `receiver_type_alias` | D19-22 |
| 4 | Motion cho station source | Không | D19-23 |
| 5 | Lưu UA thật | Có, vào bảng session ở P19-6 | D19-21 |
| 6 | Port `WEB_USER`/`WEB_PASS` | Không | D19-24 |

Bổ sung: toàn bộ kế hoạch triển khai **local only** (D19-25).

## 16. Bộ prompt thực thi (dùng cho agent/người chạy kế hoạch)

Quy ước chung cho **mọi** prompt dưới đây:

- **Không dừng giữa chừng** trừ khi: thiếu credential/dịch vụ bắt buộc, hoặc
  thao tác có nguy cơ phá dữ liệu cần xin phép. Gặp lỗi thường → tự quyết,
  sửa, ghi lại quyết định trong tài liệu rồi đi tiếp.
- **Token tiết kiệm**: ưu tiên `graphify query "..." --budget 1500`,
  `graphify explain "<symbol>"`, `grep` có `path`/`include` hẹp. Không đọc lại
  toàn repo, không đọc file > 500 dòng nếu chỉ cần 1 khu vực.
- **Graphify**: chỉ chạy trên thư mục dự án; **tuyệt đối không** trỏ vào
  `relayrtcm/backup`. Chạy `graphify update .` sau khi thêm/xoá file hoặc đổi
  cấu trúc gói.
- **PowerShell**: nếu cần script `.ps1` (thao tác Windows), viết theo chuẩn
  tiếng Việt có dấu: comment-based help `.SYNOPSIS/.DESCRIPTION/.EXAMPLE`,
  `[CmdletBinding()]`, `$ErrorActionPreference='Stop'`, `chcp 65001` +
  `[Console]::OutputEncoding = UTF8`, thông báo `throw`/`Write-Host` bằng tiếng
  Việt, mặc định `-DryRun` và phải có `-Apply` mới ghi. Việc xử lý dữ liệu
  thông thường dùng `.mjs` (Node) để chạy được cả Linux.
- **Commit**: 1 commit/phase, thông điệp `P19-n: <mô tả ngắn có dấu>`, gộp
  code + tài liệu + `SESSION.md`; push `main` ngay sau mỗi phase.
- **Tài liệu**: sau mỗi phase ghi kết quả vào mục 17 của chính file này (mẫu
  như `docs/1/18_...md` mục 16), kèm lệnh đã chạy + PASS/FAIL.
- **Todo**: cập nhật `todowrite` **ngay sau** mỗi phase (đánh `completed`,
  đánh `in_progress` phase kế tiếp). Không bao giờ để todo lệch thực tế.
- **Phạm vi**: chỉ sửa local; không deploy VPS, không chạy `hot_update.sh`,
  không chạy `relay.exe`, không chiếm `8081`/`2101`, không chạm
  `relayrtcm/backup`, không commit secret.

### 16.1 Prompt khởi động (dán đầu phiên)

```text
Bạn là agent triển khai "Kế hoạch 19" của dự án quản lý trạm CORS/NTRIP/RTCM.

BẮT BUỘC ĐỌC TRƯỚC KHI LÀM:
1. AGENTS.md (toàn bộ) — quy tắc bất biến, đặc biệt mục 5, 9, 13, 15, 17.
2. docs/1/19_KE_HOACH_DEVICE_PROFILE_ROVER.md (toàn bộ) — phạm vi, quyết định
   D19-1..D19-25, thiết kế 5.x, test plan 10.x, 7 phase P19-1..P19-7.
3. docs/1/18_KE_HOACH_5_YEU_CAU_VAN_HANH.md mục 16 — mẫu ghi kết quả.

QUY TẮC BẤT BIẾN:
- Chỉ sửa local. KHÔNG deploy VPS, KHÔNG chạy hot_update.sh.
- KHÔNG sửa/chạy/xoá gì trong F:\3.Laptrinh\1. Project\1. GNSS\relayrtcm\backup.
- KHÔNG chạy relay.exe, KHÔNG chiếm cổng 8081 hoặc 2101.
- KHÔNG commit secret; KHÔNG thêm Redis/Kafka/RabbitMQ/K8s/UI kit mới.
- KHÔNG tuyên bố PASS khi chưa chạy test có bằng chứng.
- Mock-first; không test với mountpoint công cộng.

CÁCH LÀM VIỆC (lặp đúng thứ tự cho từng phase, không bỏ bước):
B1. Tạo TODO TỔNG bằng todowrite: 7 phase P19-1..P19-7 + "báo cáo cuối".
B2. Kiểm tra tài liệu liên quan của phase (docs/1/19 mục tương ứng, AGENTS,
    docs/0 nếu cần) và khảo sát code bằng graphify + grep hẹp.
B3. Triển khai phase n đúng phạm vi, tối thiểu hóa diff, theo style code sẵn có.
B4. Test theo checklist của phase: Go, Node, frontend, Playwright; sửa mọi lỗi
    đến khi PASS. Ghi lại lệnh + kết quả.
B5. Cập nhật kết quả vào mục 17 của docs/1/19 (heading "### P19-n — ...", ngày,
    file đã sửa, lệnh test, PASS/FAIL, ghi chú/ngoại lệ).
B6. Cập nhật TODOS ngay (completed phase n, in_progress phase n+1).
B7. Commit + push: "P19-n: <mô tả ngắn>".
B8. Sang phase n+1 và lặp B2..B7. Chỉ dừng khi hết P19-7 hoặc gặp lỗi nghiêm
    trọng cần xin phép.

TIẾT KIỆM TOKEN: dùng graphify query --budget 1500 / explain symbol; grep hẹp;
không đọc lại file đã đọc; không chạy lại test đã PASS trừ khi có sửa liên quan.

BẮT ĐẦU: thực hiện B1 rồi P19-1. Không hỏi lại các quyết định đã chốt ở mục 2
và 15 của kế hoạch. Khi tất cả phase xong: báo cáo tổng hợp cuối cùng (bảng
phase, file, test, commit SHA, việc còn lại).
```

### 16.2 Prompt từng phase (dùng khi muốn chạy tay từng bước)

**P19-1 — Migration + baseline profile**

```text
Thực hiện P19-1 của docs/1/19_KE_HOACH_DEVICE_PROFILE_ROVER.md.
Phạm vi: db/migrations/admin/047_device_profiles.sql; gói mới
gnss/internal/deviceprofile (profile.go, version.go, user_agent.go,
profile_test.go, fixture vectors). Chưa nối vào relay.
Yêu cầu: đúng bảng 5.1 (12 profile), cột receiver_type_alias, quyền
device_profiles.view/edit, settings seed 3 khoá; version tất định theo
D19-3/D19-19; có test-vector JSON dùng chung cho Node sau này.
Test: go test ./internal/deviceprofile; chạy migration trên DB local (docker
compose), kiểm tra 12 dòng + idempotent. Không deploy VPS.
Xong: ghi kết quả mục 17, cập nhật todo, commit "P19-1: ...", push.
```

**P19-2 — Nối UA vào relay + ntrip**

```text
Thực hiện P19-2. Phạm vi: gnss/internal/ntrip (Endpoint thêm
Connection/HTTPVersion; userAgent bỏ fallback CORS-MVP-relay), relay/types.go,
relay/store.go (đọc device_profile_id, ua_mode), relay/bridge.go
(toNtripEndpoint + resolveUserAgent), relay/manager.go (bỏ -relay-test).
Bỏ mọi hậu tố -relay/-relay-test. Literal mode dùng ua_prefix nguyên văn.
Test: go test ./internal/ntrip ./internal/relay; mock caster xác nhận header
cho chc_landstar và trimble_da2 (HTTP/Ntrip-Version/Connection); UA không đổi
sau restart; grep không còn CORS-MVP-relay.
Xong: ghi mục 17, todo, commit "P19-2: ...", push.
```

**P19-3 — Station source + probe**

```text
Thực hiện P19-3. Phạm vi: db/migrations/admin/047 (nếu cần tách) hoặc bổ sung
cột client_device_profile_id/client_ua_prefix; station_source.go (query, config,
RunStationSource, bỏ "CORS-MVP-station"); probe/manager.go (Options.Profile,
bỏ "CORS-MVP-probe"); cmd/corsd/main.go nạp profile từ settings
device_profile.probe; store đọc settings.
Test: go test ./internal/relay ./internal/probe; mock caster xác nhận UA
station source theo profile, probe dùng cùng 1 profile giữa các trạm.
Xong: ghi mục 17, todo, commit "P19-3: ...", push.
```

**P19-4 — NMEA realism**

```text
Thực hiện P19-4. Phạm vi: relay/nmea_sender.go (interval/jitter/hdop/sats theo
profile, gửi GSA/RMC theo SendGSA/SendRMC với xác suất 1/3 và 1/4, altitude
jitter ±0.5m), file mới relay/rover_motion.go (waypoint 10km/2km/1-4mps/60-300s
nghỉ, ≤40m coi là tới), gate motion: chỉ relay job, mặc định TẮT (D19-23).
Test: nmea_sender_test bổ sung, rover_motion_test (bounded 10km, speed range,
có giai đoạn nghỉ), motion stubbed rng để tất định.
Xong: ghi mục 17, todo, commit "P19-4: ...", push.
```

**P19-5 — Transport + retry parity**

```text
Thực hiện P19-5. Phạm vi: gnss/internal/proxy (3 định dạng proxy, KeepAlive 30s,
SetNoDelay, ProxyDialTimeout 10s), relay/bridge.go (buffer pool 32KB, goroutine
đọc downstream phát hiện đóng), relay/retry.go mới (3 nhánh delay + jitter ±10%
+ reset > 60s), relay/job.go áp dụng retry mới, stagger 0-3s khi start job.
Test: go test ./internal/proxy ./internal/relay (retry table 6 case, legacy
proxy formats, downstream close < 2s, pool không race: go test -race).
Xong: ghi mục 17, todo, commit "P19-5: ...", push.
```

**P19-6 — Node API + UI + runtime UA**

```text
Thực hiện P19-6. Phạm vi: db/migrations/runtime/010_session_user_agent.sql;
server/src/routes/deviceProfiles.ts mới (GET, preview, CRUD theo quyền);
relayJobs.ts (deviceProfileId, uaMode, select/insert/update/response/import);
stations.ts (2 cột client_*); system.ts (default + probe); frontend
RelayJobs.tsx (select profile + prefix + literal + preview debounce 300ms),
Stations.tsx (tab nguồn trạm), trang Hệ thống, types.ts; writer Go ghi
user_agent vào session (relay + station source).
Test: server npm test; frontend npm test + tsc; Playwright device-profile.spec.ts,
device-profile-literal.spec.ts, system-device-profile.spec.ts; inspect.mjs
1440/768/390 với 0 FAIL.
Xong: ghi mục 17, todo, commit "P19-6: ...", push.
```

**P19-7 — Tài liệu + tổng kiểm tra**

```text
Thực hiện P19-7. Cập nhật docs-site/docs/07-relay.md (mục Ngụy trang
User-Agent), AGENTS.md mục 9 (D19-1 + cấm dùng thương mại), README nếu có,
SESSION.md. Chạy gate 10.7 đầy đủ: go test ./..., server npm test, frontend
npm test + Playwright toàn bộ, node scripts/build-guide.mjs --check,
graphify update .
Kiểm tra cuối: grep không còn CORS-MVP-relay/-probe/-station/-relay-test;
checklist mục 12 đánh dấu đủ.
Xong: ghi mục 17, todo completed toàn bộ, commit "P19-7: ...", push, rồi báo
cáo tổng hợp cuối (bảng phase/file/test/SHA/việc còn lại). Không deploy VPS.
```

### 16.3 Prompt tiếp tục khi phiên bị ngắt

```text
Tiếp tục Kế hoạch 19 (docs/1/19_KE_HOACH_DEVICE_PROFILE_ROVER.md).
Đọc mục 17 "Kết quả thực hiện" để biết phase đã xong, đọc git log -5 để xác
nhận commit gần nhất, rồi tiếp tục đúng phase kế tiếp theo quy trình mục 16.1
(B2..B7). Không làm lại phase đã PASS.
```

## 17. Kết quả thực hiện

> Ghi lần lượt sau mỗi phase. Mẫu:
>
> ```markdown
> ### P19-n — <tên phase> (YYYY-MM-DD)
>
> - Phạm vi đã sửa: ...
> - Migration: ... (nếu có)
> - Test: `<lệnh>` → PASS/FAIL (số test)
> - Playwright: `<spec>` → PASS/FAIL
> - Sai lệch so với kế hoạch: ... (nếu có, kèm lý do)
> - Commit: `<sha>` — `<message>`
> ```

### P19-1 — Migration 047 + gói `deviceprofile` (2026-11-08)

- Phạm vi đã sửa:
  - `db/migrations/admin/047_device_profiles.sql` (mới): bảng `device_profiles`,
    12 profile baseline, `relay_jobs.device_profile_id/ua_mode/motion_enabled`,
    `station_sources.client_device_profile_id/client_ua_prefix`, 3 setting
    `device_profile.*`, quyền `device_profiles.view/edit`.
  - `gnss/internal/deviceprofile/` (mới): `profile.go`, `rng.go`, `version.go`,
    `user_agent.go`, `profile_test.go`,
    `testdata/device-profile-vectors.json` (fixture dùng chung với Node).
- Migration:
  - DB local đang có dữ liệu: `docker compose exec -T server sh -c "node dist/db/migrate.js"`
    → `admin 047_device_profiles.sql applied`; chạy lại → `admin=0 runtime=0`
    (idempotent qua `schema_migrations`).
  - DB trống (`cors_admin_fresh`/`cors_runtime_fresh`): áp toàn bộ 47 admin +
    9 runtime migration → PASS; `device_profiles` = 12 dòng, 2 quyền
    `device_profiles.*`; đã drop DB tạm sau khi kiểm tra.
- Test: `cd gnss && go test ./...` → PASS toàn bộ (package mới 9 test:
  Baseline, Resolve, Normalize, VersionRanges, VersionDeterministic, Seed,
  UserAgent, NMEAInterval, Vectors).
- Playwright: không áp dụng ở phase này (chưa đổi UI).
- Sai lệch so với kế hoạch:
  - Bổ sung cột `relay_jobs.motion_enabled` (mặc định 0) ngay trong 047 thay vì
    chờ migration 048, để P19-4 có công tắc per-job mà không phải thêm
    migration giữa kế hoạch.
  - Fixture đặt tại `gnss/internal/deviceprofile/testdata/` (chuẩn Go) thay vì
    `fixtures/` ở gốc repo; Node sẽ đọc qua đường dẫn này ở P19-6.
  - Không thêm cột version range vào DB: khoảng version lấy theo template,
    đúng `generateUserAgent()` của code cũ.
- Commit: `8b527b4` — `P19-1: migration 047 device profile + goi deviceprofile baseline`.

### P19-2 — Nối UA profile vào `ntrip` + `relay` (2026-11-08)

- Phạm vi đã sửa:
  - `gnss/internal/ntrip/ntrip.go`: `Endpoint` thêm `HTTPVersion`, `Connection`;
    `userAgent()` bỏ fallback `CORS-MVP-relay`; `Get()`/`openSource()` gửi
    `Ntrip-Version` theo v1/v2, HTTP version theo profile, `Connection` theo
    profile; bỏ header UA nếu rỗng.
  - `gnss/internal/relay/types.go`: `EndpointConfig` thêm `HTTPVersion`,
    `Connection`; `JobConfig` thêm `DeviceProfileID`, `DeviceProfile`, `UAMode`,
    `MotionEnabled`.
  - `gnss/internal/relay/store.go`: `jobColumns`/`scanJob` đọc
    `device_profile_id`, `ua_mode`, `motion_enabled`; thêm `loadProfiles()`
    (đọc `device_profiles`) và `resolveDeviceProfile()` (fallback baseline).
  - `gnss/internal/relay/useragent.go` (mới): `resolveUserAgent()` cho chế độ
    `profile` và `literal`, không nối hậu tố `-relay`/`-relay-test`.
  - `gnss/internal/relay/bridge.go`, `manager.go`: dùng `resolveUserAgent()` +
    `toNtripEndpoint(endpoint, ua, profile)`.
  - `gnss/internal/relay/station_source.go`: chỉ cập nhật chữ ký
    `toNtripEndpoint` (giữ tạm UA cũ; P19-3 sẽ thay bằng profile của trạm).
- Migration: không có (đã làm ở P19-1).
- Test:
  - `cd gnss && go test ./internal/ntrip ./internal/relay` → PASS.
  - `cd gnss && go test ./...` → PASS toàn bộ.
  - `TestGetSendsProfileHeaders`: mock caster nhận đúng `HTTP/1.1` +
    `Ntrip/1.0` + `keep-alive` (Trimble) và `Ntrip/2.0` + `close` (CHC).
  - `TestGetOmitsEmptyUserAgent`: không còn UA fallback nội bộ.
  - `TestBridgeSendsProfileHeaders`: request thật qua bridge có
    `User-Agent: Trimble DA2/<version>`, không có `-relay`/`CORS-MVP`.
- Playwright: không áp dụng (chưa đổi UI).
- Sai lệch so với kế hoạch:
  - `Ntrip-Version`/`HTTP version` của endpoint tường minh vẫn thắng profile
    (tương thích dữ liệu cũ); profile chỉ điền khi endpoint để trống hoặc
    cùng họ phiên bản. Lý do: `station_sources` cũ đang ép `v1` + `HTTP/1.0`.
- Commit: `d9f28e9` — `P19-2: noi User-Agent theo device profile vao ntrip va relay`.

### P19-3 — Station source + probe dùng profile (2026-11-08)

- Phạm vi đã sửa:
  - `gnss/internal/relay/station_source.go`: `StationSourceConfig` thêm
    `DeviceProfileID/DeviceProfile/UAPrefix`; query đọc
    `client_device_profile_id`, `client_ua_prefix`; load profile một lần cho
    toàn bộ danh sách; `RunStationSource` dùng `resolveStationUserAgent()`.
  - `gnss/internal/relay/useragent.go`: thêm `resolveStationUserAgent()`
    (profile only — D19-20; seed `RoleStation` + station ID).
  - `gnss/internal/relay/store.go`: tách `loadDeviceProfiles(ctx, db)` dùng
    chung cho relay job và station source.
  - `gnss/internal/probe/manager.go`: `Options.Profile`/`UAPrefix`; bỏ
    `UserAgent: "CORS-MVP-probe"`; endpoint dùng Ntrip-Version/HTTP/Connection
    của profile.
  - `gnss/internal/probe/store.go`: `LoadDeviceProfile()` đọc
    `settings['device_profile.probe']`.
  - `gnss/cmd/corsd/main.go`: nạp profile probe lúc khởi động.
- Migration: không có (cột `station_sources.client_*` đã thêm ở 047).
- Test:
  - `cd gnss && go test ./internal/relay ./internal/probe ./internal/ntrip` → PASS.
  - `cd gnss && go test ./...` → PASS toàn bộ.
  - `TestRunStationSourceUsesProfileUserAgent`: mock caster nhận đúng
    `User-Agent: NTRIP CHC LandStar/<version>`, không còn `CORS-MVP`.
  - `TestProbeSendsConfiguredProfileUserAgent`: probe gửi UA Trimble +
    `Ntrip-Version: Ntrip/1.0`; `TestProbeProfileStableAcrossStations`: cùng
    seed `(code, 0, probe)` nên UA cố định giữa các trạm.
- Playwright: không áp dụng (chưa đổi UI).
- Sai lệch so với kế hoạch:
  - Probe chỉ resolve được profile **builtin** (settings lưu `code`); profile
    custom trong DB sẽ cần bổ sung ở P19-6 nếu admin tạo profile riêng.
  - Chưa lưu UA vào `station_source_sessions` (để P19-6 theo D19-21).
- Commit: cập nhật sau khi push.
