# 02 — CÁC BƯỚC THỰC HIỆN P0

> Ngày lập: 2026-10-31
> Nguồn: `docs/1/01_KE_HOACH_P0_VAN_HANH.md`
> Trạng thái: Hướng dẫn thực hiện; **P0.1–P0.12 chưa hoàn tất**
> Cách dùng: làm tuần tự từ Phase 0; mỗi phase chỉ chuyển tiếp khi checklist
> test PASS hoặc có ghi chú lý do chấp nhận.

## 1. Cách đọc tài liệu

Mỗi phase gồm 5 phần:

1. **Mục tiêu** — kết quả cần có.
2. **Giải thích đơn giản** — vì sao làm việc này.
3. **Việc cần làm** — các bước thao tác.
4. **Yêu cầu cần đạt** — điều kiện nghiệm thu.
5. **Checklist test + ghi chú** — bằng chứng và rủi ro.

Quy ước:

- `[ ]` chưa làm, `[x]` đã PASS, `[!]` có lỗi/chấp nhận tạm.
- Mọi kết quả test ghi vào `SESSION.md` kèm ngày, lệnh, PASS/FAIL.
- Không đánh dấu PASS nếu chưa chạy test thật.
- Không commit secret, credential, DSN hoặc file backup relay.

## 2. Trạng thái hiện tại (2026-10-31)

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Nền tảng Phase 1–11 | Đã có | CRUD, RBAC, relay, caster, quality, realtime, alert, history |
| Import relay cũ | Đã có | `server/src/db/importRelay.ts`; 67 job trong `db/data/config.json` |
| Quét caster 1509/1508 | Đã có dữ liệu | 36 trạm; file trong `db/data/` |
| Probe `hauloc`, `MocChautest` | PASS | 60 giây/mount; không CRC lỗi, không mất epoch |
| P0.1 (chi tiết trạm) | **DONE** | `/stations/:id`, drawer 5 tab, 3 status độc lập, reliability, connections/history/metadata |
| P0.2 (Mountpoint Explorer) | **DONE** | `/mountpoints/explorer`, API list/detail, filter trạm/trạng thái/owner/alert |
| P0.3 (bản đồ hợp nhất) | **DONE** | `/map`, API overview, layer/filter, redirect bản đồ cũ |
| P0.4 (System Health) | **DONE** | `/system/health`, 4 card Node/Host/MySQL/Go, cache 12s, fallback lỗi |
| P0.5–P0.6 (UX vận hành) | **Chưa làm** | Dashboard/alert impact và menu/deep link còn lại |
| P0.7 (import hệ cũ) | **Chưa làm** | Chưa có `importLegacyCaster` |
| P0.8 (HTTPS/domain) | **Chưa làm** | Web đang HTTP `:3000` |
| P0.9 (load test) | **Chưa đủ** | Mới có load test 50 job; cần 67–100 |
| P0.10 (backup ngoài VPS) | **Chưa làm** | Backup còn thủ công, cùng ổ |
| P0.11 (auth password-only) | **Chưa làm** | Caster hiện cần username hoặc tắt auth |
| P0.12 (provision trước) | **Chưa làm** | Chưa tạo đủ mountpoint/account/ACL/listener |

**Kết luận:** hệ thống đủ chạy thử có kiểm soát, **chưa đủ thay thế hệ cũ**.

## 3. Thứ tự phase

| Phase | Nội dung | Phụ thuộc | Kết quả |
|---|---|---|---|
| 0 | Chuẩn bị & baseline | — | Môi trường sạch, test gốc PASS |
| 1 | P0.1 Chi tiết trạm | Phase 0 | `/stations/:id` + drawer 5 tab |
| 2 | P0.2 Mountpoint Explorer | Phase 1 | Truy vết mountpoint |
| 3 | P0.3 Bản đồ hợp nhất | Phase 1 | `/map` + layer + drawer |
| 4 | P0.4 System Health | Phase 0 | `/system/health` |
| 5 | P0.5 Dashboard & alert impact | Phase 1, 4 | Dashboard 4 vùng |
| 6 | P0.6 Menu/route/redirect | Phase 1–5 | Menu 7 nhóm, deep link |
| 7 | Chốt P0 UX + regression | Phase 1–6 | P0 UX PASS |
| 8 | P0.11 Chốt auth đầu vào | Phase 0 | Chọn A/B, code nếu B |
| 9 | P0.7 + P0.12 Provision hệ cũ | Phase 8 | Đủ trạm/mountpoint/account/listener |
| 10 | P0.8 HTTPS/domain | Phase 7 | Web HTTPS, cookie Secure |
| 11 | P0.9 Load test 67–100 job | Phase 9 | Bằng chứng tải |
| 12 | P0.10 Backup/restore/rollback | Phase 9–11 | Diễn tập PASS |
| 13 | Cutover & theo dõi | Tất cả | Go-live có kiểm soát |

---

## Phase 0 — Chuẩn bị và baseline

### Mục tiêu

