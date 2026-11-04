# Kế hoạch deploy VPS mới — CORS Manager

- Ngày kiểm tra VPS: 2026-11-03; cập nhật kế hoạch: 2026-11-04.
- VPS: `43.240.117.54`, SSH `root@... -p 24700` (key
  `~/.ssh/CS-Linux-20261103230212929.pem`)
- Trạng thái: VPS trắng, chưa cài Docker; **chưa thay đổi gì trên VPS** (chỉ đọc
  thông tin). Đã chốt: domain `https://rtktk.online`, Caddy (DNS-only), cutover
  20:00–23:59 (+07), backup VPS 02:00 hằng ngày, giữ SSH hiện trạng, dump DB.
- Cập nhật 2026-11-04: listener mặc định **2101**; production publish/firewall
  **1508/1509/2101** và dải port riêng **1510–1599**. Schema hiện tại
  **admin 41 / runtime 7**. Production **chỉ giữ dữ liệu Wally**, không giữ
  company/user/trạm/mountpoint/listener/account/relay demo hoặc test.

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
| 80/443/1508/1509/2101/1510–1599 từ Internet | đóng (chưa có service) |
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
6. Không giữ tài nguyên/dữ liệu demo trên production: chỉ Wally + dữ liệu vận
   hành thật; mọi bản ghi DOCS/E2E/Metrics/Trạm test phải xoá trước khi dump.

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

### 4.3. Dữ liệu nguồn — chỉ giữ Wally, không giữ demo

**Mục tiêu trước khi dump:**

| Đối tượng | Giữ lại | Xoá bỏ |
|---|---|---|
| Company | 1 (WALLY) | company `admin` và mọi company demo/test |
| Web user | 2 (superadmin, wally) | `admin`, `user1`, `user2`, `docs.*`, E2E |
| Station | 36 (Wally) | `Trạm test ...`, `DOCS-*`, `E2E*`, `Metrics*` |
| Mountpoint | 31 (Wally) | mountpoint của trạm demo/test |
| Caster listener | 3 (1508/1509/2101) | listener 1599 demo và listener DOCS/E2E |
| Mapping listener | 58 (1508=6, 1509=26, 2101=26) | mapping của listener demo |
| NTRIP account | 3 (Wally: nguyen/admin/aitogy123) | `seed_*`, `test_ntrip_*`, `docs_*`, E2E |
| Relay job | 67 (Wally, disabled) | relay `Metrics Relay ...`, DOCS/E2E |
| Schema | admin **41**, runtime **7** | — |

**Thứ tự làm trước khi dump:**

1. Backup DB hiện tại ra ngoài repo; ghi SHA256.
2. Xoá listener 1599 demo, mapping, 3 mountpoint + 3 trạm test, 5 account demo
   (`seed_687/688/689`, `test_ntrip_01/02`), user `admin/user1/user2`,
   company `admin`.
3. Xoá relay test `Metrics Relay ...` (company NULL); giữ 67 relay Wally disabled.
4. Xoá runtime test phát sinh từ demo/DOCS/E2E/Metrics; không xoá lịch sử Wally
   thật nếu đã có.
5. Kiểm tra lại counts đúng bảng trên; kiểm tra 0 mapping/ACL/source chéo company.
6. Dump `cors_admin` + `cors_runtime`; SHA256; SCP sang VPS.
7. Không chạy `resetLegacyV2`/`importLegacyV2` trên production nếu đã có dump.
8. **Chưa tạo script cleanup**: thực hiện thủ công theo checklist này trước khi dump.

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
   hơn (hiện admin **41**/runtime **7**).
3. Kiểm tra counts: company=1 (WALLY), user=2, station=36, mountpoint=31,
   listener=3 (1508/1509/2101), mapping=58 (6/26/26), relay=67 (enabled=0),
   account=3; `schema_migrations` đúng; 0 bản ghi demo/DOCS/E2E/Metrics.
