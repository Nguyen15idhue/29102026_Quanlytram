# BÁO CÁO RÀ SOÁT BẢO MẬT MÃ NGUỒN

- **Dự án:** Hệ thống quản lý trạm CORS/NTRIP/RTCM (`29102026_Quanlytram`)
- **Thời điểm rà soát:** 2026-11-01 (Asia/Ho_Chi_Minh, +07:00)
- **Commit nền:** `b5763fd` (`feat(system): P07-5 giao diện tab Tối ưu và Tự động hóa`)
- **Trạng thái working tree:** có thay đổi chưa commit của các phiên khác (MapCanvas/MapLegend/StationListDrawer/UnifiedMap/System, caster GGA, ops/map). Báo cáo đọc trên **working tree hiện tại**, không chỉ HEAD.
- **Tính chất:** rà soát **read-only** ở mức mã nguồn/cấu hình. **Không sửa code, không chạy relay, không chiếm cổng 8081/2101, không test với endpoint NTRIP công cộng.**
- **Công cụ:** `graphify` (graph có sẵn trong `graphify-out/`), đọc mã nguồn trực tiếp, `Select-String`/grep. Không chạy `npm audit` (cần mạng) và không chạy pentest động.

> Kết luận nhanh: không phát hiện lỗi **SQL injection / command injection / XSS trực tiếp** trong mã ứng dụng. Rủi ro cần ưu tiên (đã hiệu chỉnh theo use case fan-in/fan-out) là: (1) seed bật lại/ghi đè tài khoản khi dùng ở production, (2) NTRIP caster plaintext **nếu mở Internet**, (3) tái dùng credential trạm cho host khác ở endpoint lấy sourcetable, (4) import người dùng vượt cấp bậc, (5) cấu hình production (cookie/HTTPS, dev server). Các đề xuất **không** dùng giới hạn theo IP vì 100 trạm từ một IP là hợp lệ.

---

## 1. Phạm vi và phương pháp

### 1.1 Trong phạm vi
- `server/src/**` (Express, auth/session/CSRF, RBAC/scope, crypto, audit, tất cả router).
- `gnss/**` (NTRIP caster, relay, probe, quality, internal API HMAC, DB, secret AES-GCM).
- `frontend/src/**` (auth client, map popup/marker, cấu hình API).
- `db/migrations/**`, `db/init/01-init.sh`.
- `docker-compose.yml`, `.env.example`, `frontend/nginx.conf`, `frontend/Dockerfile`, `server/Dockerfile`, `gnss/Dockerfile`.
- `graphify-out/GRAPH_REPORT.md` + `graphify-out/graph.json` để dựng bản đồ module/quan hệ.

### 1.2 Ngoài phạm vi / chưa thực hiện
- Không chạy thử nghiệm khai thác thật (SSRF, brute-force, DoS) trên hệ thống đang chạy.
- Không quét CVE dependency (`npm audit`, `govulncheck`) — cần mạng và môi trường riêng.
- Không kiểm thử byte-stream RTCM thật; không đọc/không in giá trị `secrets/real-relays.json` hay `.env.local`.
- Không đánh giá hạ tầng VPS/firewall/reverse proxy thực tế (chỉ đọc cấu hình trong repo).

### 1.3 Quy ước mức độ
| Mức | Ý nghĩa |
|---|---|
| High | Khai thác được → chiếm tài khoản/chiếm credential/lộ dữ liệu diện rộng, hoặc phá vỡ ranh giới tenant |
| Medium | Cần điều kiện nhất định (quyền đăng nhập, quyền DB, mạng nội bộ) nhưng hậu quả nghiêm trọng |
| Low | Giảm chiều sâu phòng thủ, lộ thông tin nhỏ, hoặc lỗi nhất quán |
| Info | Ghi nhận/khuyến nghị, không phải lỗ hổng trực tiếp |

### 1.4 Bối cảnh sử dụng thực tế (dùng để hiệu chỉnh mức độ)

Các kết luận dưới đây được hiệu chỉnh theo mô hình vận hành thực tế, **không áp dụng máy móc theo lý thuyết**:

- **Fan-in hợp lệ từ một IP:** một hệ thống nguồn (ví dụ hệ thống X) có thể đẩy **100 trạm** sang caster của ta, tương đương **100 kết nối SOURCE từ cùng một IP**. Tương tự, nhiều rover của cùng một khách hàng thường đi qua NAT chung một IP.
- **Fan-out hợp lệ từ một IP:** một relay job hoặc một hệ thống relay có thể mở nhiều kết nối ra **cùng một upstream IP**; không được coi số kết nối lớn từ một IP là dấu hiệu tấn công.
- **Không dùng giới hạn theo IP làm biện pháp chính.** Giới hạn phải theo **listener/tổng tài nguyên** và theo **account/mountpoint** (đã có `MaxConnections`). IP chỉ dùng để phát hiện **chuỗi xác thực sai bất thường** với ngưỡng cao, hoặc chặn tạm IP có hành vi phá hoại rõ ràng — không chặn theo số kết nối hợp lệ.
- **Nhiều upstream nội bộ là hợp lệ:** relay/probe có thể trỏ tới host RFC1918 trong mạng của khách hàng. Vì vậy không nên “chặn cứng toàn bộ IP nội bộ”; chỉ chặn **metadata/link-local/loopback** trừ khi quản trị viên chủ động cho phép.
- **Mặc định dev ≠ production:** các giá trị như `SESSION_COOKIE_SECURE=false`, Vite dev server, seed chạy khi start là chấp nhận được trong môi trường phát triển; chỉ trở thành lỗi khi triển khai thật. Mức độ của các mục liên quan được ghi kèm điều kiện.

---

## 2. Bảng tổng hợp phát hiện

