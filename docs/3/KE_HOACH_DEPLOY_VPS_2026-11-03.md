# Kế hoạch deploy VPS mới — CORS Manager

- Ngày kiểm tra: 2026-11-03
- VPS: `43.240.117.54`, SSH `root@... -p 24700` (key
  `~/.ssh/CS-Linux-20261103230212929.pem`)
- Trạng thái: VPS trắng, chưa cài Docker; **chưa thay đổi gì trên VPS** (chỉ đọc
  thông tin). Đã chốt: domain `https://rtktk.online`, Caddy (DNS-only), cutover
  20:00–23:59 (+07), backup VPS 02:00 hằng ngày, giữ SSH hiện trạng, dump DB.
- Cập nhật 2026-11-04: listener mặc định đổi sang **2101**; production phải
  publish và mở firewall **1508/1509/2101** và dải port riêng **1510–1599**.

## 1. Hiện trạng VPS (đã kiểm tra)

| Hạng mục | Kết quả |
|---|---|
| OS | Ubuntu 24.04.1 LTS |
| CPU / RAM | 2 vCPU / 3.8 GiB (4.010.016 kB) |
| Disk | 40 GB, đã dùng 3.3 GB (9%) |
| Swap | **Chưa có** |
| Timezone | +07 (đúng) |
| Docker | **Chưa cài** (không có docker/compose) |
| UFW | **Inactive** |
| SSH | port 24700, `permitrootlogin yes`, `passwordauthentication yes` |
| Tiến trình khác | `onedash-agent`, `vmagent` (monitoring của nhà cung cấp — không đụng) |
| Port đang mở | 24700 (SSH), 9099/8429 loopback (agent) |
| 80/443/2101/1508/1509 từ Internet | đóng (chưa có service) |
| DNS `rtktk.online` | đang trỏ `103.166.183.250` (hệ thống cũ), chưa trỏ VPS mới |
| Công cụ có sẵn | git 2.43, curl 8.5, chrony |

Kết luận: VPS đủ cho stack hiện tại nhưng cần hardening, swap, Docker, firewall
và cấu hình production trước khi chạy dữ liệu thật.

## 2. Mục tiêu và nguyên tắc

1. Dữ liệu an toàn: backup trước/sau, restore thử, không mất secret mã hoá.
2. Hệ thống ổn định: healthcheck, restart policy, giới hạn RAM/CPU, log xoay
   vòng, swap, giám sát.
3. Bảo mật: SSH key + user riêng, tắt password/root login, firewall chỉ mở cổng
   cần thiết, TLS cho web, DB/API nội bộ không public.
4. Không đưa secret vào git; `.env.production` chỉ trên VPS, quyền 600.
5. Cutover có rollback; relay giữ disabled đến khi trạm online.

## 3. Kiến trúc production đề xuất

```text
Internet
 ├─ 80/443 ── Caddy (TLS tự động) ── web-prod (nginx tĩnh, 8080)
 │                              └── /api, /socket.io ── server:4000
 ├─ 1508/1509/2101, 1510-1599 ── gnss caster (public, NTRIP)
 └─ 24700 ── SSH (giới hạn IP nếu có)

Nội bộ Docker:
  server:4000  <── web-prod proxy
  server ── gnss:7080 (HMAC internal)
  server/gnss ── mysql:3306
  migrate (one-shot) ── mysql
  mysql_data volume; backup ra /opt/cors/backups + offsite
```

- `mysql`, `server`, `gnss`, `web-prod`, `caddy` chạy trên network nội bộ.
- Chỉ Caddy (80/443), gnss (1508/1509/2101, 1510–1599), SSH (24700) lộ ra ngoài.
- `server` không chạy seed/watch; command `node dist/index.js`.
- `web-prod` chỉ bind nội bộ; Caddy reverse proxy + WebSocket.
- `gnss` publish 1508/1509/2101 và dải 1510–1599 trên `0.0.0.0`;
  7080 chỉ loopback.

## 4. Chuẩn bị trước khi deploy

