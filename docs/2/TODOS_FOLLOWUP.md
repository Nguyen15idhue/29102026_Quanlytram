# TODOS follow-up (2026-11-03)

Board thực thi kế hoạch `KE_HOACH_FOLLOWUP_2026-11-03`. Cập nhật sau mỗi bước.

Trạng thái: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong · `[!]` lỗi/chặn

## Lô A — Playwright fixtures

- [x] A1. Viết lại `frontend/tests/auth-password-only.spec.ts` thành test đổi mật khẩu thật (`/profile`)
  - Đổi mật khẩu → đăng nhập lại bằng mật khẩu mới → khôi phục mật khẩu cũ;
    chạy 1/1 PASS.
- [x] A2. Thêm fixture `DOCS-Trạm Hậu Lộc` vào `scripts/seed-docs-fixtures.mjs`
  - Thêm trạm `DOCS-Trạm Hậu Lộc` (19.93/105.75), mountpoint `DOCS_HL_RTCM`,
    relay job `DOCS-Relay Hậu Lộc` (disabled); dry-run + `--apply` đã chạy.
- [x] A3. Sửa `frontend/tests/station-source.spec.ts` dùng tên fixture
  - Bỏ phụ thuộc dữ liệu runtime (metrics có thể chưa có); lấy trạm theo tên
    fixture; PASS.
- [x] A4. Chạy seed + 2 spec + toàn suite, ghi bằng chứng
  - Playwright toàn suite: **55/55 PASS** (31 file, 1 worker).
  - Server: **33 file / 160 test PASS**; `tsc --noEmit` PASS.
  - Frontend: `npm run build` PASS; `go build ./...` PASS.
  - Docker: rebuild + restart `server`, `gnss`; cả hai healthy.
- [x] A5. Commit lô A

### Phát sinh trong lô A (đã xử lý)

- `playwright.config.ts` tự nạp `.env.local`, map `SEED_*` → `E2E_*`; admin
  test mặc định `docs.admin` vì mật khẩu `admin` đã lệch `SEED_ADMIN_PASSWORD`.
- Thiếu `company_id` (super_admin không thuộc công ty) ở p1-bulk,
  p1-mountpoint, p1-ntrip-acl, p1-relay-import, p1-station-fix,
  metrics-health → thêm `frontend/tests/support/company.ts` (`pickCompanyId`).
- Số pin/danh sách bị hard-code (map, map-upgrade, unified-map) → tính kỳ vọng
  từ `/api/map/overview`.
- `p1-unicode` hard-code trạm 79 (không còn trong DB) → dùng fixture Hậu Lộc.
- `ui.spec` thiếu chọn công ty khi tạo trạm và assert xoá còn sót text.
- `entity-realtime` bật/tắt trạm và khôi phục trạng thái trước đó.
- Sản phẩm: relay import nhận `company_id`/`owner_web_user_id` trong dòng
  phẳng; resolve/purge `quality_alerts` chuyển sang Go internal API
  (`/internal/quality/resolve`, `/internal/quality/purge-orphans`) vì
  `cors_app` chỉ có SELECT trên `cors_runtime`.

## Lô B — relayDegraded (A+B)

- [x] B1. `systemHealth.ts` gọi Go `/health`, trả `relayDegraded`
  - `goMetric` gọi thêm `/health` (public, không HMAC) song song; trả
    `relayDegraded: true|false|null` + `relayHealthStatus`; degraded → Go metric
    `warn`. Go `/health` luôn phát `relayDegraded` (trước đây chỉ phát khi true).
- [x] B2. `HealthTab` card + `Layout` banner
  - Tách type + hook `frontend/src/lib/useSystemHealth.ts` (query key chung,
    cache 12s); `HealthTab` thêm card "Relay"; `Layout` hiện banner
    `.relay-degraded-banner` cho tài khoản có `system_health.view`, có link mở
    Relay; màu `--warn`, không gradient.
- [x] B3. Test server + test Go, gates build/test FE
  - `server/tests/systemHealth.test.ts` 3 test (degraded / khỏe /
    không đọc được `/health`); `gnss/internal/api/health_test.go` 4 case cho
    `relayDegraded()` (nil, healthy, degraded, manager không hỗ trợ).
  - Playwright `system-health.spec.ts`: 5 card + test banner dựng response
    `relayDegraded: true` (desktop + 390 không tràn, có ảnh), bỏ route thì
    banner biến mất.
  - Gate: server **34 file/163 test PASS**; Go `build`/`vet`/`test ./...` PASS;
    frontend build PASS; Playwright toàn suite **56/56 PASS** (3.3 phút).
- [x] B4. Commit lô B

## Lô C — race + CI

- [x] C1. Chạy `go test -race` bằng Docker, ghi kết quả
  - `docker run --rm -v ".../gnss:/src" -w /src golang:1.24 sh -c "go mod download && go test -race ./..."`
  - Kết quả: tất cả package `ok` (api, caster 16.7s, relay 14.6s, quality,
    probe, ntrip, rtcm, secret, maintenance, nmea, config, proxy); không race.
    Windows không có gcc nên không chạy native được.
- [x] C2. Tạo `.github/workflows/gnss-race.yml`
  - Trigger push `main` + pull request khi `gnss/**` đổi; `setup-go` đọc
    `gnss/go.mod`; chạy `go vet ./...` rồi `go test -race ./...`
    (`CGO_ENABLED=1`, timeout 20 phút, concurrency theo ref).
  - Ghi cách chạy vào `docs/OPS.md` §6.1.