| ID | Mức | Vùng | Vị trí | Tóm tắt |
|---|---|---|---|---|
| F-01 | Medium | Tài khoản | `server/src/routes/webUsers.ts:391`, `db/seed.ts:231` | User import mặc định `123456` (đúng đặc tả docs) nhưng chưa buộc đổi lần đầu |
| F-02 | High | Vòng đời tài khoản | `db/seed.ts:127-136`, `docker-compose.yml` (server command) | Seed chạy mỗi lần start: tài khoản bị lock/disable tự bật lại, role/company bị ghi đè |
| F-03 | Medium | NTRIP caster | `docker-compose.yml` (ports 1509/1508), `gnss/internal/caster/listener.go:269-300` | Basic auth plaintext, không TLS — **High nếu mở Internet**, chấp nhận được trong mạng nội bộ/VPN |
| F-04 | Medium | Outbound/nhầm credential | `server/src/routes/stations.ts:2361-2412` | Endpoint lấy sourcetable cho phép host tùy ý (cần cho nghiệp vụ) + tái dùng password đã lưu cho host khác |
| F-05 | Low (cần quyền ghi DB) | Crypto | `server/src/lib/crypto.ts:19-31`, `gnss/internal/secret/aes.go` | AES-GCM không AAD → hoán đổi ciphertext giữa các dòng; không rotation |
| F-06 | Medium | DoS caster | `gnss/internal/caster/listener.go:34-46` | Không giới hạn tổng connection listener, không hạn chế **xác thực sai**; (fan-in 100 trạm/1 IP là hợp lệ, không giới hạn theo IP) |
| F-07 | Medium | Authz import | `server/src/routes/webUsers.ts:397-421` | Import bỏ qua `assertCanTarget`: hạ cấp/khóa user cấp cao hơn trong cùng công ty |
| F-08 | Low | CSRF | `server/src/routes/mapConfig.ts:18-20,43,67` | Router thiếu `csrfProtection`; khó khai thác thực tế do `SameSite=Lax` + CORS + JSON preflight |
| F-09 | Low | Rate limit/IP | `server/src/app.ts:54,75-92`, `server/src/lib/http.ts` (`clientIp`) | `trust proxy=1` vô điều kiện → spoof `X-Forwarded-For` khi Node bị truy cập trực tiếp (chỉ web login/audit) |
| F-10 | Medium (production) | Cookie/HTTPS | `server/src/config.ts:42`, `server/src/routes/auth.ts:89-95` | `SESSION_COOKIE_SECURE=false` mặc định dev; production phải bật + TLS/HSTS |
| F-11 | Low (dev) / Medium (prod) | Triển khai web | `docker-compose.yml` (service `web`), `frontend/nginx.conf` | Compose đang chạy Vite dev (phù hợp dev); khi production phải dùng nginx + `dist` và thêm security header |
| F-12 | Low | Database | `server/src/db/pool.ts:4-16`, `gnss/internal/db/db.go:23-36`, `db/init/01-init.sh:19-32` | MySQL không TLS + user `'%'` (chấp nhận trong mạng Docker nội bộ); Medium nếu DB nằm ngoài host |
| F-13 | Medium | Audit | `server/src/lib/audit.ts:29-55`, `server/src/routes/auth.ts` | `writeAudit` nuốt lỗi; không audit login success/fail/lock |
| F-14 | Low | Go HTTP | `gnss/cmd/corsd/main.go:136-139` | Chỉ `ReadHeaderTimeout`, thiếu Read/Write/Idle timeout |
| F-15 | Low | Tile proxy | `server/src/routes/map.ts:28-30,68-108`, `server/src/lib/tileProxy.ts` | Mọi user đăng nhập đều proxy tile (không cần permission riêng), cache 256, không rate-limit riêng |
| F-16 | Low | Realtime tenant | `server/src/realtime/socket.ts:402-408`, `server/src/realtime/filter.ts:154-160` | Tick realtime không truyền `tenantIds` → user scope tenant thấy snapshot hẹp hơn REST (nhất quán, không leo quyền) |
| F-17 | Info | Caster listener | `server/src/lib/caster.ts:4-13` | Cho phép port 1..65535 (trừ 2101/8081); chỉ là hardening, không bắt buộc dải cố định |
| F-18 | Low | Login | `server/src/routes/auth.ts:53-66` | User enumeration qua 403 `ACCOUNT_LOCKED`/`COMPANY_DISABLED`; timing khi user không tồn tại |
| F-19 | Low | Health | `server/src/app.ts:110-116` | `/health` công khai trả `err.message` của DB |
| F-20 | Low | Chính sách MK | `server/src/routes/webUsers.ts:29,40`, `server/src/lib/password.ts` | Tối thiểu 8 ký tự; không nên hard-lock theo username (rủi ro khóa admin), ưu tiên delay/audit |
| F-21 | Low | Audit dashboard | `server/src/routes/ops.ts` (`recentAudit`, `idsFor('own')`) | Scope `own` dùng subtree → hiển thị audit của cấp dưới |
| F-22 | Info | Bí mật vận hành | `secrets/real-relays.json` (gitignored) | Credential relay thật nằm trên máy dev; chỉ bảo vệ bằng `.gitignore` + quyền file |
| F-23 | Info | Dependency | `server/package.json`, `frontend/package.json`, `gnss/go.mod` | Chưa có kết quả CVE (chưa chạy audit/govulncheck) |

---

## 3. Chi tiết phát hiện

### F-01 [Medium] Mật khẩu mặc định cho user import (đúng đặc tả, thiếu buộc đổi)

**Vị trí**
- `server/src/routes/webUsers.ts:391` — `const passwordHash = await hashPassword('123456');`
- `server/src/routes/webUsers.ts:424-432` — INSERT user mới dùng hash này.
- `db/seed.ts:231` — `caster_password: config.seed.ntripPassword || '12345678'`.
- `db/seed.ts:127` — hash mật khẩu seed.

**Bằng chứng**
```ts
// webUsers.ts (import)
const passwordHash = await hashPassword('123456');
...
[item.username, passwordHash, item.displayName, ...]
```
`hashPassword` nhận trực tiếp chuỗi 6 ký tự, **không** đi qua zod `min(8)` (zod chỉ áp cho tạo/sửa user thường).

**Tác động (theo use case)**
- User tạo qua `POST /api/web-users/import` có mật khẩu `123456` cho đến khi đổi. Đây là **hành vi đúng đặc tả** trong `AGENTS.md`/docs (import không có cột password), nên không coi là lỗi code; rủi ro nằm ở việc **không có cơ chế buộc đổi**.
- Nếu hệ thống chỉ chạy nội bộ, username ít lộ, rủi ro thực tế ở mức trung bình. Nếu có truy cập Internet hoặc danh sách username bị lộ, rủi ro tăng rõ rệt (kẻ tấn công chỉ cần đúng 1 tài khoản chưa đổi MK).
- Tài khoản NTRIP seed dùng `12345678` chỉ khi `SEED_NTRIP_PASSWORD` rỗng; `config.ts` bắt buộc env này khi server chạy nên fallback chủ yếu ảnh hưởng script/seed chạy tay.

**Khuyến nghị (giữ tương thích đặc tả)**
1. Giữ mật khẩu mặc định `123456` nếu đặc tả yêu cầu, nhưng **bắt buộc đổi ở lần đăng nhập đầu** (cờ `must_change_password`) và chặn API nghiệp vụ cho đến khi đổi.
2. Cân nhắc nâng cấp: sinh mật khẩu ngẫu nhiên theo từng user, trả một lần trong file kết quả (không log); vẫn kèm buộc đổi.
3. Không dùng chung một plaintext cho nhiều user nếu có thể (Argon2 salt riêng nhưng cùng `123456` vẫn dò được một lần).
4. Tài khoản NTRIP seed: dùng mật khẩu mạnh từ env; vô hiệu hóa tài khoản seed sau khi cấp phát nếu không dùng.

**Kiểm chứng đề xuất (mock-first)**
- Unit: import 2 user → hash khác nhau, plaintext không phải `123456`, response không chứa mật khẩu.
- Integration: user import đăng nhập bằng `123456` phải bị từ chối/được chuyển luồng đổi MK.

---

### F-02 [High — production] Seed chạy mỗi lần start → bật lại tài khoản bị khóa, ghi đè role/company

**Vị trí**
- `db/seed.ts:127-136`:
```sql
ON DUPLICATE KEY UPDATE
  role_id = VALUES(role_id), parent_user_id = VALUES(parent_user_id),
  display_name = VALUES(display_name), email = VALUES(email),
  company_id = VALUES(company_id), status = 'active'
```
- `docker-compose.yml` service `server`, command: `node dist/db/seed.js && ... && node --watch dist/index.js`.

**Bằng chứng**
- `ON DUPLICATE KEY UPDATE` **không** cập nhật `password_hash` (tốt), nhưng luôn đặt `status='active'` và ghi đè `role_id`, `parent_user_id`, `company_id`, `display_name`, `email`.
- Seed chạy ở **mọi lần container start**, không có cờ “chỉ seed lần đầu”, không kiểm tra `NODE_ENV=production`.

**Tác động (theo use case)**
- Trong **dev**, seed mỗi lần start là tiện lợi và chấp nhận được. Vấn đề chỉ xuất hiện khi **dùng tài khoản seed trong môi trường thật** hoặc khi quản trị viên tin rằng đã khóa tài khoản.
- Quản trị viên khóa/disable một tài khoản seed (`superadmin`, `admin`, `user1`, `user2`) để ứng phó sự cố → restart server là tài khoản **tự mở lại**.
- Thay đổi role/parent/company hợp lệ trên các tài khoản seed bị revert sau restart (có thể tái tạo quyền cao hơn).
- Kết hợp OTP/khóa tạm thời không hiệu quả; vi phạm yêu cầu “không tuyên bố hoàn thành khi chưa test” nếu vận hành tin vào trạng thái khóa.

**Khuyến nghị**
1. Seed idempotent nhưng **không** đụng `status`/role/parent/company của user đã tồn tại; chỉ tạo khi chưa có.
2. Giữ seed-on-start cho dev nếu muốn; ở production tách khỏi command start hoặc gate bằng `SEED_ENABLED=true` + `NODE_ENV!==production`.
3. Ghi audit khi seed thực sự tạo tài khoản.

**Kiểm chứng đề xuất**
- Trên DB test: lock `user1` → chạy `node dist/db/seed.js` → `status` phải giữ `locked`.
- Đổi role `user1` → chạy seed → role không đổi.

---

### F-03 [Medium — High nếu public Internet] NTRIP caster dùng Basic auth plaintext, không TLS