Có một mốc “trước khi sửa” để biết thay đổi nào làm hỏng hệ thống.

### Giải thích đơn giản

Giống chụp ảnh sức khỏe hiện tại: test nào đang PASS, DB đang có gì, cấu hình
đang ra sao. Nếu sau này lỗi, ta biết lỗi mới hay lỗi cũ.

### Việc cần làm

1. Tạo nhánh làm việc, ví dụ `feat/p0-van-hanh`.
2. Kiểm tra `git status`; không để file secret hoặc `.env.local` trong diff.
3. Backup DB và cấu hình ra ngoài thư mục dự án.
4. Chạy baseline:
   - `cd server && npm test`
   - `cd frontend && npm run build`
   - `cd gnss && go test ./... && go vet ./...`
   - Playwright hiện có (nếu môi trường cho phép).
5. Ghi kết quả baseline vào `SESSION.md`.
6. Chốt tài khoản test, endpoint, cổng tạm; không dùng production nếu chưa được
   phép.

### Yêu cầu cần đạt

- Có backup/restore thử được trước khi đổi dữ liệu.
- Baseline test PASS hoặc danh sách FAIL rõ ràng.
- Không có secret trong `git diff`.

### Checklist test

- [ ] `git status` chỉ có file dự kiến thay đổi.
- [ ] Server test PASS.
- [ ] Frontend build PASS.
- [ ] Go test/vet PASS.
- [ ] Backup mở lại/restore thử thành công.
- [ ] `SESSION.md` ghi mốc baseline.

### Ghi chú

- Không chạy relay/caster cũ nếu chưa xác nhận (AGENTS §5).
- `db/data/config.json` chứa credential relay: **không commit**.

---

## Phase 1 — P0.1: Chi tiết trạm

### Mục tiêu

Mở một trạm bằng URL `/stations/:id`, xem đủ 5 tab: Tổng quan, Kết nối, Chất
lượng, Metadata, Lịch sử.

### Giải thích đơn giản

Hiện mỗi thông tin trạm nằm rải rác. Drawer chi tiết gom lại để trả lời nhanh:
trạm có đang chạy, dữ liệu tốt không, liên quan relay/tài khoản nào, sự cố bắt
đầu từ đâu.

### Việc cần làm

1. Bổ sung API `GET /api/stations/:id/connections`.
2. Bổ sung API `GET /api/stations/:id/history?from=&to=&page=&pageSize=`.
3. Bổ sung API `GET /api/stations/:id/metadata`.
4. Mở rộng `GET /api/stations/:id` với:
   - `transportStatus`, `qualityStatus`, `metadataStatus`.
   - `reliability`: `windowSec`, `sampleCount`, `validSampleCount`,
     `dataCompleteness`, `observationStartedAt`, `scoreUpdatedAt`.
5. Tạo `frontend/src/components/StationDetailDrawer.tsx`.
6. Sửa `frontend/src/pages/Stations.tsx` để mở drawer.
7. Thêm route `/stations/:id`; dùng `useParams`/`useSearchParams`.
8. Giữ filter/page khi đóng drawer.
9. Tái sử dụng `QualityPanel`; thêm block reliability.
10. Ghi rõ nếu chưa có lịch sử probe.

### File/khu vực

- `server/src/routes/stations.ts`
- `server/src/routes/quality.ts` (nếu cần join)
- `frontend/src/App.tsx`
- `frontend/src/pages/Stations.tsx`
- `frontend/src/components/StationDetailDrawer.tsx`
- `frontend/src/types.ts`

### Yêu cầu cần đạt

- `/stations/80` mở đúng trạm, không mở nhầm list.
- 5 tab đúng nội dung, không trùng tab.
- Transport status và quality status độc lập.
- Reliability hiển thị đủ trường.
- Tab Kết nối có mountpoint + relay + desired/applied.
- Tab Lịch sử có ít nhất 2 nguồn dữ liệu thật.
- Đóng drawer quay lại đúng URL/filter.
- RBAC kiểm tra ở server, không chỉ ẩn UI.

### Checklist test

- [x] Server test cho status/reliability.
- [x] Test API connection/history/metadata.
- [x] Playwright mở `/stations/80`, đổi 5 tab.
- [x] Refresh giữ drawer và filter.
- [x] User scope `own` chỉ thấy trạm của mình.
- [x] Không lộ credential/secret trong response.

### Ghi chú

- Không thêm bảng mới trong P0.
- Không tự tính lại score ở frontend.
- Nếu thiếu dữ liệu, hiển thị “chưa có”, không bịa số.

---

## Phase 2 — P0.2: Mountpoint Explorer

### Mục tiêu

Từ một mountpoint, thấy toàn bộ chuỗi: trạm nguồn → relay → listener → tài
khoản ACL → kết nối online → quality/alert.

### Giải thích đơn giản

Mountpoint là “cửa” dữ liệu. Khi cửa có sự cố, cần biết ai đang dùng, relay nào
đang lấy, listener nào đang phục vụ, tài khoản nào bị ảnh hưởng.