- [x] C3. Commit lô C

## Lô D — AAD read-path

- [x] D1. Go relay store: select credential id + `DecryptRecord`
  - `jobColumns` thêm `IFNULL(j.upstream_credential_id,0)` /
    `IFNULL(j.downstream_credential_id,0)`; `scanJob` giải mã bằng
    `secret.DecryptRecord(payload, key, credentialAAD(id))` với AAD
    `relay_credentials:password_enc:<id>` (id <= 0 → không AAD).
- [x] D2. Go probe store: id + `DecryptRecord`
  - Query thêm `COALESCE(rc.id,0)`; giải mã theo cùng AAD.
- [x] D3. Node ghi AAD cho `relay_credentials` (route + import)
  - `server/src/lib/relayCredentials.ts`: `relayCredentialAad`,
    `encryptRelayPassword`, `upsertRelayCredential` (INSERT
    `password_enc=''` lấy id rồi UPDATE secret v2 trong cùng transaction).
  - `routes/relayJobs.ts` bỏ helper local, dùng lib (6 call site);
    `db/importRelay.ts` dùng `encryptRelayPassword` cho cả 3 nhánh.
- [x] D4. Test Go + Node, gates, rebuild/restart gnss
  - Go: `secret` test cho `DecryptRecord` (v1 + AAD vẫn đọc, v2 đúng AAD,
    v2 sai/thiếu AAD fail); `relay/store_test.go` fake row cho v2 đúng id,
    v1 tương thích, sai id fail.
  - Node: `tests/relayCredentialAad.test.ts` 7 test (AAD, update, insert
    2 bước, giữ password, undefined/null, thiếu password).
  - Sửa lỗi phát hiện khi deploy: `relay/station_source.go` dùng
    `DecryptWithAAD` nên secret v1 của `station_sources` không đọc được
    (station 480 báo "secret authentication failed"); chuyển sang
    `DecryptRecord` → station 480 stream lại bình thường.
  - Smoke thật: tạo credential qua `upsertRelayCredential` trong container
    → DB `v2:0:`, decrypt bằng AAD đúng, đã xoá row test.
  - Gate: server **35 file/170 test PASS**; `tsc --noEmit` PASS;
    Go `build`/`vet`/`test ./...` PASS; Playwright relay (4 test) PASS;
    gnss + server rebuild/restart healthy, `/health` `relayDegraded:false`.
- [x] D5. Commit lô D

## Lô E — rotate-secrets

- [x] E1. Script `server/src/db/rotateSecrets.ts` + npm script + test
  - `npm run rotate:secrets` (mặc định dry-run, `--apply` mới ghi); phạm vi
    `relay_credentials.password_enc` + `station_sources.client_password_enc`;
    đọc v1 bằng key hiện tại, fallback `APP_ENC_KEY_PREVIOUS`; mỗi dòng ghi
    trong transaction rồi đọc lại + giải mã để verify; idempotent (bỏ qua v2).
  - `server/tests/rotateSecrets.test.ts` 4 test (needsRotation, v1→v2 + AAD,
    fallback key cũ, danh sách target).
- [x] E2. Backup + dry-run + `--apply` + verify trên DB dev
  - Backup `cors_admin` (3.065.100 bytes) ra
    `%TEMP%\opencode\db-backup\cors_admin_20261103.sql` (ngoài repo).
  - Dry-run: 5 relay + 1 station source cần rotate. `--apply`: rotate 6/6;
    DB còn `relay_credentials` 5/5 v2, `station_sources` 1/1 v2; chạy lại
    dry-run = 0 cần rotate.
  - Restart `gnss`: healthy, `/health` `relayDegraded:false`, station 480
    stream lại bằng secret v2, không lỗi credential.
- [x] E3. Docs + commit
  - `docs/OPS.md` §6.2 quy trình rotate (thứ tự backup → dry-run → apply →
    verify → restart gnss).

## Đóng đợt

- [x] F1. `SESSION.md`, `TASKS.md`, `docs/2/THUC_HIEN_FIX_LOI.md`
- [x] F2. Push, kiểm tra working tree sạch

## Hotfix sau đợt — bản đồ 403 (2026-11-03)

- [x] Migration admin `037_map_view.sql` thêm permission `map.view`
  (super_admin `all`, admin/user `tenant`), seed + `roleMatrix` cập nhật.
- [x] Test Playwright `unified-map.spec.ts` tải tile thật: fail nếu 403.
- [x] Áp dụng dev: schema admin 37, tile 200; map/unified-map/realtime 7/7
  PASS; server 36 file/174 test PASS.

## Hotfix sau đợt — cache phiên (2026-11-03)

- [x] Tái hiện: đổi superadmin → docs.admin trong cùng tab (SPA) vẫn thấy
  8 trạm của superadmin tới lần refetch 10s.
- [x] `AuthProvider` xoá React Query cache khi phiên đổi
  (bootstrap/login/logout/refresh); `RealtimeProvider` reset snapshot/quality
  khi `user.id` đổi.
- [x] Test Playwright `p1-rbac.spec.ts` yêu cầu danh sách đúng công ty trong
  2s sau khi đổi tài khoản.