**Vị trí**
- `docker-compose.yml` service `gnss`: `ports: ["127.0.0.1:7080:7080", "1509:1509", "1508:1508"]` → 1509/1508 bind **0.0.0.0**.
- `gnss/internal/caster/listener.go:269-300` — `ParseBasic`, `VerifyPassword`, không có nhánh TLS.
- `.env.example`: `CASTER_BIND_ADDR=0.0.0.0`, `CASTER_PORT=1509`.
- `gnss/internal/ntrip/ntrip.go:126-129` — phía **client** relay có TLS 1.2; nhưng phía **listener caster** không có TLS.

**Bằng chứng**
```go
// listener.go — mọi request rover/source
username, password, ok := ParseBasic(req.Authorization)
...
if account == nil || !account.Enabled || !VerifyPassword(account.PasswordHash, password) {
    return nil, 401, "Unauthorized"
}
```
`req.Authorization` lấy từ header HTTP thô trên `net.Conn`; không có `crypto/tls` cho listener.

**Tác động (theo use case)**
- Nếu caster chỉ chạy trong **mạng nội bộ/VPN** (mô hình relay nội bộ giữa các hệ thống tin cậy), plaintext là rủi ro thấp–trung bình, có thể chấp nhận tạm thời.
- Nếu cổng 1509/1508 **mở ra Internet**, bất kỳ ai trên đường truyền (ISP, Wi‑Fi, mirror port) bắt được `Authorization: Basic base64(user:pass)` của rover/source → chiếm tài khoản NTRIP, đọc/ghi luồng RTCM. Khi đó mức độ là **High**.
- Việc có 100 trạm từ cùng một IP không làm tăng/giảm rủi ro này; vấn đề là kênh truyền có được mã hóa hay không.
- Không có TLS termination ở nginx cho NTRIP (nginx.conf chỉ proxy `/api`, `/socket.io`).

**Khuyến nghị**
1. Xác định rõ mô hình: nội bộ/VPN (chấp nhận plaintext có kiểm soát) hay Internet (bắt buộc TLS).
2. Nếu Internet: thêm TLS cho listener (`tls.Listener`, cert/key) hoặc đặt sau stunnel/haproxy TLS; giữ nguyên khả năng 100+ kết nối/1 IP.
3. Nếu nội bộ: publish 1509/1508 vào mạng nội bộ/VPN thay vì `0.0.0.0`; firewall theo **dải mạng khách hàng**, không cần allowlist từng IP (tránh chặn oan IP động/NAT).
4. Cảnh báo trong UI/health khi listener public mà không TLS; xoay mật khẩu NTRIP nếu từng truyền plaintext qua Internet.

**Kiểm chứng đề xuất**
- Test Go: listener TLS bắt buộc → client plaintext bị từ chối; `tls.Client` với cert hợp lệ PASS (không giới hạn số kết nối từ một IP).
- Kiểm tra compose: nếu mô hình nội bộ, `docker compose port gnss 1509` phải là IP nội bộ/loopback thay vì mở Internet.

---

### F-04 [Medium] Lạm dụng “lấy sourcetable từ nguồn trạm” + tái dùng credential cho host khác

**Vị trí**
- `server/src/routes/stations.ts:2361-2412` — `POST /source/mountpoints`.
- Zod: `host: z.string().trim().min(1).max(190)`, `port: 1..65535` (`stations.ts:2366-2367`).
- Kết nối: `tls.connect({ host: body.host, port: body.port, servername: body.host })` hoặc `net.connect(...)` (`stations.ts:2393-2394`), timeout 6s (`stations.ts:2412`).
- Tái dùng credential: `decryptSecret(rows[0].client_password_enc)` khi truyền `stationId` (`stations.ts:2385`).

**Bằng chứng**
```ts
const socket = body.tls
  ? tls.connect({ host: body.host, port: body.port, servername: body.host })
  : net.connect({ host: body.host, port: body.port });
```
Không có allowlist/denylist IP, không chặn `169.254.169.254`, `127.0.0.1`, RFC1918, `file://` (không áp dụng vì TCP thuần nhưng vẫn quét nội bộ).

**Tác động (theo use case)**
- Việc nhập host/port tùy ý là **cần thiết cho nghiệp vụ**: khách hàng có upstream NTRIP công khai hoặc nội bộ (RFC1918) khác nhau; không thể áp một allowlist cứng như tile proxy mà không chặn oan.
- Rủi ro chính không phải “đọc sourcetable” mà là **tái dùng credential đã lưu** (`stationId` → `client_password_enc`) để gửi Basic auth tới host do người dùng nhập. Người có `stations.add` có thể đổi host (ví dụ sang máy họ kiểm soát) và **nhận được mật khẩu trạm** dưới dạng Basic auth → rò rỉ credential giữa các trạm/tenant cùng công ty.
- Rủi ro thứ cấp: dùng endpoint để dò cổng nội bộ (`mysql:3306`, `server:4000`, `gnss:7080`) hoặc metadata cloud. Mức độ phụ thuộc: người dùng phải có quyền cấu hình trạm (không phải user xem thông thường).
- Relay/probe cũng dial host cấu hình; đây là **by design**, không phải lỗi. Chỉ cần kiểm soát khi test theo `AGENTS.md`.

**Khuyến nghị (ưu tiên đúng rủi ro, không phá use case)**
1. **Bind credential với host**: chỉ dùng `client_password_enc` khi `host/port/tls` trùng đúng bản ghi đã lưu; nếu host thay đổi, bắt nhập lại mật khẩu. Đây là biện pháp quan trọng nhất.
2. Chặn **metadata/link-local/loopback** (169.254.0.0/16, 127.0.0.0/8, ::1) và multicast/broadcast; **không chặn RFC1918 mặc định** (vì upstream nội bộ hợp lệ), hoặc chỉ chặn nếu bật cờ `STRICT_OUTBOUND=true`. Resolve DNS và kiểm tra toàn bộ IP trả về (chống rebinding).
3. Audit mỗi lần đổi host/kết nối, ghi rõ actor và host; throttle theo **user** (không theo IP) để tránh lạm dụng hàng loạt.
4. Nếu triển khai Internet, cân nhắc danh sách domain cho phép theo từng công ty (cấu hình được, không hard-code).

**Kiểm chứng đề xuất**
- Test: trạm đã lưu host A, gọi lấy sourcetable với host B → phải yêu cầu nhập lại mật khẩu, không dùng `client_password_enc`.
- Test: host `169.254.169.254`/`127.0.0.1` bị chặn; host RFC1918 vẫn hoạt động (use case nội bộ).
- Test DNS trả về nhiều A record (1 public + 1 metadata/loopback) → phải từ chối hoặc chỉ dùng IP đã kiểm tra (chống rebinding).

---

### F-05 [Low — cần quyền ghi DB] AES-256-GCM không bind bản ghi (không AAD) và không có rotation

**Vị trí**
- `server/src/lib/crypto.ts:19-31` — `createCipheriv('aes-256-gcm', key, nonce)`, `setAuthTag`; **không** `setAAD`.
- `gnss/internal/secret/aes.go` — decrypt tương ứng, cũng không AAD.
- Cột lưu: `relay_credentials.password_enc`, `station_sources.client_password_enc`, `station_sources.caster_password_enc` (`db/migrations/admin/015_station_sources.sql`).

**Bằng chứng**
```ts
const cipher = createCipheriv('aes-256-gcm', key, nonce);
const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
```
Không có `recordId`/`stationId`/`column` trong AAD.

**Tác động**
- Kẻ có quyền UPDATE DB (insider, backup bị lộ kèm khóa, hoặc lỗi injection ở nơi khác) có thể **hoán đổi ciphertext** giữa các bản ghi/tenant. Ví dụ: gán `password_enc` của relay/trạm công ty A sang bản ghi công ty B; hệ thống giải mã thành công và dùng credential của A cho B → rò rỉ/leo thang tin cậy. Đây là rủi ro **thấp** trong mô hình hiện tại (DB nội bộ, ít người có quyền ghi), nhưng đáng xử lý nếu tách tenant mạnh hơn.
- Một khóa duy nhất `APP_ENC_KEY`, không có key id/rotation → khi lộ khóa phải re-encrypt thủ công toàn bộ.
- Không có version key (`v1` chỉ là format), không phân biệt môi trường.