### Việc cần làm

1. Thêm `GET /api/mountpoints/explorer?q=&page=&pageSize=`.
2. Thêm `GET /api/mountpoints/:id/explorer`.
3. Join các bảng:
   - `mountpoints`, `stations`.
   - `relay_jobs` theo upstream mount.
   - `caster_listener_mountpoints` + `caster_listeners`.
   - `account_mountpoint_acl` + `ntrip_accounts`.
   - `caster_connections`.
   - `quality_samples`, `rtcm_message_stats`, `quality_alerts`.
4. Trả `sourceState`, `quality`, `bitrateBps`, `messageRate`, `relays`,
   `listeners`, `accounts`, `onlineConnections`, `alertsOpen`.
5. Tạo trang `/mountpoints/explorer`.
6. Bảng + filter theo trạm/trạng thái/owner/có cảnh báo.
7. Nút “Mở trạm”, “Mở relay”, “Mở listener”.
8. Áp dụng RBAC scope cho danh sách và chi tiết.

### File/khu vực

- `server/src/routes/mountpoints.ts`
- `frontend/src/pages/Mountpoints.tsx` hoặc trang mới
- `frontend/src/App.tsx`

### Yêu cầu cần đạt

- Tìm được `THA_HauLoc` (hoặc mountpoint test hiện có).
- Hiển thị đúng relay/listener/account ACL.
- Số online khớp API connections.
- Không lộ hash/mật khẩu.
- Scope `own/subtree` không thấy dữ liệu ngoài quyền.

### Checklist test

- [x] API danh sách phân trang, search debounce.
- [x] API chi tiết join đúng.
- [x] RBAC scope.
- [x] Playwright mở explorer, xem chi tiết.
- [x] So số online với `/api/connections`.
- [x] Không có secret trong JSON.

### Ghi chú

- Nếu một mountpoint không gắn station, hiển thị “chưa gắn trạm”, không suy đoán.
- Alert impact có thể để Phase 5; Explorer chỉ hiển thị số lượng.

---

## Phase 3 — P0.3: Bản đồ vận hành hợp nhất

### Mục tiêu

Một bản đồ `/map` thay cho hai bản đồ cũ, có layer, filter, panel và mở drawer
trạm.

### Giải thích đơn giản

Thay vì mở nhiều màn, người vận hành nhìn một bản đồ để biết trạm nào online,
trạm nào lỗi, trạm nào chưa có toạ độ.

### Việc cần làm

1. Thêm `GET /api/map/overview?layer=&q=&region=&owner=`.
2. Trả item: id, code, name, lat/lon, `has1005`, transport, quality, score,
   sourceType, mountpointCount, relayJobCount, onlineAccounts, region, owner.
3. Tạo route `/map`; hỗ trợ `?station=`, `?layer=`.
4. Redirect:
   - `/stations/map` → `/map?layer=stations`
   - `/online/map` → `/map?layer=online`
5. Layer: tất cả, online, stale/lỗi, có tài khoản online, chưa có 1005, theo
   vùng/owner.
6. Marker màu theo quality/transport; chỉ marker có 1005.
7. Click marker mở panel; nút mở drawer `/stations/:id`.
8. Giữ search/filter trong URL.

### File/khu vực

- `server/src/routes/stations.ts` hoặc route map mới
- `frontend/src/pages/StationMap.tsx`, `OnlineMap.tsx`
- `frontend/src/App.tsx`
- `frontend/src/styles.css`

### Yêu cầu cần đạt

- Redirect cũ đúng.
- Không có marker giả khi thiếu 1005.
- Layer bật/tắt đúng.
- Panel hiển thị trạng thái, quality, mountpoint, relay, online accounts.
- Refresh giữ URL.
- Bản đồ tải ≤ 1000 điểm; filter server-side.

### Checklist test

- [x] API layer/filter trả đúng.
- [x] Playwright kiểm tra redirect, marker, panel, drawer.
- [x] Kiểm tra 1440/768/390.
- [x] Dark mode.
- [x] Không gọi tile/key thương mại; attribution OSM còn nguyên.

### Ghi chú

- Không hiển thị marker nếu chỉ có lat/lon nhập tay mà chưa có 1005/1006.
- Clustering để P1; P0 giới hạn 1000.

---

## Phase 4 — P0.4: System Health

### Mục tiêu

Biết VPS/Node/Go/MySQL có khỏe không trong một màn `/system/health`.

### Giải thích đơn giản

Khi hệ thống chậm, cần biết do CPU/RAM/disk, do Node, do MySQL hay do Go. Không
cần Prometheus; chỉ cần số liệu đủ để quyết định.

### Việc cần làm

1. Thêm `GET /api/system/health`, quyền `settings.view`.
2. Thu thập Node: uptime, CPU, RSS, heap, event-loop lag, socket clients.
3. Thu thập host: CPU count, load, RAM, disk; network nếu có, không có trả null.
4. MySQL: ping, latency, schema version, pool stats.
5. Go: gọi internal API HMAC `/internal/health/metrics`.
6. Cache 10–15 giây; timeout ngắn.
7. Tạo trang `/system/health` với card trạng thái/ngưỡng/cập nhật.
8. Không lộ DSN/secret.