### 4.1. DNS / TLS (đã chốt Caddy)

- Domain: **https://rtktk.online** (không dùng www/subdomain).
- Hạ TTL bản ghi `rtktk.online` xuống 300s trước cutover 24–48h.
- Tạo A record `rtktk.online` → `43.240.117.54` **tại thời điểm cutover**,
  không trỏ sớm khi chưa có TLS.
- **DNS-only, không bật Cloudflare proxy**: thiết bị NTRIP dùng
  `rtktk.online:1508/1509/2101` hoặc port riêng 1510–1599 (TCP thô); nếu proxy,
  DNS trả IP Cloudflare và các cổng này sẽ không tới được VPS. Vì vậy giữ bản
  ghi A trỏ trực tiếp VPS.
- **Caddy** làm reverse proxy 80/443 → web-prod, tự xin/gia hạn Let's Encrypt;
  cấu hình `Caddyfile` nội bộ, HTTP→HTTPS, WebSocket `/socket.io`.
- Không dùng nginx+certbot hay Cloudflare proxy cho pha này.

### 4.2. Secret và khoá mã hoá

- `APP_ENC_KEY`: **giữ nguyên key hiện tại** để giải mã credential relay/trạm đã
  import; lưu bản offline (password manager/giấy niêm phong). Nếu mất key, toàn
  bộ mật khẩu mã hoá không khôi phục được.
- `APP_ENC_KEY_PREVIOUS`: để trống trừ khi xoay key.
- Tạo mới: `SESSION_SECRET`, mật khẩu MySQL (root/app/migrator/relay), mật khẩu
  seed; không dùng lại mật khẩu dev.
- `.env.production` trên VPS: `chmod 600`, owner deploy; không commit.
- Các biến bắt buộc: `NODE_ENV=production`, `CORS_ORIGIN=https://rtktk.online`,
  `SESSION_COOKIE_SECURE=true`, `MYSQL_HOST=mysql`, `GO_INTERNAL_URL=http://gnss:7080`,
  `CASTER_PUBLIC_PORTS=1508,1509,2101,1510-1599`.

### 4.3. Dữ liệu nguồn

- Dump `cors_admin` + `cors_runtime` từ máy hiện tại (trạng thái cuối:
  1 company/2 user/36 trạm/31 mountpoint/32 mapping/67 relay disabled/3 account).
- Chuyển dump sang VPS qua SCP, kiểm tra SHA256.
- Không chạy `resetLegacyV2`/`importLegacyV2` trên production nếu đã có dump;
  chỉ dùng khi muốn dựng lại từ `db/data`.

## 5. Các pha triển khai

### Pha 0 — Hardening VPS (chưa có dữ liệu)

1. Tạo user `deploy`, copy public key, cấp sudo + group docker (sau khi cài).
2. **Giữ nguyên SSH hiện trạng** theo yêu cầu: root login + password auth vẫn
   bật; port 24700. Chỉ cài fail2ban để giảm brute-force; bạn sẽ tự tắt
   password/root sau.
3. UFW: default deny incoming; allow 24700 (không giới hạn IP), 80/443,
   1508/1509/2101 và 1510–1599; IPv6 tương ứng.
4. Cài `fail2ban` (sshd), `unattended-upgrades`, `chrony` (đã có), `htop`,
   `rsync`.
5. Swap 4 GB (`/swapfile`, `vm.swappiness=10`), `sysctl` network cơ bản.
6. Cài Docker Engine + compose plugin từ repo chính thức; bật log rotation
   mặc định; giới hạn `live-restore`.
7. Gate: SSH root hiện tại vẫn vào được, user deploy OK, UFW active, swap bật,
   fail2ban active, `docker run --rm hello-world` OK.

### Pha 1 — Chuẩn bị mã nguồn & compose production