**Khuyến nghị**
1. Dùng AAD = `table:column:recordId` (hoặc UUID bản ghi) khi encrypt/decrypt; fail-closed nếu lệch.
2. Thêm `key_id` vào payload (`v2:keyid:nonce:ct:tag`), hỗ trợ 2 khóa (current/previous) để rotation; không log khóa.
3. Giới hạn quyền UPDATE các cột `*_enc` (tách quyền, trigger kiểm tra) và audit mọi thay đổi.
4. Cân nhắc envelope encryption với KMS/secret manager nếu triển khai ngoài máy đơn.

**Kiểm chứng đề xuất**
- Unit: decrypt payload với AAD sai phải throw.
- Test hoán đổi ciphertext giữa 2 station → phải fail.

---

### F-06 [Medium — khi public] Caster thiếu giới hạn tổng và thiếu kiểm soát xác thực sai

**Vị trí**
- `gnss/internal/caster/listener.go:34-46` — `Accept()` → mỗi conn một goroutine, **không** semaphore/giới hạn tổng.
- `gnss/internal/caster/listener.go:48-55` — chỉ deadline header 10s (`HeaderTimeout`).
- `gnss/internal/caster/listener.go:269-300` — mỗi request Basic gọi `VerifyPassword` (Argon2id).
- `server/src/lib/password.ts:3-8` — Argon2id `memoryCost 19456` (19 MiB), `timeCost 2`.
- Không có rate limit/IP block/backoff sau N lần sai.

**Tác động (theo use case)**
- **Không được** coi “nhiều kết nối từ một IP” là tấn công: 100 trạm nguồn từ hệ thống X = 100 kết nối SOURCE hợp lệ từ cùng IP; rover sau NAT cũng vậy. Vì thế biện pháp “giới hạn per-IP” sẽ phá use case và **không** được đề xuất.
- Rủi ro thật: (a) không có giới hạn **tổng** connection/listener → kẻ tấn công mở hàng nghìn kết nối rác từ một hoặc nhiều IP; (b) mỗi lần Basic sai vẫn chạy Argon2 (~19 MiB, timeCost 2) mà không có ngưỡng chặn → lặp lại nhiều lần trên cùng username/IP làm cạn CPU/RAM.
- `MaxConnections` chỉ áp **sau khi xác thực thành công**, nên không bảo vệ bước xác thực.
- Trong mạng nội bộ, khả năng bị tấn công thấp hơn nhiều; mức độ tăng khi caster mở Internet.

**Khuyến nghị (giữ nguyên khả năng fan-in)**
1. Giới hạn **tổng connection theo listener/process** (semaphore hoặc `netutil.LimitListener`) với ngưỡng cấu hình đủ lớn cho fan-in thực tế (ví dụ ≥ số trạm dự kiến + rover + dự phòng). Trả 503 sớm khi vượt.
2. Giữ `MaxConnections` theo account/mountpoint (đã có) để bảo vệ tài nguyên; có thể nâng theo nhu cầu từng khách.
3. Chỉ throttle **xác thực sai**: đếm lỗi theo cặp (username, IP) và/hoặc tổng lỗi toàn cục, backoff sau N lần sai; **không** giới hạn số kết nối thành công hay số kết nối đồng thời theo IP.
4. Ghi log/audit lỗi xác thực (không log password); giới hạn kích thước header (đã có 16 KB).
5. Đặt caster sau firewall/VPN nếu không cần public (xem F-03).

**Kiểm chứng đề xuất**
- Mock 150 kết nối SOURCE hợp lệ từ **cùng một IP** → tất cả phải được chấp nhận (không bị chặn per-IP), miễn dưới ngưỡng tổng.
- 1.000 conn rác vượt ngưỡng tổng → trả 503/đóng sớm, RAM ổn định.
- 20 lần sai liên tiếp cùng username+IP → backoff; các username khác/IP khác không bị ảnh hưởng.

---

### F-07 [Medium] Import người dùng bỏ qua kiểm soát cấp bậc/đối tượng

**Vị trí**
- `server/src/routes/webUsers.ts:397-421` — nhánh user đã tồn tại.
- So sánh: luồng PATCH có `assertCanTarget` (kiểm tra level, company, admin, scope) tại `webUsers.ts:181-203` và gọi ở `:533`.
- Import chỉ kiểm tra: cùng công ty (`:399-404`), target không phải `admin` (`:405-408`), không hạ `super_admin` cuối (`:410-417`).
- `canAssignRole` cho phép `targetLevel <= actorLevel` (`server/src/rbac/scope.ts:99-106`).

**Bằng chứng**
```ts
if (!superAdmin) {
  if (targetCompany !== Number(req.auth!.companyId)) { errors.push(...); continue; }
  if (target.role_code === 'admin' && Number(target.id) !== req.auth!.id) { errors.push(...); continue; }
}
...
await adminPool.query(
  'UPDATE web_users SET display_name=?, email=?, role_id=?, parent_user_id=?, status=?, company_id=? WHERE id=?',
  [..., target.id]
);
```

**Tác động**
- User có `web_users.add` (ví dụ role trung gian) có thể, qua file Excel:
  - **Hạ cấp** một user cấp cao hơn (không phải `admin`/`super_admin`) xuống role thấp (vì chỉ kiểm tra role **mới** ≤ level mình).
  - **Khóa** (`status=locked`) hoặc đổi parent/company (trong cùng company) của user khác mà không cần `assertCanTarget`.
  - Tạo hàng loạt user cùng level với mình (peer) → mở rộng bề mặt quyền.
- Không audit từng dòng (chỉ 1 audit tổng `import`), khó truy vết ai bị đổi.

**Khuyến nghị**
1. Với mỗi dòng “update”, gọi `assertCanTarget(req, target)` (hoặc logic tương đương) trước khi UPDATE.
2. Chỉ cho import tạo mới + cập nhật field an toàn (display_name/email) hoặc yêu cầu quyền `web_users.edit` + scope phù hợp; không cho đổi `role_id`/`status` qua import nếu không đủ cấp.
3. Audit per-row (hoặc lưu diff) khi import ghi đè.
4. Ghi rõ trong tài liệu `docs/2/PHAN_QUYEN.md` hành vi import.

**Kiểm chứng đề xuất**
- Test: actor level 40 import sửa user level 60 (role không phải admin) → phải 403/skip.
- Test: actor `own` import user ngoài subtree cùng company → phải 404/skip.

---

### F-08 [Low] Thiếu CSRF ở router cấu hình bản đồ

**Vị trí**
- `server/src/routes/mapConfig.ts:18-20` — chỉ `requireAuth`, không `csrfProtection`.
- `PUT /api/map/config` (`:43`), `POST /api/map/config/test` (`:67`).
- Các router khác đều có `csrfProtection` (xem Phụ lục A).

**Bằng chứng**
```ts
export const mapConfigRouter = Router();
mapConfigRouter.use(requireAuth);
// không có mapConfigRouter.use(csrfProtection)
```

**Tác động (theo use case)**
- Thiếu lớp phòng thủ CSRF ở endpoint thay đổi `settings['map.config']` (super admin) và gọi outbound test provider.
- Khả năng khai thác thực tế **rất thấp**: cookie `SameSite=Lax` chặn cross-site POST/PUT kèm cookie; body JSON cần `Content-Type: application/json` → trình duyệt phải preflight, CORS chỉ cho `CORS_ORIGIN`. Chỉ thành vấn đề nếu hạ `SameSite`, dùng trình duyệt cũ, hoặc có XSS cùng origin.
- Vì vậy giữ mức **Low** (defense-in-depth), không phải lỗ hổng cấp bách.

**Khuyến nghị**
- Thêm `mapConfigRouter.use(csrfProtection)` sau `requireAuth` (đồng bộ các router khác) — thay đổi nhỏ, không ảnh hưởng use case.
- Không cần thêm kiểm tra Origin/Referer nếu đã có CSRF token + SameSite.

**Kiểm chứng đề xuất**
- Gọi `PUT /api/map/config` không có `x-csrf-token` → 403 `CSRF_INVALID`.

---

### F-09 [Low] `trust proxy` vô điều kiện + rate limit in-memory + IP lưu vào audit/session