4. Kiểm tra Go đọc credential: start `gnss`, `/health` không lỗi credential,
   `relayDegraded=false`.
5. Gate: counts khớp, login superadmin/wally qua API nội bộ, sourcetable
   anonymous trả đủ mountpoint của listener, đọc dữ liệu vẫn cần account/ACL.

### Pha 3 — Chạy stack và kiểm tra nội bộ

1. `docker compose -f docker-compose.prod.yml up -d`; chờ tất cả healthy.
2. `curl` nội bộ: `/health` server, `/health` gnss, login, `/api/stations`,
   `/api/relay-jobs`.
3. Test qua Caddy bằng `--resolve rtktk.online:443:127.0.0.1` trước khi đổi DNS
   (certificate có thể chưa cấp nếu DNS chưa trỏ; dùng HTTP tạm hoặc DNS staging).
4. Gate: mysql/server/gnss/web-prod/caddy healthy, migrate exit 0; log không
   lỗi; RAM/disk ổn; web load map/tile, WebSocket realtime hoạt động;
   1508/1509/2101 và một port 1510–1599 truy cập từ ngoài (test mock).

### Pha 4 — Backup & monitoring trước cutover

1. **Backup của nhà cung cấp**: full VPS hằng ngày lúc **02:00**, restore toàn
   VPS; đây là lớp DR chính, không tốn tài nguyên VPS.
2. Trước cutover: tạo **snapshot thủ công** (nếu nhà cung cấp hỗ trợ) + dump
   logic `admin`/`runtime` ra `/opt/cors/backups` (retention 7–14 ngày) để
   restore nhanh không cần khôi phục cả VPS.
3. Script `/opt/cors/backup.sh` (tạo ở Pha 4): mysqldump admin+runtime, gzip,
   sha256; chạy trước/sau cutover và có thể chạy tay khi cần; không cần rclone/S3.
4. Cron kiểm tra dung lượng, healthcheck container, log rotate.
5. Diễn tập restore dump vào MySQL tạm trên VPS; so counts; xoá DB tạm.
6. Gate: snapshot/dump trước cutover có checksum; restore thử PASS; xác nhận
   lịch backup 02:00 và thời gian retention của nhà cung cấp.

### Pha 5 — Cutover (20:00–23:59 giờ Việt Nam)

Khung giờ chốt: **20:00–23:59 (+07)**, ngoài giờ sử dụng. Dự phòng 30 phút cho
việc tắt/bật thiết bị để nhận IP mới. Toàn bộ timeline nằm trong khung này.

| Mốc | Việc làm | Người phụ trách |
|---|---|---|
| T-48h | Hạ TTL `rtktk.online` = 300s; xác nhận backup 02:00 đã chạy; thông báo lịch; xác nhận đã xoá demo/test | Admin |
| T-1 ngày | Snapshot/dump thử **sau khi xoá demo**, restore thử trên VPS; kiểm tra counts + schema 41 | Admin |
| 20:00 | Bắt đầu bảo trì: dừng nhận ghi trên hệ thống cũ (dừng caster/server cũ hoặc chặn 1508/1509/2101) | Admin |
| 20:00–20:05 | Dump cuối `cors_admin` + `cors_runtime`; SHA256; chuyển sang VPS; restore; kiểm tra counts (không có demo) | Admin |
| 20:05–20:10 | Start stack VPS; healthcheck; login nội bộ; test sourcetable anonymous + đọc dữ liệu cần account | Admin |
| 20:10 | Đổi DNS A `rtktk.online` → `43.240.117.54`; kiểm tra `dig`/DNS propagation | Admin |
| 20:10–20:15 | Kiểm tra TLS/web `https://rtktk.online`, login superadmin/wally | Admin |
| 20:15–20:45 | **Tắt/bật thiết bị NTRIP theo danh sách** để nhận IP mới (dự kiến 30 phút); theo dõi thiết bị online | Vận hành thiết bị |
| 20:45–21:00 | Đối chiếu sourcetable 1508/1509/2101 (và port riêng nếu có), số trạm online, log 401/403 | Admin |
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
- Xác nhận UI/DB không còn company/user/trạm/mountpoint/listener/account/relay
  demo hoặc test; counts đúng bảng mục 4.3.
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
| Dump còn dữ liệu demo | Checklist mục 4.3 + counts + tìm DOCS/E2E/Metrics/Trạm test trước dump |

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
6. **Không bật firewall trong pha này**: UFW/OneDash để tắt; người dùng tự bật sau
   theo hướng dẫn mục 11.
