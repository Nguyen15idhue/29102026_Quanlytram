# Vận hành (Phase 5)

## 1. Kiến trúc realtime

- Go giữ metrics RAM; Node poll `GET /internal/snapshot` và
  `GET /internal/caster/connections` mỗi ~1 giây (HMAC nội bộ).
- Node phát Socket.IO tới room `user:<id>`; room `relay:<id>`/`caster` chỉ join
  sau khi kiểm tra quyền + scope.
- Payload đã lọc theo `relay.view`, `connections.view`, `stations.view`,
  `alerts.view` và scope `all/subtree/own`.
- Node không nằm trên đường byte RTCM.
- Socket dùng session cookie `cors_sid`; không dùng JWT/token trên URL.

Sự kiện: `snapshot`, `relay.updated`, `relay.session`, `connection.updated`,
`alert.created`, `auth.revoked`.

## 2. Kiểm tra sức khỏe

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:7080/health
docker compose ps
```

Kỳ vọng: Node `schemaVersion >= 5`, Go `schemaVersion >= 3`, container healthy.

## 3. Log

- Node dùng pino, redact authorization/cookie/password/token.
- Docker json-file log rotation: 10 MB x 3 file cho mysql/server/gnss.
- Xem log:

```bash
docker compose logs --tail=200 server
docker compose logs --tail=200 gnss
```

## 4. Backup / restore MySQL

Backup nằm ngoài repo tại `F:\3.Laptrinh\1. Project\1. GNSS\Backup`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-mysql.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-mysql.ps1 `
  -BackupFile 'F:\3.Laptrinh\1. Project\1. GNSS\Backup\cors-mysql-YYYYMMDD-HHMMSS.sql.zip' -Force
```

- Restore ghi đè `cors_admin` và `cors_runtime`; nên dừng `server`/`gnss` trước.
- Không commit file dump/zip; script chỉ ghi ra thư mục Backup.
- Kiểm chứng: chạy backup, restore, khởi động lại, kiểm tra `/health` và dữ liệu.

## 4.1. Retention & bảo trì

- Cấu hình nằm trong `cors_admin.maintenance_jobs` (11 job) và
  `cors_admin.maintenance_settings` (lịch chạy), không dùng ENV.
- Migration: `034_maintenance.sql`, `042_retention_7d.sql`,
  `043_alerts_created_index.sql`, runtime `009_quality_alerts_last_seen_index.sql`.
- Chính sách Plan 17: dữ liệu chi tiết giữ **7 ngày**; `relay-hourly` giữ 90 ngày,
  `audit-logs` giữ 365 ngày.
- Go dọn `cors_runtime`: `relay_*`, `quality_*`, `caster_connections`,
  `station_source_sessions`, `rtcm_message_stats`.
- Node dọn `cors_admin`: `web_sessions`, `audit_logs`, `alerts`.
- `quality_alerts`: xóa **tất cả** bản ghi cũ hơn 7 ngày, kể cả chưa resolve.
- `alerts` admin: xóa **tất cả** alert cũ hơn 7 ngày, kể cả `open`/chưa ack.
- Vẫn không xóa session/connection đang mở và `relay_job_state`.
- Chạy thử/chạy tay và lịch sử: UI `/system?tab=automation` (P07-5).
- API: `GET/PUT /api/system/maintenance/jobs`, `GET/PUT .../settings`,
  `GET .../runs`, `POST .../run` (`system_ops.view/edit`).
- Scheduler Node chỉ chạy job admin; job runtime do Go chạy theo `interval_sec`.
- Lịch sử chạy: `cors_admin.maintenance_runs`.

## 5. Load test (mock only)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/load-test-mock.ps1 -Jobs 20
```

- Chỉ dùng mock caster trên `127.0.0.1:2102` (host) qua `host.docker.internal`.
- Tạo 20 relay job + 20 mock rover, kiểm tra snapshot `streaming=20/20`.
- Không dùng endpoint thật; không bind `2101`/`8081`.
- Mặc định script soft-delete job sau test; `-Keep` để giữ job/mock cho debug.

## 6. Migration & rebuild

```bash
docker compose build migrate server web
docker compose run --rm migrate
docker compose up -d --force-recreate server web
```

Migration Phase 5: `db/migrations/admin/005_alerts_settings.sql` (admin schema 5).

### 6.1. Test Go và race detector

```bash
cd gnss
go vet ./...
go test ./...
# Windows không có toolchain C: chạy -race trong container (golang:1.24 có gcc)
docker run --rm \
  -v "$PWD:/src" -w /src golang:1.24 \
  sh -c "go mod download && go test -race ./..."
```

- CI: `.github/workflows/gnss-race.yml` chạy `go vet` + `go test -race ./...`
  trên `ubuntu-latest` khi `gnss/**` thay đổi (push `main` hoặc pull request).