**Vị trí**
- `server/src/app.ts:54` — `app.set('trust proxy', 1);`
- `server/src/app.ts:75-92` — limiter toàn cục 300/phút, login 10/phút, mặc định memory store.
- `server/src/lib/http.ts` (`clientIp`) dùng IP đã qua proxy; IP được ghi vào `web_sessions.ip` (`routes/auth.ts:73-85`) và `audit_logs.ip`.

**Tác động (theo use case)**
- Phạm vi ảnh hưởng **chỉ web login/audit của Node**, không liên quan NTRIP/relay (không đi qua limiter này). 100 trạm relay không bị ảnh hưởng.
- Khi Node bị truy cập trực tiếp (cổng 4000 đang bind `127.0.0.1` trong compose — tốt; nếu đổi/reverse proxy sai), kẻ tấn công gửi `X-Forwarded-For` tùy ý:
  - Vượt rate-limit login (mỗi request một IP giả).
  - Đầu độc `ip` trong session/audit → điều tra sự cố sai.
- Nhiều quản trị viên dùng chung NAT văn phòng có thể chạm ngưỡng 10/phút/IP; vì vậy không nên siết per-IP quá chặt.
- Memory store không chia sẻ nếu scale nhiều Node (hiện 1 instance nên chấp nhận).

**Khuyến nghị (tránh chặn oan NAT/fan-in)**
1. Chỉ bật `trust proxy` khi thực sự sau reverse proxy, và giới hạn theo IP proxy tin cậy (không dùng `true`/`1` mù).
2. Login: kết hợp **per-username** và **per-IP** với ngưỡng hợp lý (ví dụ 10–20/phút/IP, 5–10/phút/username), ưu tiên **delay tăng dần** thay vì khóa cứng (tránh kẻ tấn công khóa tài khoản admin).
3. Ghi nhận cả `remoteAddress` gốc và `XFF` (đánh dấu nguồn) để audit; hoặc chỉ tin XFF từ proxy tin cậy.
4. Nếu scale: dùng store chia sẻ (không thêm Redis theo ràng buộc → dùng DB hoặc sticky single instance).

**Kiểm chứng đề xuất**
- Gửi login với `X-Forwarded-For` ngẫu nhiên khi không qua proxy → limiter phải dựa trên socket IP.
- Kiểm tra `web_sessions.ip`/audit khi header bị spoof.

---

### F-10 [Medium — production] Cookie phiên thiếu Secure mặc định, không HSTS, không `__Host-`

**Vị trí**
- `server/src/config.ts:42` — `secure: (process.env.SESSION_COOKIE_SECURE || 'false') === 'true'`.
- `.env.example` — `SESSION_COOKIE_SECURE=false`.
- `server/src/routes/auth.ts:89-95` — `httpOnly: true`, `sameSite: 'lax'`, `secure: config.session.secure`, `path: '/'`.
- `frontend/nginx.conf` — không có `Strict-Transport-Security`, không cấu hình TLS.

**Tác động (theo use case)**
- Trong dev trên `localhost` (HTTP), `Secure=false` là cần thiết để đăng nhập được; đây là mặc định hợp lý cho dev.
- Khi triển khai thật qua HTTP (hoặc TLS terminate nhưng quên bật Secure), cookie `cors_sid` đi qua mạng dạng rõ → chiếm phiên. Đó là lúc mức độ thành Medium/High.
- Không có `__Host-` → giảm khả năng chống subdomain cookie injection (nếu có subdomain không tin cậy).
- `SameSite=Lax` tốt cho CSRF cơ bản nhưng không thay thế CSRF token/HTTPS.
- Không HSTS → dễ bị downgrade/SSL-strip.

**Khuyến nghị**
1. Production: bắt buộc `SESSION_COOKIE_SECURE=true` (fail-fast nếu `NODE_ENV=production` và false), đặt sau TLS.
2. Đổi tên cookie `__Host-cors_sid` (kèm `Secure`, `Path=/`, không Domain) khi HTTPS.
3. Thêm HSTS (`max-age` ≥ 6 tháng) ở reverse proxy/nginx khi có TLS.
4. Cân nhắc `SameSite=Strict` cho phiên quản trị nếu UX cho phép.

**Kiểm chứng đề xuất**
- Test: `NODE_ENV=production`, `SESSION_COOKIE_SECURE` unset → server fail khi start.
- Kiểm tra Set-Cookie: có `Secure; HttpOnly; SameSite=Lax` và prefix `__Host-`.

---

### F-11 [Low khi dev / Medium khi production] Compose đang chạy Vite dev server

**Vị trí**
- `docker-compose.yml` service `web`: image `node:22-alpine`, `volumes: ./frontend:/app`, command `npm ci && npm run dev -- --host 0.0.0.0 --port 3000`, publish `3000:3000`.
- `frontend/Dockerfile` + `frontend/nginx.conf` tồn tại nhưng **không được compose dùng**.
- `frontend/nginx.conf` không có CSP/HSTS/X-Frame-Options/Referrer-Policy; không TLS.
- Server/web container chạy **root** mặc định; code bind-mount từ host.

**Tác động (theo use case)**
- Trong **dev**, Vite dev server + bind mount + HMR là bình thường và thuận tiện; không cần thay đổi.
- Khi **triển khai production**, Vite dev không phù hợp: HMR WebSocket mở, source map/dev overlay, không nén/tối ưu, có thể lộ file nguồn; bề mặt tấn công lớn hơn nginx tĩnh.
- Thiếu security header ở HTML (CSP, XFO, HSTS) → tăng tác động nếu có XSS/clickjacking (app hiện không dùng `dangerouslySetInnerHTML`).
- Container root + bind mount code → nếu bị RCE, có thể ghi file host. Chỉ đáng lo khi chạy thật.
- Không có `restart: unless-stopped` cho `server`/`web` (khả dụng, không phải bảo mật).

