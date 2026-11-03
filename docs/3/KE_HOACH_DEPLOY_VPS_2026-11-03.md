# Kế hoạch deploy VPS mới — CORS Manager

- Ngày kiểm tra: 2026-11-03
- VPS: `43.240.117.54`, SSH `root@... -p 24700` (key
  `~/.ssh/CS-Linux-20261103230212929.pem`)
- Trạng thái: VPS trắng, chưa cài Docker; **chưa thay đổi gì trên VPS** (chỉ đọc
  thông tin).

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
| 80/443/1508/1509 từ Internet | đóng (chưa có service) |
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
 ├─ 1509/1508 ── gnss caster (public, NTRIP)
 └─ 24700 ── SSH (giới hạn IP nếu có)

Nội bộ Docker:
  server:4000  <── web-prod proxy
  server ── gnss:7080 (HMAC internal)
  server/gnss ── mysql:3306
  migrate (one-shot) ── mysql
  mysql_data volume; backup ra /opt/cors/backups + offsite
```

- `mysql`, `server`, `gnss`, `web-prod`, `caddy` chạy trên network nội bộ.
- Chỉ Caddy (80/443), gnss (1509/1508), SSH (24700) lộ ra ngoài.
- `server` không chạy seed/watch; command `node dist/index.js`.
- `web-prod` chỉ bind nội bộ; Caddy reverse proxy + WebSocket.
- `gnss` publish 1508/1509 trên `0.0.0.0`; 7080 chỉ loopback.

## 4. Chuẩn bị trước khi deploy

### 4.1. DNS / TLS

- Hạ TTL bản ghi `rtktk.online` xuống 300s trước cutover 24–48h.
- Tạo A record `rtktk.online` (và `www` nếu cần) → `43.240.117.54` **tại thời
  điểm cutover**, không trỏ sớm khi chưa có TLS.
- Caddy lấy certificate Let's Encrypt cho domain; email ACME cấu hình trong
  Caddyfile.

### 4.2. Secret và khoá mã hoá

- `APP_ENC_KEY`: **giữ nguyên key hiện tại** để giải mã credential relay/trạm đã
  import; lưu bản offline (password manager/giấy niêm phong). Nếu mất key, toàn
  bộ mật khẩu mã hoá không khôi phục được.
- `APP_ENC_KEY_PREVIOUS`: để trống trừ khi xoay key.
- Tạo mới: `SESSION_SECRET`, mật khẩu MySQL (root/app/migrator/relay), mật khẩu
  seed; không dùng lại mật khẩu dev.
- `.env.production` trên VPS: `chmod 600`, owner deploy; không commit.
- Các biến bắt buộc: `NODE_ENV=production`, `CORS_ORIGIN=https://rtktk.online`,
  `SESSION_COOKIE_SECURE=true`, `MYSQL_HOST=mysql`, `GO_INTERNAL_URL=http://gnss:7080`.

### 4.3. Dữ liệu nguồn

- Dump `cors_admin` + `cors_runtime` từ máy hiện tại (trạng thái cuối:
  1 company/2 user/36 trạm/31 mountpoint/32 mapping/67 relay disabled/3 account).
- Chuyển dump sang VPS qua SCP, kiểm tra SHA256.
- Không chạy `resetLegacyV2`/`importLegacyV2` trên production nếu đã có dump;
  chỉ dùng khi muốn dựng lại từ `db/data`.

## 5. Các pha triển khai

### Pha 0 — Hardening VPS (chưa có dữ liệu)

1. Tạo user `deploy`, copy public key, cấp sudo + group docker (sau khi cài).
2. Tắt `PasswordAuthentication`, `PermitRootLogin prohibit-password`; giữ port
   24700; `sshd -t` trước khi reload.
3. UFW: default deny incoming; allow 24700 (giới hạn IP quản trị nếu có),
   80/443, 1508/1509; IPv6 tương ứng.
4. Cài `fail2ban` (sshd), `unattended-upgrades`, `chrony` (đã có), `htop`,
   `rsync`, `rclone` (nếu backup offsite).
5. Swap 4 GB (`/swapfile`, `vm.swappiness=10`), `sysctl` network cơ bản.
6. Cài Docker Engine + compose plugin từ repo chính thức; bật log rotation
   mặc định; giới hạn `live-restore`.
7. Gate: SSH user deploy OK, root password login bị từ chối, UFW active, swap
   bật, `docker run --rm hello-world` OK.

### Pha 1 — Chuẩn bị mã nguồn & compose production

1. Clone repo vào `/opt/cors/app` (user deploy), checkout commit phát hành.
2. Tạo `docker-compose.prod.yml`:
   - `mysql`: không publish port; `mem_limit 1400m`, buffer pool 768M,
     max_connections 150; volume `mysql_data`; healthcheck.
   - `migrate`: build server image, chạy một lần.
   - `server`: image build từ `server/Dockerfile`, `restart unless-stopped`,
     `mem_limit 700m`, `NODE_ENV=production`, **không** mount source, không seed.
   - `gnss`: build `gnss/`, `700m`, publish `1508:1508`, `1509:1509`,
     `127.0.0.1:7080:7080`; healthcheck.
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
   WebSocket realtime hoạt động; 1508/1509 truy cập từ ngoài (test mock).