- Kết quả dev 2026-11-03: toàn bộ package `ok`, không phát hiện race.

### 6.2. Rotate secret v1 → v2

Chỉ chạy sau khi đã deploy bản đọc được v2 (relay/probe/station-source dùng
`DecryptRecord`) và **đã backup** `cors_admin`.

```bash
docker exec cors-mvp-server-1 npm run build
docker exec cors-mvp-server-1 node dist/db/rotateSecrets.js          # dry-run
docker exec cors-mvp-server-1 node dist/db/rotateSecrets.js --apply  # ghi DB
docker exec cors-mvp-server-1 node dist/db/rotateSecrets.js          # phải còn 0
```

- Phạm vi: `relay_credentials.password_enc` (AAD `relay_credentials:password_enc:<id>`)
  và `station_sources.client_password_enc` (AAD `station_sources:client_password_enc:<station_id>`).
- Đọc v1 bằng `APP_ENC_KEY` hiện tại, fallback `APP_ENC_KEY_PREVIOUS`;
  mỗi dòng ghi lại trong transaction rồi đọc/giải mã để verify.
- Idempotent: chạy lại chỉ rotate dòng chưa phải `v2:`. Sau rotate nên restart
  `gnss` để nạp lại secret đã đổi.

## 7. API Phase 5

- `GET /api/snapshot`: snapshot lọc quyền cho reconnect.
- `GET /api/alerts?status=&severity=&page=&pageSize=`: `alerts.view`.
- `GET /api/alerts/:id`; `POST /api/alerts/:id/ack`: `alerts.ack`, ghi audit.
- `GET /api/history/sessions|events|hourly?jobId=&from=&to=&page=&pageSize=`:
  `relay.view`, đọc runtime, lọc scope.
- Alerts được tạo bởi polling khi relay vào `backoff`/`error` hoặc Go/caster
  không phản hồi; cooldown 5 phút; không auto-disable job.

## 8. Sự cố thường gặp

| Hiện tượng | Kiểm tra |
|---|---|
| Dashboard “Đang kết nối lại” | cookie session, `/health`, log server, proxy `/socket.io` |
| Không thấy dữ liệu realtime | quyền `relay.view`/`connections.view`, scope owner |
| Alert không xuất hiện | trạng thái Go `backoff`/`error`, Go internal API, dedupe 5 phút |
| History trống | runtime retention đã prune, quyền `relay.view`, filter job/from/to |
| Caster không nhận kết nối | listener 1509/1508, ACL NTRIP, `docker compose logs gnss` |

## 9. License

- `socket.io`, `socket.io-client`: MIT.
- Các thư viện Phase 1–4 giữ nguyên; Phase 6 sẽ dùng `go-gnss/rtcm` (Apache-2.0).

## 10. Chuyển dữ liệu hệ thống cũ (legacy)

Nguồn: `db/data` (config.json, caster_stations.json, caster_mountpoints.csv).
Quy trình đã chạy 2026-11-03, có thể lặp lại (idempotent):

```bash
# 0) Backup trước khi xoá (ngoài repo)
docker exec cors-mvp-mysql-1 sh -lc \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --no-tablespaces cors_admin > /tmp/admin.sql'
docker cp cors-mvp-mysql-1:/tmp/admin.sql <backup-dir>/admin.sql

# 1) Copy dữ liệu nguồn vào container
docker cp db/data cors-mvp-server-1:/tmp/legacy-data

# 2) Xoá dữ liệu test, giữ superadmin + listener 1508/1509, tạo WALLY/wally
docker exec cors-mvp-server-1 node dist/db/resetLegacyV2.js            # dry-run
docker exec cors-mvp-server-1 node dist/db/resetLegacyV2.js --apply

# 3) Import trạm/mountpoint/source/account, sau đó relay (disabled)
docker exec cors-mvp-server-1 node dist/db/importLegacyV2.js --data /tmp/legacy-data --apply-core
docker exec cors-mvp-server-1 node dist/db/importLegacyV2.js --data /tmp/legacy-data --apply-relays

# 4) Nạp lại cấu hình caster/relay và kiểm tra
docker compose restart gnss
curl -s http://127.0.0.1:7080/health
```

Lưu ý:

- Runtime xoá bằng user `cors_migrator` (cors_app chỉ SELECT `cors_runtime`).
- Nguồn trạm legacy dùng `caster_requires_auth=0`: publish không cần account,
  nhưng đọc mountpoint vẫn cần NTRIP account + ACL.
- 67 relay import ở trạng thái **disabled**, giữ host/port cũ (`rtktk.online`);
  chỉ bật theo nhóm sau cutover, sau khi trạm online.
- Import idempotent theo `external_key`/tên trạm; chạy lại không tạo trùng.
- Rollback: dừng server/gnss, restore dump `cors_admin` + `cors_runtime` bằng
  root/migrator, sau đó `docker compose restart server gnss`.