7. Deploy bằng **dump DB**.
8. **Không giữ tài nguyên/dữ liệu demo**: chỉ Wally + 36 trạm/31 mountpoint/
   3 listener/3 account/67 relay thật; xoá toàn bộ DOCS/E2E/Metrics/Trạm test.
9. Port đầu vào: **1508/1509/2101** (Wally) + dải riêng **1510–1599**.

Còn cần xác nhận khi bắt đầu triển khai:

- Ngày cutover cụ thể (đề xuất một tối trong tuần).
- Nhà cung cấp có cho phép tạo snapshot thủ công trước cutover không.
- Thời gian retention backup 02:00 (7/14/30 ngày).
- Danh sách thiết bị + người chịu trách nhiệm tắt/bật trong khung 30 phút.

## 11. Kết quả thực hiện

| Bước | Trạng thái | Bằng chứng |
|---|---|---|
| 1. Chuẩn hoá dữ liệu + dump | PASS 2026-11-04 | Backup `cors-mysql-20261104-220116.sql.zip` SHA256 `47D5...B7F1`; DB đích 1 company/2 user/36 station/31 MP/3 listener/58 mapping/3 account/67 relay, 0 demo, 0 cross-company; dump `cors-prod.sql.gz` SHA256 `DB6C...5406`, đã SCP VPS `/root/cors-prod.sql.gz`. |
| 2. Hardening VPS | PASS 2026-11-04 | User `deploy` SSH + sudo/docker OK; Docker 29.9.3 + Compose v5.7.0; swap 4 GB; fail2ban active; timezone +07; **UFW inactive, không thêm rule OneDash**. |
| 3. Compose production + Caddy | PASS 2026-11-04 | Repo clone `/opt/cors/app` @ `4dd3d78`; `docker-compose.prod.yml`, `Caddyfile`, `Caddyfile.staging`; `.env.production` 600; image `cors-server:prod`, `cors-web:prod`, `cors-gnss:prod`; compose config OK; Caddy staging/prod validate OK. |
| 4. Restore DB | PASS 2026-11-04 | Restore OK; counts 1/2/36/31/3/58/3/67; schema 41/7; 0 demo, 0 cross-company; server login superadmin/wally 200; API stations 36, relay 67, listeners 1508/1509/2101; gnss health `relayDegraded=false`; sourcetable 6/26/26 STR; data anonymous 401. |
| 5. Stack + test nội bộ/staging | PASS 2026-11-04 | 5 service healthy, migrate exit 0; Caddy staging HTTPS 200, `/health` 200, JS asset 200, API unauth 401; WebSocket 101; public 1508/1509/2101 sourcetable 6/26/26, custom 1510 tạo/xóa OK (1 STR), data anonymous 401; không lỗi log. |
| 6. Backup + restore drill | PASS 2026-11-04 | `/opt/cors/backup.sh` chạy OK; dump `cors-prod-20261104-153215.sql.gz` SHA256 `4272...7a57`; cron `15 2 * * *`, retention 14 ngày; restore sang MySQL tạm PASS, counts 1/2/36/31/3/58/3/67, schema 41/7; không tạo snapshot (người dùng tự làm ngoài VPS). |
| 7. Smoke + data integrity | PASS 2026-11-04 | Smoke 15 phút: source 269.760 bytes, rover 269.370 bytes, health OK, RAM ~1.76 GB, disk 31%, server/gnss/caddy/web restart 0; mysql RestartCount=1 do init ban đầu, không tăng trong smoke. `CHECK TABLE` 11 bảng OK; orphan 0; cross-company 0; relay enabled 0; account smoke đã xoá, runtime test đã clear; DB vẫn 1/2/36/31/3/58/3/67, schema 41/7. |
| 8. Runbook + báo cáo | PASS 2026-11-04 | Runbook cutover + hướng dẫn OneDash đã thêm; không đổi DNS/cutover; báo cáo readiness bên dưới. |