1. Clone repo vào `/opt/cors/app` (user deploy), checkout commit phát hành.
2. Tạo `docker-compose.prod.yml`:
   - `mysql`: không publish port; `mem_limit 1400m`, buffer pool 768M,
     max_connections 150; volume `mysql_data`; healthcheck.
   - `migrate`: build server image, chạy một lần.
   - `server`: image build từ `server/Dockerfile`, `restart unless-stopped`,
     `mem_limit 700m`, `NODE_ENV=production`, **không** mount source, không seed.
   - `gnss`: build `gnss/`, `700m`, publish `1508:1508`, `1509:1509`,
     `2101:2101`, `1510-1599:1510-1599`, `127.0.0.1:7080:7080`; healthcheck.
   - `web-prod`: profile production, `128m`, read_only, bind nội bộ 8080.
   - `caddy`: image caddy, 80/443, volume config + data, `128m`, phụ thuộc
     web-prod/server healthy.
   - Logging json-file max 10m × 3 cho mọi service; `restart unless-stopped`.
3. `.env.production` + `Caddyfile` (reverse proxy, WebSocket, header bảo mật,
   nén, cache tĩnh).
4. Build image trên VPS (có swap) hoặc build local rồi chuyển image; gắn tag
   phiên bản để rollback.
5. Gate: `docker compose config` hợp lệ; image build OK; không có secret trong
   compose/repo.

### Pha 2 — Khôi phục dữ liệu vào MySQL production

1. Khởi động `mysql` + `migrate`, chờ healthy.
2. Restore `cors_admin` rồi `cors_runtime` từ dump; chạy migration nếu schema cũ
   hơn (hiện admin 38/runtime 7).
3. Kiểm tra counts: company=1, user=2, station=36, mountpoint=31, mapping=32,
   relay=67 (enabled=0), account=3, listener=2; `schema_migrations` đúng.
4. Kiểm tra Go đọc credential: start `gnss`, `/health` không lỗi credential,
   `relayDegraded=false`.
5. Gate: counts khớp, login superadmin/wally qua API nội bộ, sourcetable mock
   publish/read đúng (no-auth publish, read cần account).

### Pha 3 — Chạy stack và kiểm tra nội bộ

1. `docker compose -f docker-compose.prod.yml up -d`; chờ tất cả healthy.
2. `curl` nội bộ: `/health` server, `/health` gnss, login, `/api/stations`,
   `/api/relay-jobs`.
3. Test qua Caddy bằng `--resolve rtktk.online:443:127.0.0.1` trước khi đổi DNS
   (certificate có thể chưa cấp nếu DNS chưa trỏ; dùng HTTP tạm hoặc DNS staging).
4. Gate: 5 container healthy; log không lỗi; RAM/disk ổn; web load map/tile,
   WebSocket realtime hoạt động; 1508/1509/2101 và một port 1510–1599 truy cập
   từ ngoài (test mock).

### Pha 4 — Backup & monitoring trước cutover

1. **Backup của nhà cung cấp**: full VPS hằng ngày lúc **02:00**, restore toàn
   VPS; đây là lớp DR chính, không tốn tài nguyên VPS.
2. Trước cutover: tạo **snapshot thủ công** (nếu nhà cung cấp hỗ trợ) + dump
   logic `admin`/`runtime` ra `/opt/cors/backups` (retention 7–14 ngày) để
   restore nhanh không cần khôi phục cả VPS.
3. Script `/opt/cors/backup.sh`: mysqldump admin+runtime, gzip, sha256; chạy
   trước/sau cutover và có thể chạy tay khi cần; không cần rclone/S3.
4. Cron kiểm tra dung lượng, healthcheck container, log rotate.
5. Diễn tập restore dump vào MySQL tạm trên VPS; so counts; xoá DB tạm.
6. Gate: snapshot/dump trước cutover có checksum; restore thử PASS; xác nhận
   lịch backup 02:00 và thời gian retention của nhà cung cấp.

### Pha 5 — Cutover (20:00–23:59 giờ Việt Nam)

Khung giờ chốt: **20:00–23:59 (+07)**, ngoài giờ sử dụng. Dự phòng 30 phút cho
việc tắt/bật thiết bị để nhận IP mới. Toàn bộ timeline nằm trong khung này.