**Khuyến nghị**
1. Giữ nguyên cho dev. Khi production: dùng multi-stage có sẵn (`frontend/Dockerfile` + nginx; `server/Dockerfile`), bỏ bind mount code.
2. Thêm security header vào nginx production: CSP (self + tile/geo allowlist), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`/`frame-ancestors`, HSTS khi TLS.
3. Chạy container non-root khi production (đã có ví dụ `gnss` UID 65532).
4. Thêm healthcheck/restart policy cho production.

**Kiểm chứng đề xuất**
- Với compose production: không còn `npm run dev`; `curl -I` thấy header bảo mật; process web không phải root.

---

### F-12 [Low — Medium nếu DB ngoài host] MySQL không TLS, user `'%'`, quyền theo thiết kế

**Vị trí**
- `server/src/db/pool.ts:4-16` và `runtimePool.ts:4-15` — `mysql.createPool` không có `ssl`.
- `gnss/internal/db/db.go:23-36` — `mysql.Config` không set `tls`.
- `db/init/01-init.sh:19-32` — user `@'%'`, `GRANT SELECT,INSERT,UPDATE,DELETE` (app), relay có DML runtime + SELECT admin, migrator ALL.
- `db/init/01-init.sh` — dùng `mysql -p"$MYSQL_ROOT_PASSWORD"` (mật khẩu lộ trong process list trong container/`ps`).

**Tác động (theo use case)**
- Trong mô hình Docker Compose hiện tại, MySQL chỉ publish `127.0.0.1:3307`, các service nói chuyện qua mạng `internal`; **không TLS chấp nhận được** vì traffic không ra ngoài host.
- `cors_relay` có DML `cors_runtime` + SELECT `cors_admin` là **đúng thiết kế** (Go đọc cấu hình, ghi runtime); không phải lỗi. Rủi ro chỉ tăng nếu kẻ tấn công đã vào được mạng container.
- `@'%'` chấp nhận được trong mạng Docker nội bộ; nguy hiểm nếu publish 3306 ra ngoài (hiện không).
- Root password qua argv chỉ lộ trong namespace container/lúc init; rủi ro thấp nếu host không bị xâm nhập.
- Mức độ chuyển Medium nếu MySQL nằm trên host/VPS khác hoặc dùng managed DB qua mạng không tin cậy.

**Khuyến nghị (không over-engineer)**
1. Giữ không TLS nếu DB chỉ nằm trong Docker network; **bật TLS** nếu DB ra khỏi host hoặc qua mạng không tin cậy.
2. Giữ grant theo thiết kế; chỉ thu hẹp thêm nếu sau này relay không cần đọc bảng admin cụ thể.
3. Có thể đổi root password khỏi argv bằng `--defaults-extra-file` (thay đổi nhỏ, tùy chọn).
4. Rotate mật khẩu DB định kỳ; tiếp tục không log DSN.

**Kiểm chứng đề xuất**
- `SHOW GRANTS` khớp thiết kế; `docker compose config` xác nhận 3306 không publish public; nếu dùng DB ngoài host thì kiểm tra `tls=true`/`ssl`. 

---

### F-13 [Medium] Audit có thể mất im lặng; không audit đăng nhập

**Vị trí**
- `server/src/lib/audit.ts:29-55` — `try { INSERT ... } catch { console.error }`; không throw/không retry.
- `server/src/routes/auth.ts` — login thành công chỉ update `last_login_at`; không ghi audit success/fail; không audit logout.
- `writeAudit` dùng `redact` theo regex key (`/pass|token|secret|hash|dsn|authorization|cookie/i`) — tốt, nhưng redact theo **tên key** nên secret nằm trong giá trị chuỗi tự do có thể lọt.

**Tác động**
- DB lỗi/khóa bảng/đầy đĩa → thay đổi quyền, xóa tài khoản, đổi cấu hình vẫn thành công nhưng **không có dấu vết** (vi phạm yêu cầu “mọi thay đổi quyền ghi audit”).
- Không có audit đăng nhập → khó phát hiện brute-force/chiếm tài khoản; `last_login_at` không đủ.
- Redact theo key có thể bỏ sót secret nằm trong message/notes/description.

**Khuyến nghị**
1. `writeAudit` thất bại phải: retry có giới hạn + log mức error + (tùy chọn) đánh dấu transaction “audit_pending” hoặc chặn hành động nhạy cảm nếu không ghi được (fail-closed cho thao tác quyền).
2. Audit login success/fail/lock/unlock/logout, kèm IP/UA (đã redact).
3. Redact theo cả **giá trị** đối với known secret fields (password_enc, Authorization) và giới hạn độ dài/JSON depth.
4. Kiểm tra audit định kỳ (job) + cảnh báo khi audit fail.

**Kiểm chứng đề xuất**
- Test DB read-only/khóa bảng audit → hành động nhạy cảm phải trả lỗi hoặc cảnh báo rõ.
- Test login sai 5 lần → có bản ghi audit tương ứng.

---

### F-14 [Low] Go internal HTTP server thiếu timeout đọc/ghi/idle

**Vị trí**
- `gnss/cmd/corsd/main.go:136-139` — `Addr`, `ReadHeaderTimeout: 5s`, không `ReadTimeout`, `WriteTimeout`, `IdleTimeout`.
- Body limit HMAC: `io.LimitReader(r.Body, 1<<20)` (`gnss/internal/api/server.go:170-172`).

**Tác động**
- Kết nối chậm/treo có thể giữ tài nguyên lâu; internal API đã bind loopback/`expose` nên rủi ro thấp, nhưng nếu cấu hình sai (bind 0.0.0.0) sẽ tăng bề mặt DoS.
- Nếu không có `WriteTimeout`, handler chậm có thể treo connection (giới hạn 1MB body giúp phần nào).

**Khuyến nghị**
- Thêm `ReadTimeout: 10s`, `WriteTimeout: 30s`, `IdleTimeout: 60s`, `MaxHeaderBytes: 16KB`.
- Giữ `INTERNAL_HMAC_SECRET` bắt buộc và bind loopback (đã có publish `127.0.0.1:7080`).

**Kiểm chứng đề xuất**
- Slowloris test trên port 7080 (chỉ trong mạng test) → connection bị đóng theo timeout.

---

### F-15 [Low] Tile proxy: mọi user đăng nhập đều dùng, không permission riêng/rate-limit riêng

**Vị trí**
- `server/src/routes/map.ts:28-30` — `requireAuth` + `csrfProtection` cho toàn router (đúng).
- `server/src/routes/map.ts:68-108` — `GET /api/map/tiles/:z/:x/:y`, không `requirePermission`.
- `server/src/lib/tileProxy.ts:14-17` — cache 256 entry, TTL 6h, timeout 8s, max 3 redirect, allowlist host.
- Chỉ rate-limit toàn cục 300/phút (`app.ts:75-82`).

**Tác động**
- User bất kỳ (kể cả role chỉ xem dashboard) có thể dùng server làm proxy tile → tiêu hao băng thông/quota nhà cung cấp, làm cache loãng (256 entry), tăng tải Node.
- SSRF đã được chặn bởi allowlist + redirect thủ công + timeout (kiểm soát tốt).

**Khuyến nghị**
- Thêm `requirePermission('map','view')` (hoặc quyền tương đương) + rate-limit theo user/IP cho route tile.
- Giữ allowlist; cân nhắc cache key theo mode + z/x/y và giới hạn kích thước response.

**Kiểm chứng đề xuất**
- User không có `map.view` gọi tile → 403; burst > N/phút → 429.

---

### F-16 [Low] Realtime tick dùng `subtreeIds` thay vì `tenantIds`

**Vị trí**
- `server/src/realtime/socket.ts:402-408`:
```ts
const snapshot = buildSnapshot(
  data, alerts, state.permissions, state.auth.userId, state.subtreeIds
);
```
- Hàm nhận tham số thứ 6 `tenantIds` mặc định = `subtreeIds` (`server/src/realtime/filter.ts:154-160`).
- `sendSnapshot` (lần đầu) truyền đủ `state.tenantIds` (`socket.ts:180-187`).

**Tác động**
- Với user có scope `tenant` (company), snapshot realtime định kỳ bị lọc theo **subtree cá nhân** thay vì toàn company → user thấy ít dữ liệu hơn so với REST `/api/snapshot` và dashboard.
- Không phải leo quyền (subtree ⊆ tenant trong mô hình hiện tại), nhưng là **lỗi nhất quán dữ liệu** dễ gây hiểu nhầm vận hành (“trạm biến mất” sau 1s).
- Nếu sau này mô hình parent cho phép subtree rộng hơn company (dữ liệu bất thường), có thể thành lộ dữ liệu; hiện chưa.

**Khuyến nghị**
- Truyền `state.tenantIds` trong tick; thêm test so sánh snapshot REST vs socket cho user tenant.

**Kiểm chứng đề xuất**
- Integration: user company có 2 user, mỗi user 1 trạm; user A scope tenant phải thấy cả 2 trạm trong cả REST và socket tick.

---

### F-17 [Info] Caster listener cho phép port tùy ý (1..65535, trừ 2101/8081)

**Vị trí**
- `server/src/lib/caster.ts:4-13` — `FORBIDDEN_CASTER_PORTS = {2101, 8081}`, `portField` min 1 max 65535.
- `server/src/routes/caster.ts:178-233` — user có `caster.add` tạo listener; Go bind `CASTER_BIND_ADDR=0.0.0.0` (`gnss/internal/config/config.go`).
- `docker-compose.yml` chỉ publish 1508/1509; port khác không ra ngoài Docker nhưng vẫn mở trong mạng container.

**Tác động (theo use case)**
- Cho phép port tùy ý là **linh hoạt có chủ đích**: khách hàng có thể cần port riêng cho từng nhóm mountpoint. Không nên ép dải cố định nếu vận hành không cần.
- Rủi ro thực tế chỉ là chọn trùng port dịch vụ nội bộ (7080, 3306, 4000) → reconcile lỗi, khó hiểu; hoặc port <1024 fail bind do container non-root. Không phải lỗ hổng bảo mật.

**Khuyến nghị (tùy chọn)**
- Chỉ cần loại trừ **port nội bộ đã biết** (7080, 3306, 4000, 3000) và cảnh báo khi bind lỗi; **không** cần giới hạn 1500–1599.
- Hiển thị lỗi bind/reconcile trong UI thay vì im lặng.

**Kiểm chứng đề xuất**
- Tạo listener port trùng port nội bộ → cảnh báo/400; port tùy chọn khác vẫn tạo được.

---

### F-18 [Low] Login lộ trạng thái tài khoản và khác biệt thời gian

**Vị trí**
- `server/src/routes/auth.ts:51-66` — tra user theo username; nếu `status !== 'active'` trả 403 `ACCOUNT_LOCKED` trước khi verify; nếu `company_status === 'disabled'` trả 403 `COMPANY_DISABLED`; chỉ verify hash khi user tồn tại.
- Không dùng dummy hash cho username không tồn tại.

**Tác động**
- Kẻ tấn công phân biệt được username tồn tại/bị khóa/công ty bị vô hiệu hóa; timing khác nhau (Argon2 chỉ chạy khi user tồn tại) hỗ trợ enumeration.
- Kết hợp F-01/F-09 → brute-force có mục tiêu hiệu quả hơn.

**Khuyến nghị**
- Verify một dummy Argon2 hash khi không tìm thấy user; trả cùng `INVALID_CREDENTIALS` (401) cho mọi trường hợp không đăng nhập được (trừ khi cần thông báo qua kênh khác).
- Thêm rate-limit theo username + audit login fail.

**Kiểm chứng đề xuất**
- Đo thời gian 100 request user tồn tại vs không tồn tại (sai MK) → chênh lệch không đáng kể; response body/status giống nhau.

---

### F-19 [Low] `/health` công khai trả thông điệp lỗi DB

**Vị trí**
- `server/src/app.ts:94-119` — không auth; catch trả `message: err.message`.

**Tác động**
- Lộ host/user/phiên bản/lỗi nội bộ MySQL cho người chưa đăng nhập (thông tin hỗ trợ tấn công).
- Endpoint cần cho healthcheck nên không thể bỏ auth hoàn toàn; có thể giảm chi tiết.

**Khuyến nghị**
- Trả `{ status: 'error', db: 'error' }` cho public; chi tiết chỉ ghi log nội bộ (hoặc endpoint `/health/detail` yêu cầu token nội bộ).
- Giữ `schemaVersion` nếu cần cho giám sát, nhưng cân nhắc ẩn khỏi public.

**Kiểm chứng đề xuất**
- Tắt DB → `GET /health` không chứa tên host/user/DSN.

---

### F-20 [Low] Chính sách mật khẩu tối thiểu còn đơn giản (không cần hard-lock)

**Vị trí**
- `server/src/routes/webUsers.ts:29,40` — `password: z.string().min(8).max(200)`.
- `server/src/lib/password.ts` — Argon2id tốt, nhưng không kiểm tra độ phức tạp/rò rỉ.
- Không có cột `failed_login_count`/`locked_until`; limiter chỉ theo IP.

**Tác động (theo use case)**
- Đây là hệ thống quản trị nội bộ, mật khẩu 8 ký tự là mức tối thiểu chấp nhận được; không cần ép độ phức tạp cao gây khó dùng.
- Không nên **hard-lock theo username**: kẻ tấn công có thể cố tình nhập sai để khóa tài khoản admin (DoS). Ưu tiên delay tăng dần + audit + thông báo.

**Khuyến nghị**
- Giữ tối thiểu 8 ký tự (hoặc nâng 10–12 nếu tổ chức yêu cầu); cảnh báo (không chặn) với mật khẩu phổ biến.
- Dùng **delay tăng dần** hoặc rate-limit theo username+IP thay vì khóa cứng; cho phép admin mở khóa nhanh.
- Cảnh báo UI khi mật khẩu trùng giá trị mặc định/seed.

**Kiểm chứng đề xuất**
- Test 5 lần sai liên tiếp → delay tăng dần, tài khoản không bị khóa vĩnh viễn; admin vẫn đăng nhập được từ IP khác (nếu có cơ chế).

---

### F-21 [Low] Dashboard audit: scope `own` dùng subtree

**Vị trí**
- `server/src/routes/ops.ts` — `idsFor(scope)` trả `subtreeIds` cho mọi scope ≠ `tenant`; `recentAudit` lọc `a.actor_web_user_id IN (auditIds)`.

**Tác động**
- User có `audit.view` scope `own` vẫn thấy audit của cấp dưới (subtree), rộng hơn “own”. Không phải leo thang nghiêm trọng nhưng sai kỳ vọng phân quyền.

**Khuyến nghị**
- Tách logic: `own` → `[userId]`; `tenant` → `tenantIds`; `subtree` → `subtreeIds` (đồng bộ với `scopeClause`).

**Kiểm chứng đề xuất**
- User own xem dashboard → chỉ audit của chính mình.

---

### F-22 [Info] Credential relay thật nằm trên máy dev

**Vị trí**
- `secrets/real-relays.json` (~938 B) — gitignored (`.gitignore`), không đọc giá trị trong báo cáo.
- `.env.local` — gitignored.

**Tác động**
- `.gitignore` chỉ bảo vệ khỏi commit; file vẫn có thể bị backup/đồng bộ cloud/sao chép nhầm; quyền NTFS chưa được kiểm chứng.
- Không export mật khẩu trong Excel (đã kiểm tra `webUsers.ts` export không có cột password) — tốt.

**Khuyến nghị**
- Di chuyển secret sang secret manager/ổ mã hóa; giới hạn ACL NTFS; xoay credential định kỳ; thêm pre-commit secret scan (không thêm dịch vụ ngoài stack — có thể script local).
- Kiểm tra log/backup không chứa `secrets/` và `.env.local`.

---

### F-23 [Info] Chưa có kết quả CVE dependency

**Vị trí**
- `server/package.json`: express 4.22.3, helmet 8.3.0, socket.io 4.8.4, mysql2 3.24.6, `@node-rs/argon2` 2.2.2, exceljs 4.4.0, zod 4.6.7, express-rate-limit 7.5.1, pino 9.14.0.
- `gnss/go.mod`: go 1.24.0, `go-sql-driver/mysql` v1.8.1, `golang.org/x/crypto` v0.31.0, `golang.org/x/net` v0.21.0, `go-gnss/rtcm` v0.0.9.
- `frontend/package.json`: vite ^6.0.3, react 18.3.1, leaflet 1.9.4, socket.io-client 4.8.4, playwright 1.64.1.

**Khuyến nghị**
- Chạy `npm audit --omit=dev` (server/frontend) và `govulncheck ./...` (gnss) trong CI có mạng; ghi kết quả vào `SESSION.md`.
- Ưu tiên vá `x/crypto`, `x/net` (Go) và Vite/leaflet (FE) nếu có CVE.

---

## 4. Kiểm soát tốt đã có (không cần hành động)

- **Session**: token 32 byte ngẫu nhiên (`randomToken`), chỉ lưu `sha256` trong `web_sessions.token_hash`; `requireAuth` kiểm tra hạn, `status='active'`, company active mỗi request (`server/src/middleware/auth.ts:37-75`).
- **CSRF**: header `x-csrf-token` so khớp token server-side cho POST/PUT/PATCH/DELETE (`server/src/middleware/csrf.ts`), áp cho hầu hết router (xem Phụ lục A).
- **Mật khẩu**: Argon2id 19 MiB/timeCost 2 (`server/src/lib/password.ts`); Go verify bằng `argon2.IDKey` + `subtle.ConstantTimeCompare` (`gnss/internal/caster/auth.go`).
- **RBAC/scope**: scope `all/subtree/tenant/own/none`; recursive CTE subtree/tenant; `assertRecordScope`, `listScope`, `resolveWriteOwnership`; chống leo thang cơ bản (không gán `super_admin`, không hạ super_admin cuối, chặn parent cycle).
- **Internal API**: HMAC-SHA256 trên `method\npath\ntimestamp\nnonce\nbodyHash`, cửa sổ ±60s, nonce chống replay 2 phút, body giới hạn 1MB (`server/src/lib/internalApi.ts`, `gnss/internal/api/server.go:161-229`).
- **SQL**: parameterized; dynamic SQL chỉ từ whitelist/static spec + placeholder (`rbac/scope.ts`, `lib/maintenance.ts`), không thấy nối chuỗi từ input.
- **XSS**: không có `dangerouslySetInnerHTML`/`innerHTML` trong app code; popup Leaflet escape toàn bộ dữ liệu trạm (`frontend/src/components/map/MapCanvas.tsx:38-120`); marker HTML chỉ chứa màu nội bộ.
- **SSRF tile**: allowlist host + redirect thủ công tối đa 3 + timeout 8s + cache bounded (`server/src/lib/tileProxy.ts`).
- **Header cứng**: `helmet()` mặc định cho API, tắt `x-powered-by`, JSON limit 256 KB (`server/src/app.ts:53-72`).
- **Giới hạn DB**: tách `cors_app` (admin DML, runtime SELECT) và `cors_relay` (admin SELECT, runtime DML); migrator riêng (`db/init/01-init.sh`).
- **Bind**: MySQL/Node/internal Go đều publish `127.0.0.1` (trừ caster 1509/1508 — xem F-03); Go container non-root UID 65532.
- **Log redaction**: pino redact `authorization`, `cookie`, `set-cookie`, `password`, `*.password_hash`, `*.token`, `*.csrfToken`; audit redact theo key.
- **Frontend**: CSRF token giữ trong memory (AuthProvider), không localStorage; chỉ theme lưu localStorage.
- **Realtime**: handshake yêu cầu session cookie; re-eval quyền định kỳ và `auth.revoked` + disconnect khi mất quyền (`server/src/realtime/socket.ts:390-400`).

---

## 5. Phụ lục A — Endpoint/CSRF/permission (trạng thái hiện tại)

| Router | `requireAuth` | `csrfProtection` | Ghi chú |
|---|---|---|---|
| `auth.ts` | route-level | login không cần; logout có | `/login`, `/me`, `/logout` |
| `stations.ts` | ✓ | ✓ | endpoint outbound F-04 |
| `map.ts` | ✓ | ✓ | `/tiles` không permission riêng (F-15) |
| `mapConfig.ts` | ✓ | **✗** | F-08 |
| `geo.ts` | ✓ | ✗ (chỉ GET) | outbound Geoapify |
| `dictionaries.ts`, `permissions.ts`, `snapshot.ts` | ✓ | ✗ (chỉ GET) | chấp nhận được |
| `mountpoints.ts`, `relayJobs.ts`, `ntripAccounts.ts` | ✓ | ✓ | |
| `webUsers.ts` | ✓ | ✓ | import F-07 |
| `companies.ts`, `roles.ts` | ✓ | ✓ | super-only cho companies |
| `caster.ts`, `connections` | ✓ | ✓ | port F-17 |
| `alerts.ts`, `history.ts`, `quality.ts`, `audit.ts` | ✓ | ✓ | |
| `profile.ts`, `system.ts`, `ops.ts` | ✓ | ✓ | |

**Public không auth**: `GET /health` (Node), `GET /health` (Go, bind loopback) — F-19/F-14.

---

## 6. Phụ lục B — Cấu hình/secret cần kiểm tra khi triển khai

| Biến | Hiện tại | Khuyến nghị production |
|---|---|---|
| `SESSION_COOKIE_SECURE` | `false` | **`true`** + TLS; fail-fast nếu production (F-10) |
| `CORS_ORIGIN` | `http://localhost:3000` | đúng domain HTTPS duy nhất; kiểm tra startup |
| `CASTER_BIND_ADDR` / ports | `0.0.0.0`, publish 1509/1508 | loopback/VPN hoặc TLS (F-03) |
| `SEED_*_PASSWORD` | có | mạnh, không chạy seed trên production (F-02) |
| `APP_ENC_KEY` | base64 32B | secret manager + rotation (F-05) |
| `INTERNAL_HMAC_SECRET` | chuỗi | ngẫu nhiên mạnh; rỗng → fail-closed (Go reject), nhưng Node calls lỗi |
| `MYSQL_*` | user `@'%'`, không TLS (mạng Docker) | giữ nếu DB nội bộ; bật TLS nếu DB ngoài host (F-12) |
| `REALTIME_POLL_MS` | 1000 | cân nhắc tải DB khi nhiều socket |
| `API_RATE_LIMIT`/`AUTH_LOGIN_RATE_LIMIT` | 300/10 | kết hợp rate limit theo username (F-09/F-20) |