## 12. Hướng dẫn bật firewall OneDash (người dùng tự làm sau)

Trạng thái hiện tại: **UFW inactive, OneDash chưa thêm rule** theo xác nhận của
người dùng. Không bật firewall trong pha deploy này.

Thao tác trên OneDash:

1. Vào **Cloud Server → CS-Linux-20261103230212929 → Firewall**.
2. Bấm **Thêm rule**.
3. Thêm theo thứ tự, **Loại = Cho phép**, **Giao thức = TCP**:

| Thứ tự | Mục đích | Cổng |
|---:|---|---|
| 1 | SSH (bắt buộc thêm trước) | `24700` |
| 2 | HTTP | `80` |
| 3 | HTTPS | `443` |
| 4 | NTRIP Wally | `1508`, `1509`, `2101` |
| 5 | NTRIP công ty | `1510–1599` |

- Nếu ô Cổng không nhận dải, thêm từng port trong `1510–1599`.
- Chỉ bật firewall sau khi đã thêm rule SSH `24700` và kiểm tra lại SSH.
- Sau khi bật, kiểm tra từ ngoài: `80/443`, `1508/1509/2101`, một port
  `1510–1599`.
- OneDash/IPtables nằm ngoài VPS; Docker publish port có thể bypass UFW nội bộ,
  nên test từ Internet sau khi bật.
- Nếu bật UFW trên VPS sau này, nhớ allow `24700` trước khi enable.

## 13. Runbook cutover thủ công (người dùng thực hiện)

Trạng thái trước cutover:
- Stack VPS đang chạy với `.env.production` và **Caddyfile.staging** (`tls internal`).
- Caddy production `Caddyfile` đã validate nhưng chưa active.
- DNS `rtktk.online` vẫn trỏ hệ thống cũ; agent không đổi DNS.
- Không có thiết bị thật kết nối VPS trước cutover.

### T-48h
1. TTL đã là 300s.
2. Tạo snapshot ngoài VPS (người dùng tự làm).
3. Xác nhận backup 02:00 của nhà cung cấp.
4. Chốt danh sách thiết bị + người tắt/bật.

### T-1 ngày
1. Dump cuối từ hệ thống cũ, SHA256.
2. Restore thử vào MySQL tạm trên VPS; so counts.
3. Kiểm tra lại stack staging, port, WebSocket, sourcetable.

### 20:00–20:05
1. Dừng nhận ghi trên hệ thống cũ.
2. Dump cuối `cors_admin` + `cors_runtime`; SHA256; SCP sang VPS.
3. Restore vào MySQL production trên VPS; kiểm tra counts.
4. Chạy `/opt/cors/backup.sh` trước cutover.

### 20:05–20:10 — trước khi đổi DNS
1. `docker compose -f docker-compose.prod.yml up -d`.
2. `docker compose ps`; migrate exit 0; 5 service healthy.
3. `curl http://127.0.0.1:4000/health`; `curl http://127.0.0.1:7080/health`;
   login nội bộ; sourcetable anonymous.
4. Vẫn giữ Caddy staging để tránh ACME khi DNS chưa trỏ.