### Pha 4 — Backup & monitoring trước cutover

1. Script `/opt/cors/backup.sh`: mysqldump admin+runtime, gzip, sha256, retention
   14 ngày; đẩy offsite (rclone/S3/B2) hằng ngày 02:00.
2. Cron: backup, kiểm tra dung lượng, healthcheck; log rotate.
3. Cảnh báo: disk >80%, RAM >85%, container unhealthy, backup fail (email/webhook
   tùy hạ tầng).
4. Diễn tập restore dump vào MySQL tạm trên VPS; so counts; xoá DB tạm.
5. Gate: backup chạy tay + cron OK; file offsite kiểm tra; restore thử PASS.

### Pha 5 — Cutover

1. Thông báo cửa sổ bảo trì; dừng ghi dữ liệu trên hệ thống cũ (hoặc chấp nhận
   lệch và dump cuối).
2. Dump cuối cùng admin+runtime; chuyển sang VPS; restore; kiểm tra counts lần
   cuối.
3. Đổi DNS `rtktk.online` → 43.240.117.54; chờ TTL; kiểm tra TLS, web, login.
4. Thiết bị kết nối lại 1509/1508 (không đổi cấu hình thiết bị vì cùng domain).
5. Theo dõi sourcetable, log 401/403, chất lượng RTCM, RAM/disk trong 24h.
6. Bật relay theo nhóm sau khi trạm online; bật các job đích 1509/1508 sau cùng.
7. Gate: trạm online đủ, sourcetable đúng, relay không loop, không lỗi auth hàng
   loạt, backup sau cutover có.

### Pha 6 — Ổn định & bàn giao

- Chạy soak 24–48h: RAM, swap, CPU, disk, log, reconnect.
- Chốt tài liệu vận hành: runbook sự cố, lịch backup, quy trình restore, đầu mối.
- Đổi mật khẩu `wally`, xác nhận superadmin, khoá seed/test.
- Gate: 48h không sự cố; backup offsite; tài liệu cập nhật.

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
- Disk 40 GB: image + MySQL + log + backup local 14 ngày; backup offsite bắt buộc.

## 7. Bảo mật

- SSH: chỉ key, user `deploy`, root `prohibit-password`, fail2ban, UFW.
- Docker: không publish MySQL/4000/7080; chỉ Caddy + 1508/1509.
- Web: TLS bắt buộc, HSTS, CSP hiện có, cookie Secure/HttpOnly/SameSite.
- Nguồn trạm no-auth trên 1508/1509 là rủi ro đã chấp nhận: theo dõi nguồn
  trùng, log IP, cân nhắc allowlist IP thiết bị; chiều đọc vẫn bắt buộc account.
- Secret: `.env.production` 600, không log, audit redaction; backup key offline.

## 8. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Mất `APP_ENC_KEY` | Escrow offline trước cutover; không regenerate |
| RAM thấp khi build/relay | Swap 4G, limit service, build tuần tự, theo dõi OOM |
| DNS/TLS chưa sẵn sàng | Hạ TTL, test Host header trước, giữ old system |
| Dữ liệu lệch lúc cutover | Freeze ghi, dump cuối, đối chiếu counts/checksum |
| Rollback mất dữ liệu mới | Chấp nhận cửa sổ ngắn; dump system mới trước khi rollback |
| No-auth bị ghi giả | Giám sát nguồn trùng/IP, allowlist khi xác định được |
| Nhà cung cấp chặn port | Kiểm tra security group/firewall provider trước cutover |

## 9. Rollback

1. Giữ hệ thống cũ nguyên trạng + dump cuối ít nhất 7 ngày.
2. Nếu lỗi sau cutover: đổi DNS về IP cũ; restore dump mới nhất của hệ thống cũ
   nếu đã ghi; thông báo thiết bị.
3. Trên VPS: `docker compose down` (giữ volume), restore dump trước đó nếu cần
   chạy lại; không xoá volume/backup.

## 10. Câu hỏi cần chốt

1. Domain dùng chính `rtktk.online` hay thêm subdomain (vd `cors.rtktk.online`)?
2. Có giới hạn IP quản trị cho SSH 24700 không?
3. Đích backup offsite (S3/B2/VPS khác) và công cụ (rclone)?
4. Có dùng Caddy cho TLS hay bắt buộc nginx + certbot?
5. Cửa sổ cutover dự kiến (ngày/giờ) và thời gian downtime cho phép?
6. Có cần mở 1508/1509 qua cloud firewall/security group của nhà cung cấp không
   (hiện từ ngoài đang đóng)?
7. Giữ root SSH hay chỉ user `deploy` + sudo?
8. Dùng dump DB (khuyến nghị) hay chạy lại import từ `db/data` trên VPS?
