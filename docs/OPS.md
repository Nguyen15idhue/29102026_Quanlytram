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
- Migration: `db/migrations/admin/034_maintenance.sql`.
- Go dọn `cors_runtime`: `relay_*`, `quality_*`, `caster_connections`,
  `station_source_sessions`, `rtcm_message_stats`.
- Node dọn `cors_admin`: `web_sessions`, `audit_logs`, `alerts` (chỉ `acked`).
- Không bao giờ xóa session/connection đang mở, alert `open`,
  `quality_alerts` chưa resolve, `relay_job_state`.
- Chạy thử/chạy tay và lịch sử: UI `/system?tab=automation` (P07-5).
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
