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

- [ ] D1. Go relay store: select credential id + `DecryptWithAAD`
- [ ] D2. Go probe store: id + `DecryptWithAAD`
- [ ] D3. Node ghi AAD cho `relay_credentials` (route + import)
- [ ] D4. Test Go + Node, gates, rebuild/restart gnss
- [ ] D5. Commit lô D

## Lô E — rotate-secrets

- [ ] E1. Script `server/src/db/rotateSecrets.ts` + npm script + test
- [ ] E2. Backup + dry-run + `--apply` + verify trên DB dev
- [ ] E3. Docs + commit

## Đóng đợt

- [ ] F1. `SESSION.md`, `TASKS.md`, `docs/2/THUC_HIEN_FIX_LOI.md`
- [ ] F2. Push, kiểm tra working tree sạch