**Không được commit**: `.env.local`, `secrets/`, `*.pem`, `*.key`, `graphify-out/`, `test-results/` (đã có trong `.gitignore`; xác nhận `git ls-files` không chứa secret).

---

## 7. Phụ lục C — Việc cần kiểm chứng động (mock-first, không dùng endpoint thật)

1. **F-01/F-02**: trên DB test, import user + lock + restart seed → kiểm tra không bật lại; user import bị buộc đổi MK trước khi dùng.
2. **F-03**: dựng mock caster TLS; xác nhận plaintext bị từ chối khi bật TLS; với mô hình nội bộ, `docker compose port` không mở Internet.
3. **F-04**: mock TCP server; xác nhận `client_password_enc` **không** được gửi khi đổi host; `169.254.169.254`/`127.0.0.1` bị chặn; upstream RFC1918 hợp lệ vẫn kết nối được.
4. **F-05**: unit test AAD/hoán đổi ciphertext; test rotation 2 khóa.
5. **F-06**: mock 150 kết nối hợp lệ từ **cùng một IP** phải PASS; vượt ngưỡng tổng mới bị 503; chỉ backoff khi xác thực sai (không dùng cổng 8081/2101, không chạm relay thật).
6. **F-07**: test import hạ cấp/khóa user cấp cao hơn → phải bị chặn.
7. **F-08**: `PUT /api/map/config` thiếu CSRF header → 403.
8. **F-09**: spoof `X-Forwarded-For` khi không proxy → limiter/IP audit đúng.
9. **F-10/F-11**: kiểm tra Set-Cookie/header bảo mật; production image không chạy Vite dev.
10. **F-16**: so sánh REST snapshot vs socket tick cho user tenant.