| Mốc | Việc làm | Người phụ trách |
|---|---|---|
| T-48h | Hạ TTL `rtktk.online` = 300s; xác nhận backup 02:00 đã chạy; thông báo lịch | Admin |
| T-1 ngày | Snapshot/dump thử, restore thử trên VPS; kiểm tra counts | Admin |
| 20:00 | Bắt đầu bảo trì: dừng nhận ghi trên hệ thống cũ (dừng caster/server cũ hoặc chặn 1509/1508) | Admin |
| 20:00–20:05 | Dump cuối `cors_admin` + `cors_runtime`; SHA256; chuyển sang VPS; restore; kiểm tra counts | Admin |
| 20:05–20:10 | Start stack VPS; healthcheck; login nội bộ; test sourcetable mock | Admin |
| 20:10 | Đổi DNS A `rtktk.online` → `43.240.117.54`; kiểm tra `dig`/DNS propagation | Admin |
| 20:10–20:15 | Kiểm tra TLS/web `https://rtktk.online`, login superadmin/wally | Admin |
| 20:15–20:45 | **Tắt/bật thiết bị NTRIP theo danh sách** để nhận IP mới (dự kiến 30 phút); theo dõi thiết bị online | Vận hành thiết bị |
| 20:45–21:00 | Đối chiếu sourcetable 1509/1508, số trạm online, log 401/403 | Admin |
| 21:00 | Kết thúc bảo trì; hệ thống mới là chính thức | Admin |
| 21:00–23:59 | Theo dõi RAM/disk/log/relay; xử lý thiết bị chưa lên; bật relay theo nhóm khi ổn định | Admin |
| T+24–48h | Soak test, kiểm tra backup 02:00 đầu tiên trên VPS mới | Admin |
| T+7 ngày | Giữ hệ thống cũ + dump cuối để rollback; sau đó tắt hẳn | Admin |

Lưu ý cutover:

- **Phải đổi DNS xong và kiểm tra phân giải trước khi cho tắt/bật thiết bị**,
  nếu không thiết bị có thể reconnect về IP cũ.
- Kết nối NTRIP đang mở không tự chuyển theo DNS; việc tắt/bật thiết bị là bắt
  buộc. Danh sách thiết bị + người phụ trách cần chuẩn bị trước 20:00.
- Thiết bị nào không tắt được từ xa thì cần phương án tại chỗ; ghi nhận thiết bị
  chưa lên trong 30 phút để xử lý sau.
- Không bật relay trong lúc thiết bị đang reconnect; chỉ bật sau khi sourcetable
  ổn định.
- Nếu quá 23:59 vẫn chưa xong: giữ hệ thống mới ở trạng thái đã restore, tiếp tục
  theo dõi; quyết định rollback trước 24h nếu lỗi nghiêm trọng.

### Pha 6 — Ổn định & bàn giao

- Chạy soak 24–48h: RAM, swap, CPU, disk, log, reconnect.
- Chốt tài liệu vận hành: runbook sự cố, lịch backup, quy trình restore, đầu mối.
- Đổi mật khẩu `wally`, xác nhận superadmin, khoá seed/test.
- Gate: 48h không sự cố; backup nhà cung cấp 02:00 + dump logic có; tài liệu
  cập nhật.

## 6. Ngân sách tài nguyên (3.8 GiB RAM)

| Service | mem_limit | Ghi chú |
|---|---:|---|
| mysql | 1400m | buffer pool 768M, max_connections 150 |
| server | 700m | Node production, không watch |
| gnss | 700m | caster + relay + analyzer |
| web-prod | 128m | nginx tĩnh |
| caddy | 128m | TLS/proxy |
| **Tổng limit** | ~3.06 GB | còn ~0.7 GB cho OS/Docker; swap 4 GB dự phòng |