### 20:10 — đổi DNS
1. Đổi A record `rtktk.online` → `43.240.117.54`.
2. Kiểm tra `dig rtktk.online` / DNS propagation.
3. **Chỉ sau khi DNS trỏ VPS** mới chuyển Caddy sang production:
   ```bash
   cd /opt/cors/app
   CADDYFILE=Caddyfile docker compose -f docker-compose.prod.yml up -d --force-recreate caddy
   ```
4. Chờ Caddy xin Let's Encrypt; kiểm tra:
   ```bash
   curl -I https://rtktk.online/
   curl https://rtktk.online/health
   ```
5. Nếu Caddy staging vẫn còn, HTTPS sẽ dùng cert nội bộ; chỉ dùng trong lúc
   chưa đổi DNS.

### 20:10–20:15
- Kiểm tra TLS/web `https://rtktk.online`, login superadmin/wally.
- Kiểm tra API, WebSocket, sourcetable 1508/1509/2101.

### 20:15–20:45
- Tắt/bật thiết bị NTRIP theo danh sách để nhận IP mới.
- Theo dõi thiết bị online; ghi nhận thiết bị chưa lên.

### 20:45–21:00
- Đối chiếu sourcetable 1508/1509/2101 (và port riêng), số trạm online, log 401/403.
- Chỉ bật relay theo nhóm sau khi sourcetable ổn định.

### 21:00
- Kết thúc bảo trì; hệ thống mới chính thức.
- Theo dõi RAM/disk/log/relay; xử lý thiết bị chưa lên.

### Rollback
1. Giữ hệ thống cũ + dump cuối ít nhất 7 ngày.
2. Nếu lỗi nghiêm trọng: đổi DNS về IP cũ; thông báo tắt/bật thiết bị lần 2.
3. Trên VPS: `docker compose down` (giữ volume); không xoá volume/backup.
4. Dump dữ liệu mới trước khi rollback nếu đã ghi.
5. Chỉ rollback trong 24h đầu nếu lỗi nghiêm trọng.

## 14. K?t qu? cutover k? thu?t (2026-11-04)

| B�?c | Tr?ng th�i | B?ng ch?ng |
|---|---|---|
| Caddy production | PASS | DNS tr? VPS; Caddyfile production active; HTTPS 200 kh�ng -k; cert Let's Encrypt CN=YE1, h?n 2027-02-02; /health 200. |

**��nh gi� d? li?u sau cutover:** ch? thu **5 ph�t li�n t?c** cho m?i tr?m/relay m?c ti�u �? �?m frame, byte, CRC v� ki?m tra d? li?u RTCM; kh�ng d�ng uptime d�i h?n l�m ti�u ch�. M?c ti�u t?i thi?u 3/10 tr?m v� 3/10 relay c� d? li?u th?c t? trong 5 ph�t.

| Caddy production | PASS 2026-11-04 | Caddyfile production active; HTTPS 200 kh�ng -k; cert Let's Encrypt CN=YE1 h?n 2027-02-02; /health 200. |
| Tr?m/relay online | BLOCKED 2026-11-04 | Caster m?i 0 source connection. Caster c? 103.166.183.250:1509 v?n tr? 5 STR: LCI_BaoHa, TQG_HamYen, QNH_DongTrieu, YBI_MuCangChai, BKN_NARI. Thi?t b? v?n n?i IP c?; c?n �?i host thi?t b? sang 43.240.117.54 ho?c d?ng caster c?. |

| Caster legacy SOURCE | FIXED 2026-11-04 | Thi?t b? g?i SOURCE 123456 BDH1 (NTRIP v1, password + mountpoint, kh�ng c� d?u /); parser c? ch? nh?n SOURCE /MOUNT n�n tr? 404 v� ��ng k?t n?i. �? s?a gnss/internal/caster/request.go �? chu?n h�a request line legacy; test TestLegacySourceRequestLine PASS; sau deploy 15 source connection online. |