### File/khu vực

- `server/src/routes/` (route health mới)
- `server/src/lib/` (collector)
- `gnss/internal/api/` (metrics nếu thiếu)
- `frontend/src/pages/` + `App.tsx`

### Yêu cầu cần đạt

- API trả đủ metric hoặc null + lý do.
- Go/MySQL down thì card báo lỗi, trang không treo.
- UI refresh 10–15 giây.
- Không ảnh hưởng đường byte RTCM.

### Checklist test

- [x] Test metric null fallback.
- [x] Test Go/MySQL down (mock).
- [x] Test không lộ secret.
- [x] Playwright mở trang, thấy 4 card.
- [x] Refresh không treo.

### Ghi chú

- Host metric khác Windows/Linux; không bịa số.
- Network metric thiếu thì ghi “không hỗ trợ”, không để trống gây hiểu nhầm.

---

## Phase 5 — P0.5: Dashboard vận hành & alert impact

### Mục tiêu

Dashboard trả lời nhanh: có bao nhiêu trạm/mountpoint/relay/online; sự cố nào
đang ảnh hưởng đến ai.

### Giải thích đơn giản

Một màn tổng hợp để biết “hôm nay có gì cần xử lý”, thay vì mở từng menu.

### Việc cần làm

1. Thêm `GET /api/ops/dashboard?window=60`.
2. Thêm `GET /api/alerts?includeImpact=1`.
3. Mapping impact:
   - station alert → station + mountpoints + relay jobs + online accounts.
   - relay alert → relay job + station + accounts.
   - caster/connection alert → listener/mountpoint/station.
4. Dashboard 4 vùng:
   - Tổng quan.
   - Sức khỏe.
   - Sự cố cần xử lý (critical/major trước).
   - Hoạt động gần đây/audit.
5. Nút mở trạm/relay/mountpoint.
6. Hiển thị desired/applied khi liên quan relay.

### File/khu vực

- `server/src/routes/alerts.ts`
- `server/src/routes/` (dashboard mới)
- `frontend/src/pages/Dashboard.tsx`

### Yêu cầu cần đạt

- Số liệu khớp API.
- Alert critical/major đầu tiên.
- Click sự cố mở đúng đối tượng.
- Không auto-disable job/probe.

### Checklist test

- [ ] Test impact counts.
- [ ] Test desired/applied.
- [ ] Playwright 4 vùng + click alert.
- [ ] So số với API.
- [ ] RBAC scope.

### Ghi chú

- Không thêm notification center trong P0.
- Nếu impact không xác định, ghi “chưa xác định”, không đoán.

---

## Phase 6 — P0.6: Menu, route và deep link

### Mục tiêu

Menu 7 nhóm gọn, chỉ mục có route; deep link mở đúng màn.

### Giải thích đơn giản

Menu là bản đồ điều hướng. Nếu mục không có trang thì không hiện, tránh bấm vào
trang trống.

### Việc cần làm

1. Cập nhật `frontend/src/components/Layout.tsx`.
2. Cập nhật `frontend/src/App.tsx`.
3. Thêm redirect route cũ.
4. Title topbar theo route.
5. Active menu đúng cho `/stations/:id`, `/map?station=`.
6. Mobile drawer hoạt động.

### Yêu cầu cần đạt

- Menu 7 nhóm; không mục rỗng.
- Deep link `/stations/80`, `/map?station=80` hoạt động.
- Refresh giữ filter/page.
- 390/768/1440 không tràn.
- Keyboard/focus hoạt động.

### Checklist test

- [ ] Playwright responsive 3 kích thước.
- [ ] Kiểm tra redirect cũ.
- [ ] Kiểm tra active menu.
- [ ] Kiểm tra Esc/focus drawer.
- [ ] Dark mode.

### Ghi chú

- Không thêm menu Chất lượng/Báo cáo/Cấu hình ở P0 nếu chưa có route.

---

## Phase 7 — Chốt P0 UX và regression

### Mục tiêu

Xác nhận P0.1–P0.6 chạy đúng trước khi chuyển sang migrate.

### Việc cần làm

1. Chạy toàn bộ server test, Go test/vet, frontend build.
2. Chạy Playwright `ops-p0.spec.ts` và toàn bộ test cũ.
3. Kiểm tra 1440/768/390, light/dark.
4. Kiểm tra RBAC ở server cho từng API mới.
5. Cập nhật `SESSION.md` + `TASKS.md`.
6. Chụp ảnh/ghi log bằng chứng.

### Yêu cầu cần đạt

- Không còn FAIL chưa xử lý.
- Không secret trong diff/log.
- Các API mới có test.
- Responsive/a11y đạt.

### Checklist test