- 2 vCPU: tránh build đồng thời; build lúc thấp điểm hoặc build local.
- Disk 40 GB: image + MySQL + log + dump logic 7–14 ngày; backup toàn VPS do nhà
  cung cấp xử lý ngoài VPS.

## 7. Bảo mật

- SSH: **giữ hiện trạng** (root + password) theo yêu cầu; đã cài fail2ban;
  khuyến nghị tắt password/root sau khi vận hành ổn định. UFW vẫn bật.
- Docker: không publish MySQL/4000/7080; chỉ Caddy + 1508/1509/2101 + 1510–1599.
- Web: TLS bắt buộc, HSTS, CSP hiện có, cookie Secure/HttpOnly/SameSite.
- Nguồn trạm no-auth trên 1508/1509/2101/1510–1599 là rủi ro đã chấp nhận:
  theo dõi nguồn trùng, log IP, cân nhắc allowlist IP thiết bị; chiều đọc dữ liệu
  vẫn bắt buộc account.
- Secret: `.env.production` 600, không log, audit redaction; backup key offline.
- Không bật Cloudflare proxy cho `rtktk.online` (sẽ chặn NTRIP 1508/1509/2101
  và 1510–1599).

## 8. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Mất `APP_ENC_KEY` | Escrow offline trước cutover; không regenerate |
| RAM thấp khi build/relay | Swap 4G, limit service, build tuần tự, theo dõi OOM |
| DNS/TLS chưa sẵn sàng | Hạ TTL, test Host header trước, giữ old system |
| Dữ liệu lệch lúc cutover | Freeze ghi, dump cuối, đối chiếu counts/checksum |
| Rollback mất dữ liệu mới | Chấp nhận cửa sổ ngắn; dump system mới trước khi rollback |
| Thiết bị không nhận IP mới | Tắt/bật theo danh sách, dự phòng 30 phút; đổi DNS xong mới tắt |
| Thiết bị reconnect về IP cũ | Hạ TTL trước 48h; kiểm tra `dig` trước khi tắt thiết bị |
| Rollback cần tắt thiết bị lần 2 | Cân nhắc kỹ; chỉ rollback trong 24h đầu; thông báo trước |
| No-auth bị ghi giả | Giám sát nguồn trùng/IP, allowlist khi xác định được |
| Nhà cung cấp chặn port | Kiểm tra firewall provider trước cutover |

## 9. Rollback

1. Giữ hệ thống cũ nguyên trạng + dump cuối ít nhất 7 ngày.
2. Nếu lỗi sau cutover: đổi DNS về IP cũ; restore dump mới nhất của hệ thống cũ
   nếu đã ghi; **thông báo tắt/bật thiết bị lần 2** để nhận IP cũ (dự phòng thêm
   30 phút).
3. Trên VPS: `docker compose down` (giữ volume), restore dump trước đó nếu cần
   chạy lại; không xoá volume/backup.
4. Chỉ rollback trong 24h đầu nếu lỗi nghiêm trọng; sau đó cần cân nhắc dữ liệu
   phát sinh trên hệ thống mới.

## 10. Quyết định đã chốt

1. Domain: **https://rtktk.online**.
2. SSH: giữ root + password hiện trạng; không giới hạn IP; cài fail2ban.
3. Backup: nhà cung cấp full VPS **02:00 hằng ngày**, restore toàn VPS; thêm dump
   logic trước/sau cutover.
4. TLS: **Caddy**, DNS-only, không Cloudflare proxy.
5. Cutover: **20:00–23:59 (+07)**, dự phòng 30 phút tắt/bật thiết bị.
6. Không có cloud firewall; chỉ UFW trên VPS.
7. Deploy bằng **dump DB**.

Còn cần xác nhận khi bắt đầu triển khai:

- Ngày cutover cụ thể (đề xuất một tối trong tuần).
- Nhà cung cấp có cho phép tạo snapshot thủ công trước cutover không.
- Thời gian retention backup 02:00 (7/14/30 ngày).
- Danh sách thiết bị + người chịu trách nhiệm tắt/bật trong khung 30 phút.