> Theo `AGENTS.md`: chỉ test thật sau khi mock PASS, chỉ dùng endpoint trong allowlist, không chạy `relay.exe`, không chiếm 8081/2101.

---

## 8. Phụ lục D — File đã đọc (bằng chứng rà soát)

- Server: `app.ts`, `index.ts`, `config.ts`, `middleware/{auth,csrf}.ts`, `routes/{auth,profile,webUsers,companies,roles,permissions,dictionaries,snapshot,map,mapConfig,geo,stations,mountpoints,caster,relayJobs,ntripAccounts,alerts,history,quality,audit,system,ops}.ts`, `rbac/{access,scope}.ts`, `lib/{password,token,crypto,internalApi,audit,http,excel,tileProxy,mapConfig,maintenance,maintenanceConfig,systemOptimize}.ts`, `db/{pool,runtimePool,seed,importRelay}.ts`, `realtime/{socket,filter,data}.ts`.
- Go: `cmd/corsd/main.go`, `internal/config/config.go`, `internal/api/server.go`, `internal/caster/{auth,request,listener,manager,connection,types}.go`, `internal/{db,secret,ntrip}/*.go`.
- DB/hạ tầng: `db/init/01-init.sh`, `db/migrations/admin/{001,004,015,022,023,024}*.sql`, `docker-compose.yml`, `frontend/{Dockerfile,nginx.conf,.dockerignore}`, `server/Dockerfile`, `gnss/Dockerfile`, `.env.example`, `.gitignore`.
- Frontend: `src/api/client.ts`, `src/auth/AuthProvider.tsx`, `src/components/map/MapCanvas.tsx`, `vite.config.ts`, `package.json`.
- Đồ thị: `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`.

---

## 9. Ghi chú cuối

- Báo cáo này **không thay đổi mã nguồn**, không tạo migration, không chạy seed/relay. Mọi khuyến nghị cần được đưa thành task riêng trong `TASKS.md` và triển khai theo phase, kèm test mock-first.
- Thứ tự ưu tiên đề xuất (theo use case, không theo mức lý thuyết): **F-02 (nếu dùng production) → F-04 (bind credential với host) → F-07 → F-03 (chỉ khi public Internet) → F-01 (buộc đổi MK) → F-09/F-10 (khi production) → còn lại**. F-08/F-12/F-17 là hardening tùy chọn.
- **Nguyên tắc xuyên suốt:** không dùng giới hạn theo IP cho NTRIP caster/relay. Fan-in 100 trạm từ một IP và fan-out nhiều kết nối tới một upstream IP là hợp lệ; chỉ giới hạn theo listener/account/tổng tài nguyên và chỉ throttle **xác thực sai**.
- Hai file `docs/2/PHAN_QUYEN.md` (phân quyền) và báo cáo này nên được đọc cùng nhau khi thay đổi RBAC/company/scope.