- [ ] `cd server && npm test`
- [ ] `cd frontend && npm run build`
- [ ] `cd gnss && go test ./... && go vet ./...`
- [ ] Playwright toàn bộ.
- [ ] `docker compose up -d --build server web gnss`
- [ ] Health Node/Go OK.
- [ ] `SESSION.md` cập nhật.

### Ghi chú

- Nếu Playwright không chạy được, ghi rõ lý do; không thay bằng unit test.

---

## Phase 8 — P0.11: Chốt cơ chế auth đầu vào

### Mục tiêu

Quyết định cách hệ mới nhận thiết bị cũ vốn **chỉ có password, không username**.

### Giải thích đơn giản

Hệ cũ cho kết nối khi biết mật khẩu. Hệ mới dùng Basic auth cần username. Nếu
không chọn cách tương thích, thiết bị cũ sẽ không publish được.

### Việc cần làm

1. Chốt phương án:
   - **A**: tạo username tổng hợp `stn_<MãTrạm>`, cập nhật thiết bị.
   - **B**: thêm `auth_mode = password_only` theo mountpoint.
2. Nếu chọn B:
   - Migration `mountpoints.auth_mode` + `password_hash`.
   - Go caster: username rỗng vẫn kiểm tra password theo mountpoint.
   - API/UI: nhập/đổi password, không trả hash.
   - Audit redaction.
3. Nếu chọn A:
   - Quy ước username, tạo account, cập nhật thiết bị.
   - Ghi rõ thiết bị nào đã đổi.
4. Test SOURCE/POST/rover v1/v2.

### Yêu cầu cần đạt

- Đúng password → nhận; sai password → 401.
- Username rỗng hoạt động nếu chọn B.
- Không lộ hash/password.
- Audit ghi nhận thay đổi credential.
- Không dùng `requires_auth=0` cho production.

### Checklist test

- [ ] Test đúng/sai password.
- [ ] Test username rỗng (B).
- [ ] Test ACL/max connection.
- [ ] Test rover.
- [ ] Test SOURCE/POST v1/v2.
- [ ] Test audit không lộ secret.
- [ ] Migration rollback/fail-fast.

### Ghi chú

- Nếu chưa chốt được, dừng tại đây; không migrate credential bằng cách đoán.
- Password cũ chỉ chuyển được nếu có plaintext hoặc đặt lại.

---

## Phase 9 — P0.7 + P0.12: Provision hệ thống cũ

### Mục tiêu

Tạo đủ trạm, mountpoint, tài khoản, ACL và listener cho danh sách cũ; test trước
khi cutover.

### Giải thích đơn giản

Hệ mới không tự nhận kết nối. Phải “mở cửa” trước cho từng trạm: tạo hồ sơ
trạm, mountpoint cùng tên, tài khoản/ACL, gắn vào listener 1509.

### Việc cần làm

1. Dùng dữ liệu đã quét:
   - `db/data/caster_stations.xlsx`.
   - `db/data/caster_mountpoints.csv`/`.xlsx`.
   - `db/data/caster_scan_summary.md`.
2. Import trạm qua `/api/stations/import` (dry-run trước).
3. Tạo mountpoint cùng tên/mã, gắn `station_id`.
4. Tạo `ntrip_accounts` + `account_mountpoint_acl` (hoặc `password_only`).
5. Gắn mountpoint vào listener 1509 (cổng tạm khi hệ cũ còn chạy).
6. Viết/dùng `server/src/db/importLegacyCaster.ts`:
   - `--dry-run`.
   - Transaction.
   - Idempotent.
   - Audit `import`.
   - Không log secret.
7. Test từng mountpoint: SOURCE/POST + rover + quality.
8. Đối chiếu số lượng.

### Dữ liệu cần đối chiếu

- 36 trạm (gộp case-insensitive; 31 có trong sourcetable, 5 chỉ có trong relay).
- `BG.TP` → station code `BG_TP`; mountpoint vẫn `BG.TP`.
- `TNN_TpThaiNguyen`/`TNN_TPThaiNguyen` đã gộp.
- lat/lon để trống đến khi có 1005/1006.
- 5 trạm relay-only: `DTP_TanHong`, `GLI2`, `HUG_ViThuy`, `PYN_SongHinh`,
  `YBI_NghiaLo`.

### Yêu cầu cần đạt

- Số trạm/mountpoint/account/listener khớp báo cáo.
- Rover auth thành công từng mountpoint.
- ACL/max connection đúng.
- Không lộ credential.
- Có audit import.
- Không tạo mountpoint trùng/không gắn station ngoài ý muốn.

### Checklist test

- [ ] Dry-run import trạm: 0 lỗi.
- [ ] Import thật: created/updated đúng.
- [ ] Đếm mountpoint theo port khớp.
- [ ] Test SOURCE/POST từng mountpoint.
- [ ] Test rover đúng/sai quyền.
- [ ] Quality snapshot > 0.
- [ ] Không secret trong log.

### Ghi chú

- `caster_stations.xlsx` chỉ tạo **station**, không tạo mountpoint/account.
- Sourcetable động: quét lại ngay trước cutover.
- Không dùng dữ liệu cũ để đoán toạ độ; chờ 1005/1006.

---

## Phase 10 — P0.8: HTTPS, domain và reverse proxy

### Mục tiêu

Web chạy `https://rtktk.online`, cookie Secure, WebSocket hoạt động.

### Giải thích đơn giản

Nếu để HTTP, mật khẩu/cookie có thể bị đọc trên đường truyền. HTTPS là điều kiện
bắt buộc trước khi cho người dùng thật đăng nhập.

### Việc cần làm

1. Thêm reverse proxy 80/443 → `web:3000`.
2. Cấp TLS (Let's Encrypt hoặc cert nội bộ).
3. Đặt:
   - `CORS_ORIGIN=https://rtktk.online`
   - `SESSION_COOKIE_SECURE=true`
   - `NODE_ENV=production`
4. Chuyển `X-Forwarded-*`; proxy WebSocket `/socket.io`.
5. Mở firewall 80/443/1509/1508; giữ MySQL/Node/Go nội bộ.
6. Kiểm tra redirect HTTP → HTTPS.

### Yêu cầu cần đạt

- HTTPS 200, certificate hợp lệ.
- Cookie có `Secure`, `HttpOnly`, `SameSite`.
- Socket.IO realtime qua HTTPS.
- Không mixed content.
- Không lộ cổng DB/Node/Go ra Internet.

### Checklist test

- [ ] `curl -I https://rtktk.online`.
- [ ] Đăng nhập, kiểm tra cookie.
- [ ] Realtime cập nhật.
- [ ] Kiểm tra mixed content console.
- [ ] Kiểm tra firewall.
- [ ] Renew cert thử.

### Ghi chú

- Không chạy TLS trong lúc cổng 1509 còn thuộc hệ cũ nếu chưa có cửa sổ.
- Giữ HTTP nội bộ giữa proxy và web.

---

## Phase 11 — P0.9: Load test 67–100 relay job

### Mục tiêu

Chứng minh hệ thống chịu được số job thật, không mất byte, không tràn queue.

### Giải thích đơn giản

Chạy thử nhiều luồng dữ liệu cùng lúc để biết CPU/RAM/queue có đủ không trước
khi chuyển toàn bộ khách hàng.

### Việc cần làm

1. Dùng mock caster/rover; không test tải vào dịch vụ công cộng.
2. Tạo 67–100 job mock, byte-exact.
3. Đo:
   - CPU/RAM Node/Go.
   - p95 latency.
   - queue/backpressure/drop sample.
   - reconnect/restart.
4. Chạy tối thiểu 30 phút; ghi log.
5. So sánh với ngưỡng chấp nhận.

### Yêu cầu cần đạt

- 100% job streaming.
- Không mất byte (đối chiếu hash).
- Không tăng bộ nhớ vô hạn.
- Queue đầy thì drop sample, không chặn RTCM.
- Restart Go không làm hỏng job.

### Checklist test

- [ ] 67 job PASS.
- [ ] 100 job PASS hoặc có giới hạn ghi rõ.
- [ ] Byte-exact.
- [ ] p95 trong ngưỡng.
- [ ] Restart/DB down test.
- [ ] Báo cáo CPU/RAM/queue.

### Ghi chú

- Load test hiện mới 50 job; không dùng kết quả cũ thay cho 67–100.
- Không kết luận “ổn định” nếu chưa chạy đủ thời gian.

---

## Phase 12 — P0.10: Backup, restore và rollback

### Mục tiêu

Có thể khôi phục dữ liệu và quay lại hệ cũ trong thời gian chấp nhận được.

### Giải thích đơn giản

Backup phải nằm ở nơi khác, không cùng ổ với DB. Rollback là “đường lui” khi
cutover thất bại.

### Việc cần làm

1. Lên lịch backup MySQL định kỳ.
2. Copy backup ra ngoài VPS.
3. Mã hoá/giới hạn quyền file backup.
4. Diễn tập restore vào môi trường tạm.
5. Viết runbook rollback:
   - Giữ binary/config/DB cũ.
   - Dừng stack mới/listener 1509.
   - Trả DNS/cổng về hệ cũ.
   - Bật lại relay/caster cũ.
6. Đo thời gian rollback.

### Yêu cầu cần đạt

- Backup tự động, có log.
- Restore thử PASS.
- Rollback < 15 phút hoặc có lý do.
- Không ghi đè dữ liệu cũ khi restore.

### Checklist test

- [ ] Backup chạy theo lịch.
- [ ] File backup ngoài VPS.
- [ ] Restore DB tạm PASS.
- [ ] Rollback diễn tập PASS.
- [ ] Ghi thời gian thực tế.

### Ghi chú

- Không để backup trên cùng ổ.
- Không commit file backup/credential.

---

## Phase 13 — Cutover và theo dõi

### Mục tiêu

Chuyển hệ thống thật sang hệ mới với cửa sổ bảo trì, có kiểm tra và rollback.

### Điều kiện vào cutover

- Phase 1–12 PASS.
- Go/No-Go tại `01_KE_HOACH_P0_VAN_HANH.md` §19.4 đạt.
- Có người phụ trách, cửa sổ thời gian, kênh liên lạc.
- Có xác nhận được phép dừng hệ cũ.

### Việc cần làm

1. Thông báo maintenance.
2. Backup lần cuối.
3. Dừng relay/caster cũ; xác nhận cổng 1509/8081 giải phóng.
4. Chạy migrate idempotent; bật listener 1509.
5. Bật relay theo thứ tự ưu tiên; kiểm tra `applied_revision`,
   `runtime_state=streaming`.
6. Kiểm tra rover/khách hàng, quality, alert, dashboard.
7. Theo dõi 24–48 giờ.

### Yêu cầu cần đạt

- Web HTTPS/đăng nhập/realtime OK.
- Caster nhận SOURCE/POST/rover; ACL đúng.
- 100% job được duyệt streaming; quality có sample.
- Không lộ credential.
- Alert critical = 0 hoặc đã xử lý.
- Backup tự động + restore thử PASS.

### Checklist test

- [ ] Web HTTPS + cookie Secure.
- [ ] Caster 1509 SOURCE/POST/rover.
- [ ] Relay 100% streaming.
- [ ] Quality sample > 0.
- [ ] Alert critical.
- [ ] Backup/restore.
- [ ] Rollback sẵn sàng.

### Ghi chú

- Không tuyên bố hoàn tất ngay sau cutover; chờ đủ 24–48 giờ.
- Nếu rover không kết nối, relay mất byte hàng loạt hoặc quality critical →
  kích hoạt rollback.

---

## 4. Tổng hợp checklist trước Go-live

### Kỹ thuật

- [ ] P0.1–P0.6 PASS.
- [ ] Server test PASS.
- [ ] Frontend build PASS.
- [ ] Go test/vet PASS.
- [ ] Playwright toàn bộ PASS.
- [ ] Load test ≥ 67 job byte-exact.
- [ ] Restart/DB down test PASS.
- [ ] HTTPS/cookie Secure.
- [ ] Backup ngoài VPS + restore thử.
- [ ] Rollback < 15 phút.

### Dữ liệu

- [ ] 36 trạm đã đối chiếu.
- [ ] Mountpoint/account/ACL/listener đủ.
- [ ] Không trùng code/mountpoint.
- [ ] lat/lon chỉ lấy từ 1005/1006.
- [ ] Không lộ credential trong log/DB dump/audit.

### Vận hành

- [ ] Có runbook cutover/rollback.
- [ ] Có người trực 24–48 giờ.
- [ ] Có kênh thông báo.
- [ ] Có báo cáo PASS/FAIL và issue còn lại.
- [ ] `SESSION.md` + `TASKS.md` cập nhật.

## 5. Ghi chú chung

- Không thêm Redis/Kafka/RabbitMQ/K8s.
- Không đổi stack đã chốt.
- Không sửa backup relay.
- Mock-first trước khi test thật.
- Không commit secret; `db/data/config.json` là dữ liệu nhạy cảm.
- Nếu tài liệu này mâu thuẫn với `docs/0` hoặc `01_KE_HOACH_P0_VAN_HANH.md`,
  tài liệu gốc thắng.

## 6. Nhật ký thực hiện

### Phase 1 — P0.1: Chi tiết trạm (2026-10-31)

- Trạng thái: **DONE**.
- Backend:
  - Thêm `server/src/lib/stationDetail.ts` (transport/quality/metadata status,
    reliability, kiểm tra 1005/ARP).
  - Mở rộng `GET /api/stations/:id` với 3 status độc lập và `reliability`.
  - Thêm `GET /api/stations/:id/connections`,
    `GET /api/stations/:id/history`, `GET /api/stations/:id/metadata`.
  - Lịch sử gộp quality/caster/relay/audit; tách truy vấn admin/runtime để
    không join chéo schema.
- Frontend:
  - Thêm `StationDetailDrawer.tsx` 5 tab; Reliability block; deep link
    `/stations/:id?tab=...`; giữ `page/pageSize/q` khi đóng.
  - Thêm type station detail/connections/history/metadata và CSS responsive;
    sửa `.modal-body` để grid không bị co rút, vẫn cuộn đúng với drawer cao.
  - Tab lịch sử có lọc 24h/7d/30d, phân trang, hiển thị nguồn thật.
- Kiểm thử:
  - `server npm run build`: PASS.
  - `server npm test`: 41/41 PASS (trong đó 6 test stationDetail).
  - `frontend npm run build`: PASS.
  - Playwright `station-detail.spec.ts`: PASS — deep link, 5 tab, refresh,
    giữ filter, mobile 390 không tràn.
  - Playwright `quality.spec.ts`: PASS.
  - API smoke trạm 79/80: transport online, quality good, metadata ok,
    connection/history/metadata 200.
  - RBAC `user1`: chỉ thấy `TEST_HNI_02`; trạm 80 trả 404.
- Ghi chú: lịch sử probe chưa có bảng nên API trả `available=false` và UI ghi
  rõ "chưa lưu lịch sử probe"; không bịa dữ liệu.
- Commit: `079abb2` — `feat(p0): chi tiết trạm 5 tab và API vận hành`.

### Phase 2 — P0.2: Mountpoint Explorer (2026-10-31)

- Trạng thái: **DONE**.
- Backend:
  - Thêm `GET /api/mountpoints/explorer` (search, `stationId`, `state`,
    `ownerId`, `alerts=1`, phân trang) và `GET /api/mountpoints/:id/explorer`.
  - Join trạm, relay job + state, listener, ACL tài khoản, kết nối Go,
    quality, message stats, alert mở; chỉ trả `username`, không trả hash.
  - Thêm helper `mountpointSourceState` và test đơn vị.
- Frontend:
  - Thêm `/mountpoints/explorer`, menu riêng, bảng + filter, drawer chuỗi đầy
    đủ; nút mở trạm/relay/listener; RelayJobs nhận deep link `?job=`.
- Kiểm thử:
  - `server npm run build`: PASS; `server npm test`: 45/45 PASS.
  - `frontend npm run build`: PASS.
  - Playwright `mountpoint-explorer.spec.ts`: PASS — search THA, detail,
    filter online, mobile 390 không tràn; regression Phase 1/quality PASS.
  - API smoke: THA_HauLoc online, 1 relay, online khớp
    `/api/stations/80/connections` (0); filter online trả 2 mountpoint.
  - Test tạm listener/ACL mountpoint 67: API trả đúng listener/account, không
    có `password_hash`; đã xoá dữ liệu tạm.
  - RBAC `user1`: chỉ thấy `TEST_HNI_02`; mountpoint 67 trả 404.
- Commit: `77cd2f4` — `feat(p0): mountpoint explorer day du chuoi van hanh`.

### Phase 3 — P0.3: Bản đồ vận hành hợp nhất (2026-10-31)

- Trạng thái: **DONE**.
- Backend:
  - Thêm `GET /api/map/overview?layer=&q=&region=&owner=`; scope RBAC theo
    trạm, giới hạn 1000 điểm.
  - Trả `has1005`, transport/quality/score, sourceType, mountpoint/relay,
    onlineAccounts, vùng/owner; transport ưu tiên live quality từ Go.
  - Layer: `stations`, `online`, `issues`, `online_accounts`, `missing_1005`.
- Frontend:
  - Thêm `/map` (Leaflet + OSM, marker chỉ khi có 1005), search/layer/vùng/
    owner lưu URL, panel chi tiết và nút mở `/stations/:id`.
  - `/stations/map` → `/map?layer=stations`; `/online/map` →
    `/map?layer=online`; menu còn một mục “Bản đồ vận hành”.
- Kiểm thử:
  - `server npm run build` PASS; `server npm test` 45/45 PASS.
  - `frontend npm run build` PASS.
  - Playwright `unified-map.spec.ts` PASS — redirect, 3 marker có 1005, panel,
    drawer, dark mode, 1440/768/390 không tràn, attribution OSM.
  - API: THA_HauLoc online/score 84/source relay_caster; layer online = 2;
    missing_1005 = 2; `user1` chỉ thấy `TEST_HNI_02`.
- Ghi chú: marker chỉ dùng toạ độ 1005/1006; không dùng lat/lon nhập tay.
- Commit: `1d6b62b` — `feat(p0): ban do van hanh hop nhat`.

### Phase 4 — P0.4: System Health (2026-10-31)

- Trạng thái: **DONE**.
- Backend:
  - Thêm `GET /api/system/health` quyền `settings.view`, cache 12 giây,
    timeout 2–2,5 giây; không trả DSN/secret.
  - Thu thập Node (uptime, CPU, RSS/heap, event-loop lag, socket clients),
    host (CPU/load/RAM/disk/network fallback), MySQL (ping, schema, pool),
    Go internal (quality health, relay, caster listener/connection).
  - Thêm `healthStatus` threshold và test đơn vị.
- Frontend:
  - Thêm `/system/health` với 4 card, ngưỡng cảnh báo, trạng thái tổng,
    thời điểm cập nhật, tự refresh 12 giây; menu Hệ thống.
- Kiểm thử:
  - `server npm run build` PASS; `server npm test` 48/48 PASS.
  - `frontend npm run build` PASS.
  - Playwright `system-health.spec.ts` PASS — 4 card, fallback network, refresh,
    dark mode, mobile 390 không tràn.
  - API thật: Node/Host/MySQL/Go trả metric; network ghi “không hỗ trợ”;
    relay 2, caster 0, quality targets 6; không lộ secret.
  - Mock Go down (`GO_INTERNAL_URL` sai): overall/error, Go error, MySQL ok.
  - Mock MySQL down (`MYSQL_PORT` sai): overall/error, MySQL error, Go ok.
- Commit: sẽ ghi hash sau khi commit phase này.
