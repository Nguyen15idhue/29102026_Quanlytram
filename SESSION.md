# SESSION.md

## 1. Thông tin phiên

- Thời điểm: 2026-11-01 09:27 (Asia/Ho_Chi_Minh, +07:00)
- 2026-11-04: listener mặc định đổi sang **2101** (migration admin 039, copy owner/mountpoint từ 1509; form listener và form trạm mặc định 2101; dev publish 2101). Listener đang bật **không xóa được**: API single trả 409 `LISTENER_ENABLED`, bulk bỏ qua + `skipped`, UI disable nút xóa từng dòng và nút Xóa bulk khi selection có listener bật. Server test 191/191 PASS, Go test PASS, FE build PASS; API 409/bulk skipped PASS; UI default 2101 + nút xóa disabled PASS. Lưu ý: container server test 2 FAIL do thiếu mount `/db/data` (không phải lỗi code); docs lịch sử còn ghi 2101 bị cấm.
- Cutover kỹ thuật 2026-11-04: DNS trỏ VPS; Caddy production active; HTTPS 200 không -k; cert Let's Encrypt CN=YE1 hạn 2027-02-02; `/health` 200.
- Dữ liệu 5 phút 2026-11-04: 10/10 trạm streaming (BDH1, GLI1, HBH_TpHoaBinh, QBH_LeThuy, SLA_MocChau, SLA_TPSONLA, YBI_LucYen, YBI_TramTau, YBI_VanYen, BKN_BaBe); mỗi trạm tăng ~1.325 frame, 191–313 KB; CRC=0, score=100, ageMs < 700.
- Fix caster 2026-11-04: thiết bị gửi `SOURCE 123456 BDH1` (NTRIP v1 legacy, password + mountpoint, không `/`); parser cũ trả 404. Sửa `gnss/internal/caster/request.go`, test legacy PASS; deploy image mới, 15 source connection online.
- Cutover trạm BLOCKED 2026-11-04: caster mới 0 source connection; caster cũ `103.166.183.250:1509` vẫn trả 5 STR (`LCI_BaoHa,TQG_HamYen,QNH_DongTrieu,YBI_MuCangChai,BKN_NARI`). Thiết bị vẫn nối IP cũ; cần đổi host thiết bị sang `43.240.117.54` hoặc dừng caster cũ. Chưa thể đạt 3/10 trạm/relay.
- Deploy VPS bước 8 PASS 2026-11-04: runbook cutover + hướng dẫn OneDash firewall trong docs/3; stack VPS staging sẵn sàng, không đổi DNS/cutover; readiness: 5 service healthy, schema 41/7, public ports OK.
- Deploy VPS bước 7 PASS 2026-11-04: smoke 15 phút source 269.760B / rover 269.370B, health OK, RAM ~1.76GB, disk 31%, restart server/gnss/caddy/web = 0; CHECK TABLE 11 bảng OK, orphan/cross-company/relay enabled = 0; xoá account smoke + clear runtime test; counts cuối 1/2/36/31/3/58/3/67.
- Deploy VPS bước 6 PASS 2026-11-04: `/opt/cors/backup.sh` + cron 02:15 retention 14 ngày; dump SHA256 OK; restore drill sang MySQL tạm PASS counts 1/2/36/31/3/58/3/67 schema 41/7; không snapshot.
- Deploy VPS bước 5 PASS 2026-11-04: 5 service healthy; Caddy staging HTTPS/API/JS asset OK; WebSocket 101; public NTRIP 1508=6, 1509=26, 2101=26; custom 1510 tạo/test 1 STR rồi xóa; data anonymous 401; không lỗi log.
- Deploy VPS bước 4 PASS 2026-11-04: restore dump OK; counts 1 company/2 user/36 station/31 MP/3 listener/58 mapping/3 account/67 relay; schema 41/7; login superadmin/wally 200; API stations 36, relay 67; gnss health OK; sourcetable 1508=6, 1509=26, 2101=26; data anonymous 401.
- Deploy VPS bước 3 PASS 2026-11-04: clone `/opt/cors/app` @ `4dd3d78`; compose prod + Caddy prod/staging; `.env.production` 600; build `cors-server:prod`, `cors-web:prod`, load `cors-gnss:prod`; compose config + Caddy validate OK.
- Deploy VPS bước 2 PASS 2026-11-04: user `deploy` SSH/sudo/docker OK; Docker 29.9.3 + Compose 5.7.0; swap 4 GB; fail2ban active; UFW/OneDash firewall tắt theo yêu cầu; hướng dẫn OneDash đã thêm docs/3 mục 12.
- Deploy VPS bước 1 PASS 2026-11-04: backup DB, xoá demo (`admin`, 1599, 3 trạm, 3 MP, 5 account, Metrics relay, runtime test); DB còn 1 company/2 user/36 trạm/31 MP/3 listener/58 mapping/3 account/67 relay, schema 41/7; dump `cors-prod.sql.gz` SHA256 `DB6C...5406` đã SCP `/root/cors-prod.sql.gz` trên VPS.
- 2026-11-04: cập nhật `docs/3/KE_HOACH_DEPLOY_VPS_2026-11-03.md` lên schema admin 41/runtime 7; production chỉ giữ Wally (36 trạm/31 mountpoint/3 listener 1508/1509/2101/3 account/67 relay), xoá toàn bộ demo `admin`, 1599, Trạm test, seed/test account, Metrics Relay; chưa tạo script cleanup.
- P15 DONE (2026-11-04): listener theo công ty. Migration 040 thêm `company_id`, gán 1508/1509/2101 cho WALLY, dọn 3 mapping/ACL chéo company; listener demo 1599 cho company admin. Migration 041 đặt `caster.view=tenant` cho admin/user. API/Go: validate port Wally + dải 1510–1599, mountpoint/ACL cùng company, Go check company khi authorize, sourcetable public trả đủ mountpoint (anonymous 2101 = 26 STR), data anonymous vẫn 401. Docker publish 1510–1599; UI có company filter/form, user chỉ xem company. Server 192/192 PASS, Go test/vet PASS, FE build PASS; Playwright `caster-company` 3/3, `p1-mountpoint`/`p1-ntrip-acl`/`p1-station-fix`/`p1-rbac user` PASS. Đã seed DOCS fixture để chạy `company/p1-rbac/p1-bulk/station-source` 10/10 PASS, sau đó reset DOCS; DB cuối vẫn 3 port Wally + 1599 admin, 0 mapping/ACL/source chéo company.
- Kế hoạch 09 lập: `docs/1/09_KE_HOACH_TIMELINE_TRANG_THAI.md` — no_data theo frame/60s (`xx` mặc định 10), offline theo kết nối/service/tắt-khoá, `system_down` vs `source_lost`, rolling 30d, `none` hiển thị mọi khung; chưa triển khai code.
- P09 Phase 0 PASS: baseline `scripts/verify-timeline.ps1` tái hiện 24h/7d/30d `online` lúc 00:30/04:00 (downtime), độ phủ segment 72.371s < khung; server tsc PASS, vitest 89/90 (FAIL stationDetail.test:19 do WIP), frontend tsc PASS.
- WIP timeline lần trước được làm lại trong P09; không giữ kết luận 90/90 cũ vì semantics đã đổi.
- P09 Phase 1 PASS: `statusTimeline` mới dùng frame/60s (`timeline.minFramesPerWindow`, mặc định 10), `offline` khi không kết nối, `no_data` khi kết nối nhưng frame thấp, bỏ nối gap >120s, `segments` gồm `none`; server tsc PASS, vitest 92/92.
- P09 Phase 2 PASS: migration runtime 007 `service_runs`; Go lifecycle heartbeat/start/stop; Node `serviceDowntime` + reason `system_down`; Go test/vet PASS, server 97/97 PASS; fixture ca 02/11 cho kết quả 00:30/04:00 offline system_down, 08:20 online, 4 khung PASS.
- P09 Phase 3 PASS: API timeline trả `asOf`, `resolutionSec`, `segments` gồm `none`, `currentReason`, `offlineReasons`; frontend types cập nhật; server 98/98 PASS.
- P09 Phase 4 PASS: UI `none` nền xám ở 4 khung, nhãn `30 ngày`, reason trong tooltip/dòng, footer `resolutionSec`+`asOf`; frontend build PASS; Playwright timeline 3/3 PASS (1440/768/390), ảnh `frontend/test-results/p09-timeline-*.png`.
- P09 Phase 5 PASS: server 102/102 + tsc, frontend build, Go test/vet, Playwright timeline + station-detail 4/4; `verify-timeline.ps1` 4 khung PASS (00:30/04:00 offline system_down, 08:20 online); migration runtime 007 đã áp dụng; `docker compose up -d --build gnss` DONE, log `[lifecycle] go started`, `service_runs` run 3 heartbeat cập nhật.
- Kế hoạch 08 lập xong: `docs/1/08_KE_HOACH_TRANG_HUONG_DAN.md` (Docusaurus build-time + Playwright capture + 12 chương; trang `/guide`, menu "Hướng dẫn" giữa Relay và Hệ thống).
- P08-0 DONE: baseline server 88/88 (14 file), frontend build PASS, navigation 1/1 PASS; compose healthy; không sửa mã nguồn.
- P08-1 DONE: `docs-site/` Docusaurus 3.10.2 (baseUrl `/guide/`, locale vi, search local), 2 chương mẫu; build PASS, serve HTTP 200.
- P08-2 DONE: route `/guide` + iframe, nhóm menu "Hướng dẫn" giữa Relay và Hệ thống, `build-guide.mjs`, nginx `/guide/`; nav 1/1 PASS, FE build PASS.
- P08-3 DONE: seed DOCS Demo (3 trạm/4 MP/2 listener/2 account/2 relay/3 alert) idempotent; reset PS UTF-8 BOM; 23 ảnh + inventory, 2 lần chụp hash giống nhau.
- P08-4 DONE: 13 chương nội dung tiếng Việt, 22 ảnh; check 13/13 chương + 19/19 route; Docusaurus build PASS, guide 7.5 MB.
- P08-5 DONE: guide.spec G1–G8 8/8, nav 1/1, build PASS, 768/390 không tràn; Vite phục vụ `/guide/` đúng (hết lỗi hydration #423). Known issue ngoài P08: p1-rbac (mật khẩu `admin` lệch env), full suite 12 lỗi có sẵn, server stationDetail 1 lỗi.
- P08-6 DONE: README/AGENTS/TASKS cập nhật; `graphify update .` → 3846 nodes / 8755 edges / 284 communities; toàn bộ P08-0..P08-6 đã commit + push.
- P10-0 DONE: baseline server 102/102, server build PASS, Go test/vet PASS, FE build PASS; kế hoạch 10 đã vào `TASKS.md` 9.4.
- P10-1 DONE: `relayState.ts` + 12 test ma trận; server 114/114, build PASS.
- P10-2 DONE: guard single/bulk/PATCH/import, reconcile trả trạng thái, list trả `relayState`/`allowedActions`; server 116/116.
- P10-3 DONE: Go nạp job khóa/trạm tắt với `Enabled=false` → lý do `disabled`; 4 test mới, `go test ./...` + vet PASS.
- P10-4 DONE: migration 035 (2 CHECK bất biến), admin version 35, 0 vi phạm; phải build lại image `migrate`.
- P10-5 DONE: nút khóa/mở khóa từng dòng, badge `offline` khi khóa, bulk lọc target; FE build PASS, 1440/390 PASS.
- P10-6 DONE: `relay-state.spec.ts` 3/3, Playwright tổng 12/12, guide 8/8; go test/vet + server 116/116; graphify 4019 nodes / 9136 edges; kế hoạch 10 hoàn tất.
- Tài liệu phân quyền đầy đủ: `docs/2/PHAN_QUYEN.md` (RBAC, company, scope, UI, realtime, audit, checklist test)
- Kế hoạch 06 P06-0 DONE: tile providers reachable từ server + browser; chốt `tileMode=proxy`; Geoapify forward/reverse OK (không in key); fixture 480 (1005), 481 (lat/lon dự phòng), 482 (không toạ độ); backup `cors-mysql-20261101-190927.sql.zip`
- Kế hoạch 06 P06-1 DONE: tile proxy (allowlist/cache/fallback), `GET/PUT/test /api/map/config`, overview `coordSource` + filter + field-level gate + `layersAvailable`; frontend `useMapConfig`/`MapCanvas`/`TileErrorBanner`; form trạm có “Vĩ độ/Kinh độ dự phòng”; server 71/71, FE build, Playwright smoke PASS
- Kế hoạch 06 P06-2 DONE: MapFilterPanel + URL state + fit/flyTo + legend + 3 mode; `GET /api/geo/search` (Geoapify forward, cache/timeout/không key fallback); AddressSearch debounce 300ms + AbortController; xoá `StationMap.tsx`/`OnlineMap.tsx`; Playwright `map-upgrade.spec.ts` 2/2, FE build, server 71/71
- Kế hoạch 06 P06-3 DONE: `settings['map.config']`; GET sanitized, PUT/test `settings.edit`+super (admin/user 403), audit `map_config` redacted; trang `/system/map-config` + menu theo `can('settings','edit')`; test kết nối 3 provider OK; Playwright `map-config.spec.ts` 2/2; FE build, server 71/71
- Kế hoạch 06 P06-4 DONE: server tsc/test 71/71/build; FE tsc/build; Go test/vet; Playwright 15/15 (map-upgrade, unified-map, map, map-config, navigation, dashboard, p1-dashboard, station-detail, p1-station, p1-rbac); tile/geo/config/RBAC/company-lock; form trạm super có ô Công ty + toạ độ dự phòng; graphify update `3233 nodes / 7698 edges / 244 communities`
- Kế hoạch 06 P06-5 DONE một phần: P06-5.0 baseline PASS + commit `ee402e5`; P06-5.1 bỏ panel trái thường trực, thêm `MapToolbar` icon rail, overlay filter/list/legend/layers/modes, map full-bleed; smoke desktop 1440 + mobile 390 PASS, tsc/build PASS. P06-5.2 DONE (popover/sheet filter, Esc/click ngoài/focus trả, legend ẩn khi panel mở, MapSearchBox gộp trạm+địa chỉ, layer/mode popover, badge, RBAC option; smoke 3/3). P06-5.3 DONE (StationListDrawer desktop/mobile, list+summary, marker không tự mở drawer, deep link ?station mở drawer, fit/reset giữ mode; smoke 2/2). P06-5.4a DONE: trạng thái tài khoản theo GGA (single/fixed/float/rtd/error), Go parse GGA + internal snapshot, Node `accountStatus`/`connectedAccounts`, marker trạm chấm tròn + tài khoản pin hình người, legend 2 phần, popup tài khoản; test 5 fixture PASS, ảnh `test-results/p06-account-status-*.png`; đã dọn fixture. P06-5.4 còn full regression khi session Hệ thống xong
- Kế hoạch 05: P05-1 DONE (backup `cors-mysql-20261101-165655.sql.zip`; migration 028–030; 1 company `admin`, user admin/user1/user2 có company_id; báo cáo backfill 247 dòng cho tài nguyên owner super/null)
- Kế hoạch 05: P05-2 DONE (tenant=company, peer admin, listener global; migration 031–032; server 61/61)
- Kế hoạch 05: P05-3 DONE (companies API, company/owner response, filter super, audit company; API integration 37/37)
- Kế hoạch 05: P05-4 DONE (trang Công ty, cột/filter, drawer company/owner, form user super; Playwright 2/2; frontend build PASS)
- Kế hoạch 05: P05-5 DONE (migration 028–033; server 61/61; frontend build; Go test/vet; Playwright 6/6; graphify 2983 nodes)
- Kế hoạch 05: follow-up UI chọn company trong form tạo trạm/relay/mountpoint/NTRIP; tài nguyên legacy super/null company chờ super xử lý
- Phase hiện tại: P05-5 test matrix và rollout
- Kế hoạch 04: Bước 1 DONE (backup/restore PASS, baseline 40 trạm/39 mountpoint/2 account/2 listener/0 connection mở)
- Kế hoạch 04: Bước 2 DONE (reset/seed script dry-run; chưa thay đổi dữ liệu)
- Kế hoạch 04: Bước 3 DONE (migration 023–024; paused_by_mountpoint_id + managed_by_station_id)
- Kế hoạch 04: Bước 4 DONE (bỏ station code, migration 025, mountpoint tự sinh, trạm tạo source/account atomic)
- Kế hoạch 04: Bước 5 DONE (endpoint enable/disable/lock/unlock, bulk matrix, xóa cascade mountpoint/account)
- Kế hoạch 04: Bước 6 DONE (mountpoint name immutable, duplicate 409, tắt MP pause relay 2 chiều)
- Kế hoạch 04: Bước 7 DONE (account username immutable, lock/delete online đóng connection, managed account password sync)
- Kế hoạch 04: Bước 8 DONE (reconcileAffected, entity.changed Socket.IO, response reconcile)
- Kế hoạch 04: Bước 9 DONE (targeted disconnect account/mountpoint/listener, chống race hub, max_connections)
- Kế hoạch 04: Bước 10 DONE (relay pause ownership station/mountpoint, manual override 409)
- Kế hoạch 04: Bước 11 DONE (probe fingerprint restart, probe/source reconcile, listener mapping đóng connection)
- Kế hoạch 04: Bước 12 DONE (entity.changed invalidation, fallback polling, form immutable, row actions)
- Kế hoạch 04: Bước 13 DONE (mock push/rover byte-exact, Flow A-G, source dừng khi tắt)
- Kế hoạch 04: Bước 14 PARTIAL (race/load/50 toggle PASS; real streaming BLOCKED chưa có endpoint allowlist)
- Bổ sung: trạng thái streaming online/offline/no data/—; relay_caster lấy từ relay runtime; regression fixtures 1/79/80
- Kế hoạch 04: Bước 15 DONE (Playwright 31/31, server 53/53, Go test/vet/race, graphify 2705 nodes); real streaming vẫn BLOCKED chờ endpoint allowlist
- Phase hiện tại: P1.10.1 — Khắc phục trạm/kết nối/tọa độ/geo DONE; P1.11 map defer
- Trạng thái P1.0: DONE (backup/restore PASS, graphify 2364 nodes, Playwright 15/15)
- Trạng thái P1.1: DONE (migration 014–017, station_sources 39, tenant scope)
- Trạng thái P1.2: DONE (tenant RBAC, migration 018–019, server 53/53, P1 RBAC 3/3)
- Trạng thái P1.3: DONE (DataTable selection, bulk APIs, multiselect, P1 bulk 3/3)
- Trạng thái P1.4: DONE (KPI mới, counts tenant, 2 cột, P1 dashboard 2/2)
- Trạng thái P1.5: DONE (form trạm, station_sources, geo reverse, uptime, P1 station 1/1)
- Trạng thái P1.6: DONE (mountpoint tối giản, drawer, impact, listener mapping, P1 mountpoint 2/2)
- Trạng thái P1.7: DONE (account listener ACL, effective mountpoints, Go sourcetable, P1 ACL 1/1)
- Trạng thái P1.8: DONE (form relay đầy đủ, JSON import dry-run/idempotent, P1 relay 1/1)
- Trạng thái P1.9: DONE (utf8mb4, repair station notes, sạch mojibake, P1 unicode 1/1)
- Trạng thái P1.10: DONE (server 53/53, Go test/vet, Playwright 29/29, backup/restore 39/39)
- Trạng thái P1.10.1: DONE (source listener/GGA, tọa độ động, geo fallback, uptime direction, Playwright 30/30)
- Trạng thái P0 Phase 1: DONE (drawer 5 tab, API connections/history/metadata)
- Trạng thái P0 Phase 2: DONE (API list/detail, filter, drawer chuỗi)
- Trạng thái P0 Phase 3: DONE (`/map`, API overview, layer/filter, redirect cũ)
- Trạng thái P0 Phase 4: DONE (`/system/health`, 4 card, cache 12s, fallback mock)
- Trạng thái P0 Phase 5: DONE (`/api/ops/dashboard`, alert impact, 4 vùng)
- Trạng thái P0 Phase 6: DONE (menu 7 nhóm, title/active, deep link, Esc/focus)
- Trạng thái P0 Phase 7: DONE (Playwright 14/14, server 48/48, Go test/vet)
- Trạng thái P0 Phase 8: DONE (auth password-only, migration 013, Go/UI/audit PASS)
- Trạng thái P0 Phase 9: DONE (39 station/39 mountpoint, 36 password_only, 32 mapping, caster 0 fail)
- Trạng thái UI/UX review: DONE (STT, filter thu gọn, màu action/zone, hot reload Docker)
- Trạng thái Phase 0: DONE
- Trạng thái Phase 1: DONE
- Trạng thái Phase 2: DONE
- Trạng thái Phase 3: DONE
- Trạng thái Phase 3.5: DONE (UI/UX Foundation)
- Trạng thái Phase 4: DONE (mock + real allowlist 2 relay/2 station)
- Trạng thái Phase 5: DONE (realtime/dashboard/history/alerts/ops + audit)
- Trạng thái Phase 6: DONE (mock + real probe; load 50 PASS; Taste auth defer)
- Trạng thái Phase 7: DONE core + rework nguồn trạm/1005 (Playwright 8/8)
- Trạng thái Phase 8–11: DONE core (rà soát Playwright, còn defer đã ghi)
- Trạng thái Phase 12: TODO (chưa commit hardening)
- Người thực hiện: OpenCode

## 2. Trạng thái

### Đã làm
- Phase 0: tài liệu, AGENTS/TASKS/SESSION/README, `.env.example`, `.gitignore`,
  baseline relay read-only.
- Phase 1: Docker Compose, MySQL hai schema/migration, Node auth + RBAC,
  CRUD stations/mountpoints/web-users/roles, Go health, React frontend,
  API contract, seed dữ liệu test.
- Phase 2: schema relay admin/runtime, Node API relay-jobs + actions + audit,
  Go relay bridge/NTRIP/RTCM/NMEA/SOCKS5/TLS, loop guard, reconcile theo
  revision, runtime writer buffer, mock caster/rover/source + fixtures,
  test mock 2-T1..2-T9 và E2E Node -> Go -> mock.
- Phase 3: NTRIP account CRUD + ACL placeholder, import relay, retention,
  reconcile saved/applied, UI Relay/Mountpoint/TK NTRIP; xem mục 8.
- Phase 3.5: triển khai UI/UX Foundation (shell, dark mode, dialog/drawer,
  pagination, lucide, toast, a11y); xem mục 8.7.
- Phase 4: caster listener 1509/1508, auth/ACL/max conn, fan-out, slow client,
  runtime connections, UI Caster; xem mục 8.8.
- Phase 5: realtime Socket.IO, dashboard, history, alerts/ack, backup/restore,
  load test mock, ops doc; xem mục 8.9.
- Phase 6: parser/analyzer/store quality, migrations admin006/runtime004,
  REST/RBAC/socket, panel nhúng popup trạm/relay; xem mục 8.11.
- P0 Phase 1: `/stations/:id`, drawer 5 tab, transport/quality/metadata status
  độc lập, reliability, API connections/history/metadata; Playwright PASS.
- P0 Phase 2: `/mountpoints/explorer`, API list/detail join relay/listener/ACL/
  online/quality/alert, filter trạm/trạng thái/owner/alert, RBAC scope.
- P0 Phase 3: `/map` hợp nhất, marker chỉ từ 1005, layer/filter URL, panel +
  mở drawer trạm, redirect hai bản đồ cũ.
- P0 Phase 4: `/system/health`, metric Node/Host/MySQL/Go, cache 12s, fallback
  Go/MySQL down và network không hỗ trợ.
- P0 Phase 5: dashboard 4 vùng + `/api/ops/dashboard` + alert impact
  desired/applied, click mở đúng relay/trạm.
- P0 Phase 6: menu 7 nhóm, title/active menu, deep link `/stations/:id` và
  `/map?station=`, Esc/focus, mobile drawer.
- P0 Phase 7: full regression PASS (Playwright 14/14, server 48/48, Go test/vet,
  build Docker, health Node/Go).
- P0 Phase 8: `auth_mode=password_only`, hash Argon2id, Go nhận username rỗng,
  API/UI/audit không lộ hash; Go unit + API + caster thật + Playwright PASS.
- P0 Phase 9: `importLegacyCaster` dry-run/commit, 36 station/mountpoint legacy,
  password-only legacy không hash, listener 1508/1509, 32 mapping; 32 cặp
  SOURCE/POST/rover PASS.
- UI/UX review: STT toàn bộ bảng, filter thu gọn + filter backend, nút action
  có màu, Dashboard 4 vùng màu, bổ sung thông tin bảng; Docker web/server
  hot reload 1s. Playwright 15/15, server test 48/48. Chi tiết:
  `docs/1/02_CAC_BUOC_THUC_HIEN_P0.md` mục 6.

- Unicode audit 2026-11-01: quét toàn bộ `cors_admin`/`cors_runtime` (35.532 dòng,
  148.901 chuỗi text + JSON) bằng mysql2 UTF-8; phát hiện 24 chuỗi lỗi trong 12
  `audit_logs` (`?`/U+FFFD: web_user display_name, station name/notes,
  region/address). Đã sửa theo ngữ cảnh đối chiếu (web_users, before/after,
  province/ward), verify hex UTF-8 và quét lại 0 lỗi; backup tại
  `Temp/opencode/backup_before_unicode_fix_20261101_143357.sql`. Lưu ý
  `TR_M_H_U_L_C` là mã định danh ASCII sinh từ tên lỗi, không phải lỗi Unicode,
  không đổi để tránh ảnh hưởng client.
- Unicode source 2026-11-01: sửa 2 nhãn UI U+FFFD + 6 dòng CP1258 trong
  `server/src/routes/stations.ts`; build server/frontend PASS; xem mục 12.

### Đang làm
- Không có.

### Tiếp theo
- P1 đã đóng. Việc tiếp theo: P1.11 bản đồ vận hành (defer, cần đọc lại
  `docs/1/02` Phase 3 và cập nhật map contract trước khi làm).

### Blocker
- Không có. `go test -race` chưa chạy được vì môi trường Windows không bật
  cgo/C compiler; đã chạy `go test ./...` và `go vet ./...`.

## 3. Baseline relay (read-only)

Đường dẫn: `F:\3.Laptrinh\1. Project\1. GNSS\relayrtcm\backup`

- Go 1.24.5, module `relayrtcm`; deps `x/net`, `modernc.org/sqlite`.
- Bản chất: NTRIP **bridge** GET upstream -> POST downstream, không phải caster.
- Bằng chứng: `main.go:690`, `main.go:724`, `main.go:1071`.
- Monitor cổng `8081`; history SQLite; không có RTCM framing/caster/ACL.
- `config.json`: 65 job, 64 bật; không đọc/in credential.
- SHA256 baseline: main.go, history.go, go.mod, config.json đã ghi ở Phase 0
  và không thay đổi.

## 4. Phase 1 — Kết quả

### 4.1. Hạ tầng
- Docker Compose: MySQL 8, migrate, Node, Go, Nginx/FE.
- MySQL `default-time-zone=+00:00`; Node/Go `TZ=Asia/Ho_Chi_Minh`.
- MySQL bind `127.0.0.1:3307`; Go internal `127.0.0.1:7080`; Node `127.0.0.1:4000`.
- Web `http://localhost:3000` (Nginx proxy `/api` -> server:4000).

### 4.2. Database
- `cors_admin`, `cors_runtime`.
- `schema_migrations(scope, version)`; admin version 1, runtime version 1.
- RBAC: `roles`, `permissions`, `role_permissions`, `web_users`, `web_sessions`.
- Nghiệp vụ: `stations` (không mountpoint), `mountpoints`, `ntrip_accounts`.
- Audit: `audit_logs` với JSON đã redact.
- Seed 3 role, 29 permission, 4 web user, 3 trạm, 3 mountpoint, 2 NTRIP account.

### 4.3. Kết quả test

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Compose up + fresh volume | PASS | MySQL healthy, migrate exit 0, server/gnss healthy |
| Node health | PASS | `{"status":"ok","db":"ok","schemaVersion":1}` |
| Go health | PASS | `{"db":"ok","schemaVersion":1,"status":"ok"}` |
| Web/Nginx | PASS | `GET :3000` 200; login qua proxy 200 |
| Login đúng/sai | PASS | đúng 200; sai 401 |
| Session logout | PASS | logout 204/200; `/api/auth/me` sau đó 401 |
| CSRF | PASS | thiếu header 403; sai header 403; fresh session |
| RBAC station scope | PASS | super=3, admin=3, user1=1; station ngoài subtree không lọt |
| RBAC web user scope | PASS | admin=3, user1=1 |
| Admin không quản lý super | PASS | PATCH super -> 403 |
| Admin tạo user level >= | PASS | 403 |
| User chỉ xem mình | PASS | GET super -> 404; list=1 |
| User add/delete | PASS | POST station -> 403; self role edit -> 403 |
| Field allowlist | PASS | user self display_name -> 200; role_id -> 403 |
| Session thu hồi khi khóa | PASS | lock -> `/me` 401 |
| Session thu hồi khi đổi mật khẩu | PASS | đổi pass -> `/me` 401 |
| CRUD web user | PASS | create/lock/unlock/delete |
| CRUD station | PASS | create/update/delete |
| CRUD mountpoint | PASS | create/update/delete |
| CRUD role + permission matrix | PASS | create role, PUT scope, GET lại, delete |
| Audit redaction | PASS | `password_hash` trong audit = `***` |
| NTRIP account không login web | PASS | 401 |
| Web account xác thực NTRIP | DEFERRED | Caster ở Phase 4 |
| Timezone DB | PASS | MySQL global/session `+00:00`; UTC timestamp |
| Timezone UI | PASS | Dashboard dùng `Asia/Ho_Chi_Minh`; build chứa timezone |
| Server unit test | PASS | Vitest 7/7 |
| Go test | PASS | `go test ./...` OK |

### 4.4. Lệnh chạy

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:7080/health
# UI: http://localhost:3000
```

Tài khoản seed nằm trong `.env.local` (không commit):
`superadmin`, `admin`, `user1`, `user2`.

### 4.5. Hạn chế / khác biệt so với checklist

- Frontend Phase 1 chỉ có Dashboard/Trạm/Web users/Roles; các menu Relay,
  Mountpoints, TK NTRIP, Kết nối, Nhật ký, Cấu hình để Phase 2+.
- Web account dùng xác thực NTRIP chưa test được vì caster ở Phase 4.
- Taste gate 0 FAIL đầy đủ để Phase 5; Phase 1 có token/layout cơ bản.
- Không import 65 trạm; chỉ seed 3 trạm test.
- Không chạm relay cũ, không chạy relay, không dùng cổng 8081/2101.

### 4.6. Rà soát Phase 1 (2026-10-30)

Rà soát toàn bộ `server/`, `gnss/`, `frontend/`, `db/`, `docker-compose.yml`
bằng Graphify + đọc mã. Đã tìm và sửa các lỗi sau:

| # | Lỗi | Sửa |
|---|---|---|
| 1 | Tạo/sửa web user với email rỗng hoặc bỏ trống trả 400 (`zod .optional().default('')` vẫn validate email) | Dùng union `'' \| email` (`lib/validation.ts`); test hồi quy |
| 2 | Có thể hạ cấp `super_admin` cuối cùng qua `PATCH /api/web-users/:id {role_id}` | Guard `LAST_SUPER_ADMIN` 409 |
| 3 | Non-super tạo/tách user bằng `parent_user_id: null` ra ngoài subtree | Trả 403 `FORBIDDEN` |
| 4 | Thiếu kiểm tra cấp bậc khi PUT/PATCH/DELETE role (nguy cơ nâng quyền) | `assertCanManageRole` cho mọi thao tác role |
| 5 | Lưu `role_permissions` (DELETE + INSERT) không transaction | Bọc `withTransaction` |
| 6 | Audit/session ghi IP của nginx thay vì client | `app.set('trust proxy', 1)` |
| 7 | `mountpoints` không kiểm tra `owner_web_user_id` tồn tại | Trả 400 `INVALID_OWNER` |

Bằng chứng kiểm tra sau sửa:

| Mục | Kết quả |
|---|---|
| `server` tsc build | PASS |
| Vitest | PASS 9/9 (thêm test email) |
| `frontend` `npm run build` | PASS |
| `go test ./...` | PASS |
| Rebuild + restart `server` (Compose) | PASS; health `ok`, schema 1 |
| Tạo web user email rỗng | PASS 201 (trước đó 400) |
| Tạo web user bỏ trống email | PASS 201 |
| Hạ cấp super_admin cuối | PASS 409; role giữ `super_admin` |
| Admin tạo user `parent_user_id=null` | PASS 403 |
| Mountpoint owner không tồn tại | PASS 400 `INVALID_OWNER` |
| Admin list stations (subtree) | PASS total=3 |
| Secret trong repo | Không có (`git grep`) |

Không chạm relay backup, không dùng cổng 8081/2101.

## 5. Quyết định đã chốt

- D1–D24 giữ nguyên theo `docs/0/KE_HOACH_CHI_TIET.md`.
- Auth web: session cookie + CSRF; không JWT.
- MySQL only; hai schema; Go ghi runtime, Node ghi admin.
- Timezone: lưu UTC; hiển thị +07.
- RBAC mặc định super_admin/admin/user; custom role level 1–99.
- Web account và NTRIP account tách biệt.

## 6. Rủi ro đang theo dõi

- Phase 2 cần mock-first; không chạm caster thật.
- Secret trong `.env.local` phải giữ ngoài git.
- NTRIP account vs web account cần test đầy đủ khi có caster.
- Docker image build lần đầu khá lâu; nên build trên CI/máy local.

## 7. Phase 2 — Kết quả

### 7.1. Data model & API
- Migration `db/migrations/admin/002_relay.sql`: `relay_credentials`,
  `relay_jobs` (unique `external_key`, unique cặp endpoint, soft-delete,
  `desired_revision`).
- Migration `db/migrations/runtime/002_relay_runtime.sql`: `relay_job_state`,
  `relay_sessions`, `relay_events`, `relay_hourly`; `runtime_meta=2`.
- API Node `/api/relay-jobs`: list/detail/create/patch/soft-delete +
  enable/disable/restart/test; audit redacted; không trả secret.
- Internal API Go: reconcile/test/snapshot, ký HMAC + timestamp + nonce.
- Reconcile theo `desired_revision`; Go ghi `applied_revision`,
  `runtime_state`, `last_error`.
- Endpoint key chuẩn hóa `scheme://host:port/mount`; self-loop + DFS cycle.

### 7.2. Go bridge
- `internal/ntrip`: NTRIP v1 ICY, v2 HTTP/chunked, GET, POST, SOURCE,
  auto fallback, Basic auth, TLS (RootCAs injectable), SOURCETABLE reject.
- `internal/relay`: bridge byte-copy, metrics, backoff/jitter, NMEA,
  loop guard, manager, bounded runtime writer, `service_restart`.
- `internal/rtcm`: CRC24Q, resync, bounded buffer, counts only (không sửa byte).
- `internal/proxy`: SOCKS5 (no-auth + auth config), lỗi không lộ credential.
- `internal/secret`: AES-256-GCM `v1:nonce:cipher:tag`.
- `internal/api`: HMAC, ±60s, nonce replay 2 phút, health schema >= 2.

### 7.3. Mock & E2E
- `scripts/mock-ntrip`: caster/source/rover, chunked, fragment, delay,
  repeat, capture; bind mặc định loopback.
- Fixtures: `rtcm3-valid.hex`, `rtcm3-badcrc.hex`.
- `scripts/e2e-relay-mock.ps1`: login superadmin -> tạo job có credential ->
  Go stream mock -> capture byte-exact -> state streaming -> test action ->
  disable -> soft-delete; kiểm tra API không lộ secret.

### 7.4. Bằng chứng kiểm thử

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Migration SQL fresh (temp schema) | PASS | admin 12 bảng, runtime 5 bảng, `runtime_meta=2` |
| Migration idempotent (Compose) | PASS | `[migrate] done admin=0 runtime=0` |
| Node health | PASS | `schemaVersion=2`, `db=ok` |
| Go health | PASS | `schemaVersion=2`, `db=ok` |
| Node tsc | PASS | `npx tsc --noEmit` sạch |
| Node Vitest | PASS | 19/19 (relay 10 + rbac 9) |
| Go test | PASS | relay/ntrip/rtcm/nmea/secret/proxy/config |
| Go vet | PASS | `go vet ./...` sạch |
| Go TLS handshake | PASS | `TestGetTLS` với CA cục bộ |
| Go SOCKS5 | PASS | `TestSOCKS5NoAuthDial` |
| Byte-exact 1KB/1MB | PASS | `Test2T1ByteExactSource/Post` |
| Mảnh read / nhiều frame | PASS | `Test2T2`, `Test2T3` |
| Slow client | PASS | `Test2T5` (4MB, client chậm không chặn job khác) |
| Reconnect/backoff/timeout | PASS | `Test2T4`, `backoff_test` |
| Go restart `service_restart` | PASS | `Test2T6` |
| DB down/up không chặn RTCM | PASS | `Test2T7`, `writer_test` |
| Loop/self-loop | PASS | `Test2T8`, `loopguard_test` |
| Không lộ secret | PASS | `Test2T9`, E2E kiểm tra response/log |
| Streaming state | PASS | `TestOnFirstByteFiresOnce`, E2E `state=streaming` |
| Disable không bị ghi đè | PASS | `TestDisabledStateNotOverwrittenByStopped` |
| E2E mock | PASS | job 5/6/7: capture byte-exact, streaming, test OK, disable + soft-delete |
| RBAC list relay scope | PASS | admin subtree + user1 own list 200; sửa cột owner bị ambiguous khi JOIN credential |
| Compose rebuild | PASS | migrate/server/gnss rebuilt, containers healthy |

### 7.5. Lệnh chạy

```bash
cd gnss && go test ./... && go vet ./...
cd server && npx tsc --noEmit && npm test
docker compose build migrate server gnss
docker compose run --rm migrate
docker compose up -d --force-recreate server gnss
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-relay-mock.ps1
```

### 7.6. Ghi chú / hạn chế

- `APP_ENC_KEY` cũ trong `.env.local` không giải mã đủ 32 byte; đã xoay sang
  key base64 32 byte (chỉ `.env.local`, không commit). Credential cũ (nếu có)
  sẽ không giải mã được với key mới.
- E2E dùng `host.docker.internal:2102`; không dùng cổng `8081`/`2101`.
- Mock chỉ kiểm tra byte/handshake, không mô phỏng đầy đủ RTCM message semantics.
- Loop guard chỉ phát hiện vòng nội bộ theo endpoint key; không phát hiện vòng
  qua hệ thống ngoài.
- `go test -race` chưa chạy do thiếu cgo/C compiler trên Windows.
- Job/credential E2E đã dọn khỏi DB test; audit giữ lại.

### 7.7. Bổ sung kế hoạch Phase 6 (2026-10-30)

- Thêm kế hoạch **RTCM Analytics & chất lượng trạm/relay**:
  `docs/0/RTCM_QUALITY_PLAN.md`.
- Dùng `github.com/go-gnss/rtcm` (Apache-2.0, package `rtcm3`) để parse-only.
- Chất lượng dùng chung theo `target_type` + `target_id` + `direction`:
  - `station` + `ingest`: trạm thường, từ caster ingest hoặc station probe GET-only.
  - `relay_job` + `upstream/downstream`: trạm relay, thêm chỉ số `parity`.
- Có backend tổng hợp, API, Socket.IO realtime và FE quản trị hai tab Trạm/Relay.
- Không sửa byte RTCM, không lưu raw payload, không auto-disable job/probe.
- Đã cập nhật `KE_HOACH_CHI_TIET.md`, `TASKS.md`, `CAC_BUOC_THUC_HIEN.md`,
  `docs/api.md`, `AGENTS.md`, `README.md`.
- Chưa triển khai code Phase 6; chỉ chốt kế hoạch/task.

## 8. Phase 3 — Kết quả

### 8.1. Đã làm
- NTRIP account CRUD + lock/unlock + owner scope + ACL placeholder
  (`account_mountpoint_acl`); API/UI tách khỏi web account.
- Sửa scope list mountpoint bị ambiguous khi JOIN stations.
- Import relay: `server/src/db/importRelay.ts`; `--dry-run/--ids/--force`,
  transaction, idempotent, disabled, `source_sha256`, không log secret.
- Retention Go: prune sessions/events/hourly theo batch, không xóa session mở.
- Reconcile saved/applied: UI Relay hiển thị state + applied/desired; Go down/up.
- UI thêm Relay, Mountpoint, TK NTRIP; menu Phase 3.
- Migration `admin/003_ntrip_acl.sql`; health Node schema 3.

### 8.2. Bằng chứng test

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Node tsc | PASS | `npx tsc --noEmit` |
| Node Vitest | PASS | 21/21 |
| Frontend build | PASS | `npm run build` |
| NTRIP API + ACL | PASS | create/list/ACL/lock/unlock/delete; adminMp=3, userMp=1 |
| Audit redaction | PASS | audit ntrip_account leak=0 |
| Import dry-run | PASS | selected=2, created=2 |
| Import create/skip/force | PASS | created=1 → skipped=1 → updated=1; enabled=0; sha; creds `v1:` |
| Reconcile Go down/up | PASS | desired=2, applied=2, state=backoff |
| Retention integration | PASS | `TestPruneOnceMySQL`: old deleted, new/open kept |
| Delete close reason | PASS | `TestDeleteClosesSessionWithDeletedReason` |
| Go test/vet | PASS | `go test ./...`, `go vet ./...` |
| Migration | PASS | `[migrate] admin 003_ntrip_acl.sql applied` |

### 8.3. Ghi chú
- Không test caster thật, không dùng cổng 8081/2101.
- Browser smoke UI chưa tự động; chỉ build PASS.
- Import dùng fixture `scripts/fixtures/relay-config.sample.json`.
- Test data import/reconcile/NTRIP đã dọn; audit giữ lại.

### 8.4. Fix review 2026-10-30 (soft-delete re-tạo job)
- Lỗi 1: unique index `external_key` + `(upstream_key, downstream_key)` chặn
  tạo lại job trùng cấu hình sau soft-delete (tái hiện `ERROR 1062
  uq_relay_jobs_endpoints`). Fix: khi soft-delete, Node đổi 3 key thành
  `…#deleted:<id>` (lib `tombstone.ts`, dùng chung DELETE route + import).
- Lỗi 2: import `--force` UPDATE nhầm row đã soft-delete. Fix:
  `importRelay.ts` lọc `deleted_at IS NULL` và tombstone row cũ trước INSERT.
- docs/api.md mục 10 ghi rõ hành vi giải phóng key sau DELETE.
- Bằng chứng: Vitest 21/21 (+2 test tombstone); SQL probe trên `relay_jobs`
  thật: recreate OK; E2E API `scripts/e2e-softdelete-recreate.ps1`:
  create id=14 → delete → recreate id=15 OK; probe đã dọn khỏi DB.

### 8.5. Bổ sung kế hoạch UI/UX Phase 3.5 (2026-10-30)

- Đánh giá UI hiện tại: form CRUD inline, không icon, không phân trang, shell
  cuộn cùng menu, dùng `window.confirm`, thiếu drawer/detail/toast/a11y.
- Chốt hướng **`framed-sheet`** (seed 973367273): shell cố định, white sheet,
  IBM Plex Sans/Mono, `lucide-react` monochrome, một accent.
- Chốt pattern: Dialog/Drawer/AlertDialog, DataTable + server pagination,
  search debounce + URL state, loading/empty/error/toast, keyboard/a11y.
- Dark mode: `system` mặc định + toggle `light/dark`; token dark, `color-scheme`,
  chống FOUC; test contrast cả 2 theme.
- Phase 3.5 làm trước Phase 4; Phase 4/5/6 dùng lại foundation.
- Chi tiết: `docs/0/UI_UX_PLAN.md`; đã cập nhật KE_HOACH/TASKS/CAC_BUOC/AGENTS.

### 8.6. Phê duyệt triển khai & đổi port caster (2026-10-30)

- Đã duyệt: Q1–Q7, Q11; Q8 backup path
  `F:\3.Laptrinh\1. Project\1. GNSS\Backup`; Q9 load test 20; Q10 allowlist
  endpoint thật (credential chỉ dùng ngoài repo); Q3 đồng ý go-rtcm.
- Đổi mặc định caster: **1509** cho source + rover, tùy chỉnh theo listener;
  nhóm mountpoint many-to-many (ví dụ A,B,C→1509; A,C→1508).
- Không dùng 2101/8081; migration Phase 6 admin phải đổi số vì 003 đã dùng.
- Đã cập nhật `KE_HOACH`, `TASKS`, `CAC_BUOC`, `docs/api.md`, `README`,
  `AGENTS`, `.env.example`; chưa chạy code/test.
- Q10 credential/endpoint không ghi vào repo/docs/log.

### 8.7. Phase 3.5 — Kết quả triển khai (2026-10-30)

- Shell `framed-sheet` cố định; sidebar 228px + topbar 48px; content scroll;
  mobile drawer.
- Dark mode `system/light/dark` + token + chống FOUC + toggle lưu localStorage.
- Component layer: Button/IconButton, Field/Input/Select, Modal/Drawer,
  AlertDialog, Toast, DataTable, Pagination, SearchInput, StatusBadge.
- Refactor Stations/Mountpoints/Relay/NTRIP/WebUsers/Roles/Dashboard:
  bỏ form inline + `window.confirm`; CRUD dialog/drawer; server pagination + URL.
- Icon lucide monochrome; IBM Plex Sans/Mono self-host.

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Frontend build | PASS | `npm run build` |
| Playwright | PASS | 2/2: CRUD light/dark + mobile drawer |
| inspect login | PASS | 0 FAIL; WARN hero-void/tiny-text (login compact) |
| Auth pages | PASS | screenshot light/dark/mobile trong `frontend/test-results` |
| Server regression | PASS | tsc + Vitest 21/21 |
| Go regression | PASS | `go test ./...`, `go vet ./...` |
| Docker web | PASS | rebuild + health 200 |

- Defer: dirty guard, filter nâng cao, recent activity; không chặn Phase 4.
- `inspect.mjs` không hỗ trợ auth; trang sau đăng nhập kiểm bằng Playwright.

### 8.8. Phase 4 — Kết quả (2026-10-30)

- Caster Go: listener 1509/1508, SOURCE/POST/GET, v1/v2, chunked,
  SOURCETABLE, Basic auth Argon2, ACL, max connections, fan-out,
  slow-client drop, source conflict, disconnect, runtime connections.
- Migration `admin/004_caster.sql` + `runtime/003_caster_runtime.sql` applied;
  seed listener 1509; health Node 4 / Go 3.
- Node API `/api/caster` + `/api/connections`; UI Caster (listener,
  mountpoint mapping, connections) dùng foundation Phase 3.5.
- Hot reload Vite: `usePolling=true`, interval 1000ms cho Windows.
- Test: Go caster 7 test PASS; E2E source/rover 1509 byte-exact PASS;
  Node tsc + Vitest 21/21; frontend build; Playwright 2/2.
- Q10 integration allowlist chưa chạy (defer); không dùng credential thật.
- Docker Compose publish 1509/1508 cho caster.

### 8.9. Phase 5 — Kết quả (2026-10-30)

- Migration `db/migrations/admin/005_alerts_settings.sql`: `alerts`, `settings`,
  permission `alerts.view`/`alerts.ack`; admin schema 5.
- Realtime: `server/src/realtime/*`, Socket.IO path `/socket.io`, auth session
  cookie, room `user:<id>`, subscribe `relay:<id>`/`caster` có kiểm tra quyền;
  poll Go internal 1 s; payload lọc scope; sự kiện `snapshot`, `relay.updated`,
  `relay.session`, `connection.updated`, `alert.created`, `auth.revoked`.
- API: `GET /api/snapshot`, `GET /api/alerts`, `POST /api/alerts/:id/ack`,
  `GET /api/history/{sessions,events,hourly}`; RBAC + pagination/filter.
- Alert polling: relay `backoff`/`error`, Go/caster unavailable; cooldown 5 phút;
  không auto-disable.
- UI: Dashboard realtime (KPI + trạng thái relay), trang Cảnh báo + ack,
  trang Lịch sử (3 tab), nav Phase 5; Vite/Nginx proxy `/socket.io`.
- Ops: `scripts/backup-mysql.ps1`, `scripts/restore-mysql.ps1` (path
  `F:\3.Laptrinh\1. Project\1. GNSS\Backup`), `scripts/load-test-mock.ps1`
  (20 job + 20 rover mock, cổng 2102); `docs/OPS.md`; log rotation Docker;
  rate limit login 10/phút, API 300/phút; body limit 256 KB.

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Node tsc | PASS | `server: npx tsc --noEmit` |
| Node Vitest | PASS | 29/29 (realtime 8 + rbac 9 + relay 12) |
| Frontend build | PASS | `frontend: npm run build` |
| Go regression | PASS | `go test ./...`, `go vet ./...` |
| Migration | PASS | `[migrate] admin 005_alerts_settings.sql applied`; health Node 5 |
| Socket unauth | PASS | `connect_error UNAUTHENTICATED` |
| Socket auth/reconnect | PASS | snapshot + reconnect snapshot; room `relay:40` OK |
| Scope payload | PASS | super stations=3, user1 stations=1; relay/alert ngoài scope ẩn |
| Role change | PASS | user1 role user→super_admin: socket stations 1→3; đã revert |
| Logout/revoke | PASS | socket nhận `auth.revoked` sau logout |
| alert.created | PASS | insert alert → socket event đúng id (đã dọn) |
| Alert create/ack | PASS | backoff tạo alert; super ack 200; user1 ack 403 |
| History API | PASS | sessions/events/hourly total 26/6/21; filter jobId OK (đã dọn job/alert test sau kiểm chứng) |
| Playwright | PASS | realtime.spec.ts 2/2 (reconnect offline + user scope) |
| Backup/restore | PASS | backup zip SHA256; restore -Force; health Node/Go OK |
| Load test | PASS | 20/20 relay streaming trên mock 2102 |
| Secret scan | PASS | không có secret/dump trong diff repo |

- Lệnh kiểm tra chính:

```bash
cd server && npx tsc --noEmit && npm test
cd frontend && npm run build
cd frontend && npx playwright test tests/realtime.spec.ts
cd gnss && go test ./... && go vet ./...
docker compose run --rm migrate
docker compose up -d --force-recreate server web
powershell -File scripts/backup-mysql.ps1
powershell -File scripts/restore-mysql.ps1 -BackupFile <zip> -Force
powershell -File scripts/load-test-mock.ps1 -Jobs 20
```

- Defer: Role UI nâng cao/audit API; Taste `inspect.mjs` sau đăng nhập;
  Q10 allowlist thật. Phase 6 đã triển khai mock, xem mục 8.11.
- Không dùng endpoint thật/credential thật; không bind 2101/8081; không commit
  dump backup.

### 8.10. Khảo sát CGBAS & cập nhật kế hoạch (2026-10-30)

- Khảo sát đối chiếu tính năng CGBAS (CORS management platform 上海华测导航
  技术股份有限公司, Trung Quốc) → báo cáo tổng hợp trong hội thoại; không thêm code.
- Kết luận: UI foundation (3.5) đã đạt chuẩn app-screen; khoảng cách là
  **nội dung nghiệp vụ** (bản đồ, biểu đồ, notification center, dictionary
  trạm, export/import, log viewer), không phải khung UX.
- Thêm **Phase 7–12 — hoàn thiện theo CGBAS** (roadmap):
  - A quick win: export Excel `.xlsx` (`exceljs`), log viewer, user center,
    brand runtime, dirty-guard.
  - B (đè P6): notification center + event config (không làm expression
    engine), cảnh báo caster/rover, dictionary trạm, statistical graph.
  - C đã chốt mở (bổ sung cùng phiên): D45 chart lib=(a), D46 map+tiles=(a),
    D47 i18n=(đóng).
  - D roadmap xa: VRS/NRTK, storage file thô, displacement monitor, Open API.
- Thêm quyết định D44–D49 vào
  `KE_HOACH_CHI_TIET.md` §2; thêm §7.11 + dòng Phase 7 ở §14 lộ trình.
- `TASKS.md`: bảng phase + checklist Phase 7–12; P6-04/P6-05/P6-06 ghi chú
  giao tiếp với Phase 9/11 (type/level alert, chart/export dùng chung).
- `CAC_BUOC_THUC_HIEN.md`: bảng phase + gate G7–G12 (NOT RUN).
- `RTCM_QUALITY_PLAN.md`: mục 12 ghi phụ thuộc Phase 9/11.
- Không học từ CGBAS: password plaintext, i18n lệch menu/route,
  trang có bundle không menu.
- **Chốt quyết định (2026-10-30 16:10):** D45=(a) chart tự vẽ SVG zero-dep;
  D46=(a) `leaflet` + tile OSM công cộng (attribution bắt buộc, không key
  thương mại), map tách Phase 8 (P8-01); D47=(đóng) i18n postpone,
  reopen khi có khách EN. Nhóm C mở trong Phase 7–8. `AGENTS.md` §3 bổ sung dòng
  Chart + Map để khớp quy ước "lib mới phải qua quyết định".

### 8.11. Phase 6 — Kết quả (2026-10-30)

- Triển khai parser/analyzer/store quality Go, migration `admin/006`,
  `runtime/004`, REST/RBAC/socket Node, panel quality FE.
- **Sửa theo yêu cầu UI:** bỏ menu/route `/quality`; nhúng `QualityPanel`
  vào popup chi tiết trạm/relay. Bấm trạm → popup có quality; bấm **Sửa**
  → popup sửa riêng. Xóa `frontend/src/pages/Quality.tsx`.
- Rebuild web Docker; health Node `schemaVersion=6`.
- Test: `go test ./...` PASS; `npm test` server 33/33 PASS; Playwright 5/5
  PASS (quality embedded, edit tách, mobile/dark mode).
- Đã bổ sung: probe runner Go, aggregate chòm sao, audit API/tab Audit,
  load 50 job PASS, real 2 relay/2 station streaming, DB down/up PASS.
- Còn defer: Taste `inspect.mjs` sau auth (Phase 8 UI).

### 8.12. Khảo sát CGBAS lần 2 & roadmap 7–12 (2026-10-30)

- Cập nhật graphify repo: **1734 nodes / 4486 edges / 112 communities**
  (code-only; docs semantic chưa chạy).
- Đối chiếu graphify CGBAS: **3453 nodes / 8619 edges / 267 communities**;
  trích route/menu và trường dữ liệu từ chunk `station-manage`,
  `station-overview`, `data-inspect`, `station-control`, `notification-center`,
  `dictionary`, `user-manage`, `operate-log`, `user-center`, `broadcast-*`.
- Kết luận: UI hiện tại sơ sài do **dữ liệu trạm quá mỏng + IA phẳng**, không
  chỉ do CSS. CGBAS có hồ sơ trạm đầy đủ, menu nhóm, notification center,
  dictionary/custom fields, log viewer, user center, map/online user.
- Đã sửa ngay: default port trạm/relay/DB/seed/API/form → **1509**; thêm
  `db/migrations/admin/007_port_defaults.sql`; `.env.local` CASTER_PORT=1509.
- Tài liệu mới: `docs/0/PHASES_7_12_PLAN.md` (audit + gap + **đặc tả UI/field
  theo nhóm** + roadmap).
- Menu chốt: Dashboard; Trạm (Bản đồ trạm, Danh sách trạm); CORS (Bản đồ
  online, **Danh sách online**, Tài khoản NTRIP, Mountpoint, Caster); Relay;
  Hệ thống (Phân quyền, Người dùng, Lịch sử, Cảnh báo); trang cá nhân ẩn menu.
- Quyết định mới: D50 `exceljs` cho `.xlsx`; D51 online map chỉ marker tài
  khoản có toạ độ + tổng số tài khoản không gửi tọa độ + menu Danh sách online;
  D52 import user không cột password, mật khẩu `123456`; D53 caster listener
  CRUD + tab live/force disconnect.
- Cập nhật `TASKS.md`, `KE_HOACH` §7.11/§14, `CAC_BUOC`, `UI_UX_PLAN`,
  `RTCM_QUALITY_PLAN` §12, `README`, `AGENTS`.
- Đã hoàn thiện tồn đọng Phase 4–6:
  - Probe runner Go đọc `station_probes`, GET-only, feed quality station.
  - Aggregate satellite/signal/cell theo chòm; station 79 = 31 SV, station 80 = 38 SV.
  - Audit API `/api/audit-logs` + tab Audit + recent activity dashboard; sửa role.
  - Load test mock 50 job: 50/50 streaming PASS.
  - Giữ 2 relay + 2 station + 2 probe đang bật; config thật ở `secrets/` (ignored).
- Quyết định UI: drawer trạm 1080px; metric thiếu dữ liệu disabled; Sky Plot
  thật/cycle slip/RMS/latency/neighboring stations chuyển Phase 8–9.
- Chưa triển khai code Phase 7; thứ tự: 7 (UI/list/trạm) → 8 (map/detail/online)
  → 9 (CORS) → 10 (Relay/Hệ thống) → 11 (cá nhân/config/report) → 12 (hardening).

### 8.13. Phase 7 — Kết quả core (2026-10-30)

- Thêm `exceljs`; import/export `.xlsx` cho trạm: preview, lỗi dòng, transaction, audit.
- Migration `admin/008_station_profile.sql`, `admin/009_dictionary_custom_fields.sql` đã apply.
- API trạm v2: owner name, mountpoint count, quality summary, last data; filter q/region/owner/receiver.
- Menu nhóm mới; bỏ footer dev; pagination mặc định 10; dirty guard.
- Form trạm nhóm: Định danh / Vị trí / Thiết bị / Kết nối; select dictionary.
- Test: Go PASS, Node 33/33, Playwright 5/5; export/import dry-run 5 dòng PASS.
- Defer Phase 8: test connection GET-only, bản đồ, drawer 1080, quality UI.

### 8.14. Phase 8 — Kết quả core (2026-10-30)

- Thêm Leaflet + OSM: `/stations/map`, `/online/map`, `/online`.
- Drawer trạm rộng 1080px, tab Tổng quan/Kết nối/Chất lượng; nút Sửa tách riêng.
- Quality panel: KPI score/availability/min, constellation breakdown, metric nâng cao disabled.
- Online map chỉ marker tài khoản có tọa độ; hiển thị tổng số không gửi tọa độ.
- Online list: bảng kết nối, search, force disconnect nếu có quyền.
- Test: Playwright map + quality PASS; Go/Node PASS.
- Defer: Sky Plot thật/cycle slip/RMS/latency/neighboring stations (Phase 8–9).

### 8.15. Phase 9 — Kết quả core (2026-10-30)

- Migration `admin/010_ntrip_mount_profile.sql`: company/contact/email/phone/
  hiệu lực/khu vực/auth method/notes cho NTRIP; service type/position mode/
  satellite systems/caster interval/code protocol/type/description cho mountpoint.
- API NTRIP/mountpoint trả và nhận trường mới; UI form đã bổ sung nhóm trường.
- Caster đã có listener CRUD + tab connections/force disconnect từ Phase 4.
- Test: Go/Node PASS; Playwright 6/6; API NTRIP/mountpoint trả fields mới.
- Defer: import/export `.xlsx` cho NTRIP/mountpoint (Phase 10/11).

### 8.16. Phase 10 — Kết quả core (2026-10-30)

- Migration `admin/011_alerts_event.sql`: event_type/level/unread/read_at.
- Alerts API lọc level/eventType/unread; thêm read-all/read.
- User import/export `.xlsx`: không cột password, mật khẩu mặc định `123456`.
- History đã có Audit; roles đã có sửa role từ Phase 5.
- Test: import dry-run 4 user PASS; alerts trả level/eventType; Playwright 6/6.
- Defer: import/export relay/role; notification center nâng cao/event config.

### 8.17. Phase 11 — Kết quả core (2026-10-30)

- Thêm `/api/profile`: xem/cập nhật hồ sơ, đổi mật khẩu, danh sách phiên.
- Trang `/profile` ẩn menu; mở bằng tên người dùng trên topbar.
- Đổi mật khẩu xóa các phiên khác; audit thao tác.
- Test API profile/sessions PASS; frontend build PASS.
- Defer: notification center nâng cao/event config, dictionary admin,
  system params/brand/logo, log viewer, dashboard report/retention.

### 8.18. Rework Phase 7 — nguồn trạm, 1005/1006 và Playwright (2026-10-30)

- Migration `admin/012_station_source.sql`: thêm `source_type`
  (`relay_caster|caster_ingest|probe_client|manual`), `ntrip_version` (mặc định v1),
  `ntrip_mode` (`v1_noauth|v1_auth|v2_auth|ntrip_client`); suy ra từ relay job
  cho trạm đang được relay cấp dữ liệu.
- API `/api/stations`: trả `relay_job_id/name`, upstream host/port/mount,
  `ntrip_version`, `ntrip_mode`; đọc `arp_x/y/z` từ quality sample 1005/1006,
  chuyển ECEF -> WGS84 bằng `server/src/lib/geo.ts`, tính VN2000 TM 105° và
  ITRF ECEF; không fallback `lat/lon` nhập tay.
- UI trạm: list/detail hiển thị nguồn “NTRIP caster (relay)”, NTRIP version/mode,
  relay job, Relay upstream host read-only; toạ độ WGS84 6 chữ số, VN2000,
  ITRF; form giữ Vĩ độ/Kinh độ nhưng read-only.
- Bản đồ trạm/online dùng `reported_lat/reported_lon`; trạm chưa có 1005
  hiển thị “Chưa có 1005” và không đặt marker.
- CORS: NTRIP account list/detail hiển thị công ty/liên hệ/hiệu lực/khu vực/
  auth method; mountpoint list/detail hiển thị service/position/satellite/
  caster interval/code protocol.
- Alerts: bổ sung filter `level`, `unread`, hiển thị `eventType`/unread và nút
  “Đánh dấu đã đọc”.
- FE tối ưu: lazy-load `StationMap`/`OnlineMap`, tách Leaflet khỏi bundle chính
  (main ~442 kB, Leaflet ~150 kB chunk).
- Fix mojibake toàn bộ chuỗi tiếng Việt trong `WebUsers.tsx`.
- Sửa tên trạm bị mất dấu trong DB (audit qua API): `SLA Mộc Châu`,
  `THA Hậu Lộc`, `Trạm test Hà Nội 01/02`, `Trạm test Đà Nẵng 01`.
- Playwright: `workers: 1` để tránh rate limit login 10/phút; thêm
  `station-source.spec.ts`, `phase7-11.spec.ts`; tổng **8/8 PASS**.

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Migration | PASS | `[migrate] admin 012_station_source.sql applied` |
| Trạm relay | PASS | THA_HauLoc: source `relay_caster`, v2, relay job #93 |
| Toạ độ 1005 | PASS | WGS84 `19.999947, 105.969244`, ITRF/VN2000 có giá trị |
| Server build/test | PASS | tsc + Vitest 35/35 (thêm geo) |
| Go regression | PASS | `go test ./...` |
| Frontend build | PASS | Vite build, không cảnh báo chunk >500 kB |
| Playwright | PASS | 8/8 (map, phase7-11, quality, realtime, station-source, ui) |
| Web rebuild | PASS | container web healthy, UI tiếng Việt đúng |

### 8.19. Bổ sung chỉ số quality nâng cao (2026-10-30)

- Parse MSM4/MSM7 observation (code, phase, lock, half-cycle, CNR) trong Go;
  tính **Latency**, **Cycle slip**, **Code & Phase RMS** từ dữ liệu thực.
- API `/api/stations/:id/quality` và `/api/relay-jobs/:id/quality` trả thêm
  `latencyMs`, `cycleSlips`, `cycleSlipRate`, `codePhaseRmsM`,
  `codePhaseSamples`, `observations`, `skyPlotAvailable`, `skyPlotReason`.
- QualityPanel bỏ 4 nút disabled/“đang để Phase 8–9”; hiển thị số thực:
  - Latency: tuổi dữ liệu + điểm latency.
  - Cycle slip: số slip và % trên observation.
  - Code & Phase RMS: RMS biến thiên code-phase (m).
  - Sky Plot: nếu thiếu ephemeris 1019/1020/1045/1046 thì hiện đúng lý do,
    không vẽ vị trí giả.
- Kiểm chứng real station 80: latency ~0.7 s, cycle slip ~0.7%,
  code-phase RMS ~0.03 m, cửa sổ 300 mẫu RMS.
- Test: Go quality PASS; Node 35/35; frontend build PASS; Playwright
  station-source PASS (gồm assert 4 heading quality nâng cao).

### 8.20. Quét caster `rtktk.online` 1509/1508 (2026-10-31)

- Relay config cập nhật: `db/data/config.json` **67 job (66 bật)**, 67 credential
  upstream, 62 downstream, không SSL.
- Quét NTRIP sourcetable (không dùng credential): 1509 có **26** mountpoint,
  1508 có **6**; gộp không phân biệt hoa/thường được **36 trạm**.
- 5 trạm chỉ có trong relay config (chưa thấy ở sourcetable): `DTP_TanHong`,
  `GLI2`, `HUG_ViThuy`, `PYN_SongHinh`, `YBI_NghiaLo`.
- 4 mountpoint chỉ có trong sourcetable: `BG.TP`, `hauloc`, `MocChautest`,
  `TNN_DaiTu`; `BG.TP` -> station code `BG_TP`.
- Sourcetable động (`BG.TP` lúc có lúc không); toạ độ trả `0.00` nên file import
  để trống lat/lon.
- File: `db/data/caster_stations.xlsx` (import trạm), `caster_stations.csv/json`,
  `caster_mountpoints.csv/xlsx`, `sourcetable_1509/1508.txt`,
  `caster_scan_summary.md`; script `scripts/scan-caster-stations.mjs`.
- Lưu ý: xlsx chỉ tạo station; chưa tạo mountpoint/account/ACL/listener.

### 8.21. Kiểm tra stream `hauloc` và `MocChautest` (2026-10-31)

- Kết nối NTRIP `rtktk.online:1509`, dùng tài khoản được cấp (không lưu
  credential), đọc 60 giây mỗi mountpoint.
- `hauloc`: `ICY 200 OK`; 264 frame, CRC lỗi **0**; 1006/1033 12 frame,
  MSM 1074/1084/1094/1124 mỗi loại 60 epoch; gap epoch **0**.
  1006 st483: `19.999947, 105.969244`, h `-8.87 m`, antenna `0.41 m`.
- `MocChautest`: `ICY 200 OK`; 265 frame, CRC lỗi **0**;
  1006/1033 12 frame, MSM mỗi loại 60 epoch; gap epoch **0**; thêm 1 frame
  proprietary 4063. 1006 st224: `20.846817, 104.639403`, h `804.11 m`,
  antenna `2.46 m`.
- Kết luận: RTCM hợp lệ, không mất epoch/CRC; throughput ~940 B/s và ~770 B/s.
- Lưu ý: caster trả body dạng chunked (`\r\n<size>\r\n`) dù không có header
  `Transfer-Encoding`; probe bỏ qua 420 byte chunk header/60 giây. Nếu đọc raw
  TCP phải dechunk trước khi chuyển tiếp.
- Bằng chứng: `db/data/probes/probe_hauloc.json`,
  `probe_MocChautest.json` (bản timestamp kèm theo).

### 8.22. Tạo tài liệu các bước thực hiện P0 (2026-10-31)

- Thêm `docs/1/02_CAC_BUOC_THUC_HIEN_P0.md`: 13 phase từ baseline, P0.1–P0.6,
  chốt auth P0.11, provision P0.7/P0.12, HTTPS, load test, backup/rollback và
  cutover; mỗi phase có mục tiêu, giải thích đơn giản, việc làm, yêu cầu,
  checklist test và ghi chú.
- Ghi rõ trạng thái hiện tại: P0.1–P0.12 **chưa hoàn tất**; P0.9 mới có load
  test 50 job; P0.1–P0.6 chưa có route/API.
- Thêm `.gitignore` cho `db/data/config.json` (chứa credential relay) để không
  commit nhầm.
- Kiểm tra: server build PASS; Vitest **35/35 PASS**; frontend build PASS;
  `go test ./...` + `go vet ./...` PASS.
- Chưa chạy Playwright trong lần cập nhật này; chưa commit/push.

### 8.23. Danh sách trạm + bỏ auth mountpoint (2026-11-01)

- Trang Danh sách trạm: đổi cột `Tên` thành `Tên trạm`; thêm cột
  `Trạng thái streaming` ngay sau tên (dùng `quality_state`); đổi cột
  `Trạng thái` thành `Khóa/Mở khóa` và chuyển xuống cuối, cạnh cột hành động.
- Mở chi tiết trạm chỉ bằng cách bấm tên trạm (`.link-btn`), không còn
  `onRowClick` trên dòng.
- Bỏ hoàn toàn auth riêng của mountpoint ở UI/API/Go: mountpoint không còn
  `requires_auth`, `auth_mode`, `password_hash`; caster luôn xác thực bằng
  `ntrip_accounts` + ACL. Cột DB vẫn giữ (không drop) theo quyết định phiên.
- Kiểm tra: frontend `tsc --noEmit` PASS; server `tsc --noEmit` PASS;
  Vitest 53/53 PASS; `go test ./...` + `go vet ./...` PASS.
- Sửa bulk action trạm: chỉ bật khi đang tắt và không khóa; chỉ tắt khi đang
  bật và không khóa; chỉ khóa khi đang tắt/chưa khóa; mở khóa khi đang khóa.
  UI disable nút không hợp lệ, thêm ConfirmDialog trước khi chạy và toast kết
  quả; BE chặn lại và trả `skipped` cho hàng không hợp lệ. Cột streaming hiển
  thị `Đã tắt` khi trạm tắt/khóa thay vì giữ trạng thái quality cũ.
- Chặn xóa trạm đang bật: nút xóa đơn và bulk Xóa chỉ khả dụng khi trạm đã tắt;
  BE trả `STATION_ENABLED` cho xóa đơn và `skipped` cho bulk. Cập nhật test dọn
  dữ liệu (ui/p1-rbac/p1-station-fix) tắt trạm trước khi xóa.

### 8.24. Tắt trạm dừng nguồn thật + Activity/uptime (2026-11-01)

- Migration `022_station_stream_pause.sql`: thêm `paused_by_station_id` cho
  `mountpoints`, `relay_jobs`, `station_probes`; backfill các trạm đang tắt.
- Tắt trạm giờ disable thật mountpoint + probe + relay job có
  `upstream_mount` thuộc trạm, tăng `desired_revision`, rồi gọi Go
  `relay/reconcile` + `caster/reconcile`. Bật lại chỉ khôi phục tài nguyên do
  trạm tự tạm dừng; thao tác tay trên relay/mountpoint/probe xóa marker.
- Go caster/probe bỏ qua mountpoint/probe của trạm `enabled=0` (defense in
  depth); probe query thêm `s.enabled = 1`.
- Xác minh thực tế SLA Mộc Châu (trạm 79): relay 92 -> `disabled`,
  applied_revision 3; probe 2 và mountpoint 66 -> `enabled=0`,
  `paused_by_station_id=79`; quality sample dừng phát sinh sau ~1 phút.
- Thêm tab **Hoạt động** trong drawer trạm + API
  `GET /api/stations/:id/activity?range=24h|7d|30d`: uptime %, sự kiện mất kết
  nối (gộp theo 5 phút), timeline kết nối, series vệ tinh/C/N0/MSM/gap/age và
  chọn metric. UI theo mẫu Activity: range 24h/7d/30d, “Xem lịch sử kết nối”,
  thanh connection, chart có trục thời gian và “now”.
- Kiểm tra: frontend/server `tsc` PASS; Vitest 53/53; `go test ./...` +
  `go vet ./...` PASS; Playwright `station-detail.spec.ts` PASS + screenshot
  `test-results/station-activity-light.png`.

### 8.25. Mở chi tiết bằng cột tên (2026-11-01)

- Bỏ `onRowClick` khỏi `DataTable`; chỉ bấm vào tên bản ghi mới mở bảng thông
  tin. Áp dụng cho trạm, mountpoint, Mountpoint Explorer, listener caster,
  tài khoản NTRIP, relay job và web user.
- `.link-btn`: màu link, bỏ gạch chân; hover/focus đậm (600) + nền
  `--accent-soft` để nổi bật; bỏ `.data-table tbody tr.clickable`.
- Cập nhật Playwright: các spec mở chi tiết qua `.link-btn` thay vì click dòng
  (`auth-password-only`, `mountpoint-explorer`, `phase7-11`, `station-source`,
  `p1-mountpoint`, `p1-bulk`).
- Kiểm tra: frontend `tsc --noEmit` PASS; Playwright
  `mountpoint-explorer` + `phase7-11` + `p1-bulk` + `p1-rbac` + `quality` +
  `ui` PASS. `station-source` fail ở assert dữ liệu chất lượng (trạm #80
  không có sample, “Chưa có dữ liệu chất lượng trạm”), không liên quan thay đổi.

### 8.26. Chuẩn hóa drawer chi tiết trạm và relay (2026-11-01)

- Tạo component dùng chung `EntityDetail` (health block + 4 tab) và tách
  `EntityActivityPanel`, `EntityHistoryPanel`; trạm và relay dùng cùng bố cục:
  **Tổng quan / Dữ liệu / Chất lượng / Lịch sử**.
- Header giữ nguyên `EntityHealthPanel`: timestamp dữ liệu cuối + trạng thái
  hiện tại; tab Tổng quan chứa facts cơ bản, tab Dữ liệu có thanh
  online/offline/no-data + sự kiện + uptime, tab Chất lượng có biểu đồ số vệ
  tinh đặt đầu và phân tích RTCM, tab Lịch sử phân trang 100 dòng với lọc
  Lỗi/Cảnh báo/Thông tin.
- Relay có thêm bộ lọc luồng Nguồn (upstream) / Đích (downstream) ở tab
  Dữ liệu và Chất lượng.
- Thêm API `GET /api/relay-jobs/:id/activity` và
  `GET /api/relay-jobs/:id/history`; thêm `level` cho history trạm.
- Cập nhật `docs/api.md`, test Playwright `station-detail`; `tsc` frontend +
  build PASS; server Vitest 52/53 (1 fail có sẵn ở `transportStatusFor`,
  không liên quan thay đổi này).

### 8.27. Timeline trạng thái + sky plot/SNR (2026-11-01)

- Thêm `server/src/lib/statusTimeline.ts`: online ≤5 giây, không có dữ liệu
  ≤10 phút, sau đó offline; cắt theo `created_at`/`deleted_at`; trả bucket,
  uptime, online, offline, current. Có 5 test đơn vị.
- Thêm `GET /api/stations/:id/timeline` và
  `GET /api/relay-jobs/:id/timeline` (lọc `direction`), kèm series vệ tinh,
  độ trễ, C/N0. Áp dụng cùng ngưỡng cho danh sách trạm, bản đồ và relay.
- Frontend: header chỉ còn timestamp hiện tại + badge trạng thái (relay có
  Nguồn/Đích); tab Dữ liệu dùng thanh 1h/24h/7d/1m, màu online/offline/no-data,
  uptime/online/offline và biểu đồ theo thời gian; bỏ khối kết nối.
- Tab Chất lượng còn sky plot, CNR theo vệ tinh/băng và điểm 6 thành phần.
- Go: retention mẫu chất lượng 35 ngày; parse ephemeris
  1019/1020/1042/1044/1045/1046; tính quỹ đạo, azimuth/elevation từ ARP;
  lưu CNR theo epoch/vệ tinh/băng trong snapshot.
- Đã kiểm tra luồng thực tế: chưa thấy ephemeris trong `rtcm_message_stats`,
  nên sky plot sẽ trống cho tới khi nguồn phát 1019/1020/1042/1044/1045/1046.
- Kiểm tra: server `tsc` + build PASS; frontend `tsc` + build PASS;
  `go test ./...` + `go vet ./...` PASS; Vitest 58/58 PASS; Playwright
  `quality`, `station-detail`, `metrics-health` relay PASS.

### 8.28. Tỷ lệ online, tooltip, score 10 phút và sky plot thật (2026-11-01)

- Tab Dữ liệu: đổi “Uptime” thành **Tỷ lệ online** = online / (online +
  offline + no_data), hiện `—` khi tổng bằng 0; thêm thời lượng **Không có dữ
  liệu**; gộp bucket thành đoạn, hover tô sáng đoạn và hiện thời gian/trạng
  thái/thời lượng; thêm danh sách toàn bộ đoạn.
- Biểu đồ: offline/no-data/trước khi tạo đều vẽ `0`, không còn đứt đoạn; mỗi
  biểu đồ có crosshair + tooltip theo con trỏ (vệ tinh, độ trễ, C/N0).
- Go: điểm chất lượng tính lại mỗi 10 phút (`QUALITY_SCORE_INTERVAL_SEC=600`; đã đổi thành 5 giây ở 8.29);
  chỉ ghi lịch sử khi điểm đổi, không toast. Lịch sử trạm và relay đều ghi
  `quality_score`.
- Sky plot: thử trực tiếp nguồn NTRIP do người dùng cung cấp; luồng có
  ephemeris 1019/1020/1042/1044/1046. Sau 90 giây analyzer nhận 30 vệ tinh,
  87 tín hiệu CNR và 23 điểm sky plot. Đã tạo trạm test 484 để kiểm tra
  end-to-end rồi xóa.
- Thêm danh sách “Vệ tinh đang quan sát” trong tab Chất lượng: hiện mọi vệ
  tinh có CNR, kèm băng và trạng thái có/chưa có ephemeris.
- Rebuild container `gnss` để áp dụng ephemeris/orbit/score interval.
- Kiểm tra: Playwright `station-detail`, `quality`, `metrics-health` relay PASS.

### 8.29. Sửa trạng thái online/no-data/offline và score realtime (2026-11-01)

- Nguyên nhân lỗi: trạng thái được tính ở nhiều nơi (live Go, mẫu 60s,
  connection interval); bảng `station_source_sessions` chưa migrate; container
  `gnss` chưa ghi session; timeline bật `hasConnectionInfo` nhưng connections
  rỗng nên đánh all offline; bucket 10s/60s che mất đoạn ngắn.
- Thêm session NTRIP client: bảng `cors_runtime.station_source_sessions`, Go
  ghi start/end, đóng session cũ khi service restart.
- Thêm API nội bộ `/internal/station-source/reconcile`; Node gọi ngay khi
  enable/disable/lock/unlock để đóng/mở session tức thời.
- Timeline: 10 giây no-data tính từ lúc mất kết nối; kết nối còn nhưng không có
  dữ liệu thì giữ no-data; chưa từng kết nối thì offline; bucket dùng mốc giữa
  để phản ánh session bắt đầu/kết thúc trong bucket; series vẫn 0 khi offline.
- Đồng bộ trạng thái list/detail/timeline qua cùng helper connection-aware.
- Score realtime mỗi 5 giây (`QUALITY_SCORE_INTERVAL_SEC=5`), chỉ giữ trong RAM;
  log warning khi <30, error khi =0, recovery khi >=30; ghi
  `quality_alerts` và tab Lịch sử, không toast.
- Kiểm tra: Go test/vet PASS; Vitest 58/58; frontend build PASS; Playwright `station-detail`, `quality`, `metrics-health` relay PASS.

### 8.30. Polling bảng, danh sách trạng thái và số liệu timeline (2026-11-01)

- Các bảng trạng thái streaming (trạm, relay, mountpoint, NTRIP account,
  online list) luôn refetch định kỳ 5–10 giây, không phụ thuộc Socket.IO để
  tránh phải tải lại trang.
- Danh sách thay đổi trạng thái trong tab Dữ liệu đảo thứ tự mới nhất trước,
  hiển thị 10 đoạn/lần và nút “Xem thêm 10 đoạn”; không phân trang.
- Số liệu timeline được tính ở độ phân giải mịn (10 giây cho 1h/24h, 60 giây
  cho 7d/1m) tách khỏi bucket hiển thị, nên `online + offline + no_data` khớp
  nhau giữa các khoảng. Đã đối chiếu 7d và 1m cho cùng kết quả.
- Kiểm tra: Vitest 58/58; frontend build PASS; Playwright `station-detail`,
  `quality`, `metrics-health` relay PASS.

### 8.31. Tổng hợp thay đổi trước commit (2026-11-01)

- Nguồn trạm NTRIP client: `station_source.go`, `station_position.go`,
  migration `runtime/006_station_source_sessions.sql`, session start/end và
  reconcile tức thời khi tắt/bật/lock/unlock trạm.
- Migration bổ sung: `admin/026_relay_job_lock.sql`,
  `admin/027_entity_enabled_at.sql`; helper `server/src/lib/dataUptime.ts`.
- Drawer dùng chung `EntityDetail`; timeline `statusTimeline.ts`; history
  phân trang 100; activity/history/timeline API cho trạm và relay.
- Quality Go: ephemeris `1019/1020/1042/1044/1045/1046`, orbit/az-el,
  `skyPlot`/`signalsCnr`; retention 35 ngày; score realtime 5 giây; alert
  `quality.score_low`/`quality.score_zero` + recovery.
- Relay: direction status, timeline/history/activity, async downstream writer,
  NTRIP error line rõ hơn; job #227 được cập nhật credential theo NTRIP client
  của trạm và hiện streaming.
- Frontend: bảng trạng thái refetch 5–10 giây; chart tooltip, số vệ tinh
  nguyên; danh sách thay đổi mới nhất trước, 10 bản ghi/lần.
- Kiểm tra: `go test ./...` + `go vet ./...` PASS; Vitest 58/58 PASS;
  frontend `tsc` + build PASS; Playwright `station-detail`, `quality`,
  `metrics-health` relay PASS.

## 9. Nhật ký thay đổi

| Giai đoạn | File/khu vực | Ghi chú |
|---|---|---|
| Phase 0 | AGENTS/TASKS/SESSION/README/.env.example/.gitignore | Đã commit |
| Phase 1 | `docker-compose.yml`, `db/`, `server/`, `gnss/`, `frontend/` | Skeleton + RBAC |
| Phase 1 | `docs/api.md`, `.env.example`, `.gitattributes` | API contract, env, LF |
| Phase 1 | `server/src/routes/webUsers.ts`, `roles.ts`, `mountpoints.ts`, `app.ts`, `lib/validation.ts` | Rà soát + sửa 7 lỗi |
| Phase 2 | `db/migrations/*/002_*`, `server/src/routes/relayJobs.ts`, `server/src/lib/*` | Schema + API relay |
| Phase 2 | `gnss/internal/{relay,ntrip,rtcm,nmea,secret,proxy,api}`, `cmd/corsd` | Bridge + HMAC |
| Phase 2 | `scripts/mock-ntrip`, `scripts/fixtures`, `scripts/e2e-relay-mock.ps1` | Mock + E2E |
| Phase 6 | `docs/0/RTCM_QUALITY_PLAN.md`, `KE_HOACH`, `TASKS`, `CAC_BUOC`, `api.md` | Kế hoạch chất lượng trạm/relay |
| Phase 3 | `server/src/routes/ntripAccounts.ts`, `db/migrations/admin/003_*` | NTRIP + ACL |
| Phase 3 | `server/src/db/importRelay.ts`, `scripts/fixtures/relay-config.sample.json` | Import relay |
| Phase 3 | `gnss/internal/relay/retention*.go`, `cmd/corsd` | Retention |
| Phase 3 | `frontend/src/pages/{RelayJobs,Mountpoints,NtripAccounts}.tsx` | UI Phase 3 |
| Phase 3 | `server/src/lib/tombstone.ts`, `routes/relayJobs.ts`, `db/importRelay.ts`, `docs/api.md` | Fix soft-delete chặn recreate + import force row xóa |
| Phase 3.5 | `docs/0/UI_UX_PLAN.md`, `KE_HOACH`, `TASKS`, `CAC_BUOC`, `AGENTS` | Kế hoạch UI/UX Foundation |
| Phase 3.5 | `frontend/src/theme`, `components/{ui,Layout,ThemeToggle,ToastProvider}.tsx`, `styles.css` | Shell + dark mode + components |
| Phase 3.5 | `frontend/src/pages/*`, `lib/useListParams.ts` | Refactor CRUD/pagination |
| Phase 3.5 | `frontend/tests/ui.spec.ts`, `playwright.config.ts` | Playwright 2/2 |
| Phase 4 | `db/migrations/{admin/004,runtime/003}_caster*.sql` | Caster schema + listener 1509 |
| Phase 4 | `gnss/internal/caster`, `cmd/corsd`, `internal/api` | Caster Go + internal API |
| Phase 4 | `server/src/routes/caster.ts`, `lib/caster.ts`, `app.ts` | Caster API |
| Phase 4 | `frontend/src/pages/Caster.tsx`, `App.tsx`, `Layout.tsx` | Caster UI |
| Phase 4 | `frontend/vite.config.ts` | Hot reload polling 1s |
| Phase 5 | `db/migrations/admin/005_alerts_settings.sql` | Alerts/settings + permission |
| Phase 5 | `server/src/realtime/*`, `routes/{alerts,history,snapshot}.ts`, `lib/alerts.ts` | Socket.IO + API Phase 5 |
| Phase 5 | `frontend/src/realtime/*`, `pages/{Dashboard,Alerts,History}.tsx`, `Layout/App/types`, proxy | UI realtime/history/alerts |
| Phase 5 | `scripts/{backup,restore,load-test}-*.ps1`, `docs/OPS.md`, `docs/api.md` | Ops + tài liệu |
| Phase 5 | `server/tests/realtime.test.ts`, `frontend/tests/realtime.spec.ts` | Test realtime/scope/socket |
| Phase 6 | `gnss/internal/quality/*`, `db/migrations/{admin/006,runtime/004}_*` | Parser/analyzer/store + schema |
| Phase 6 | `server/src/{routes/quality.ts,lib/quality.ts,lib/csv.ts,realtime/qualityBus.ts}` | REST/RBAC/socket quality |
| Phase 6 | `frontend/src/components/{QualityPanel,charts}.tsx`, `pages/{Stations,RelayJobs}.tsx` | Panel nhúng popup, bỏ menu quality |
| Phase 6 | `frontend/tests/quality.spec.ts`, `server/tests/quality.test.ts` | Test UI embedded + API |
| Hotfix | `frontend/Stations.tsx`, `server/routes/{stations,relayJobs}.ts`, `admin/001,002,007`, `seed.ts`, `.env.local` | Default port 1509 |
| Phase 6 | `gnss/internal/probe/*`, `gnss/cmd/corsd/main.go`, `quality/{analyzer,parse}.go` | Probe runner + aggregate chòm sao |
| Phase 5 | `server/src/routes/audit.ts`, `frontend/src/pages/{History,Dashboard,Roles}.tsx` | Audit API/tab + sửa role + recent activity |
| Test | `scripts/load-test-mock.ps1` 50 job | 50/50 streaming PASS; real 2 relay/2 station |
| Docs | `docs/0/PHASES_7_12_PLAN.md`, `TASKS`, `KE_HOACH`, `CAC_BUOC`, `UI_UX_PLAN`, `RTCM_QUALITY_PLAN`, `README`, `AGENTS`, `SESSION` | Menu/UI field spec + quyết định D50–D53 |

## 10. Cập nhật lần cuối

- 2026-11-01 (Asia/Ho_Chi_Minh, +07:00)

## 11. Station source `ntrip_client` — runner, GGA, trạng thái

- `gnss/internal/relay/station_source.go`: runner đọc `station_sources`
  (`source_role='ntrip_client'`), tái dùng `toNtripEndpoint`, `ntrip.Get`,
  `NewBackoff`, `classify` và NMEA của relay. Idle timeout 30s, tự kết nối lại,
  reset backoff khi phiên nhận dữ liệu ≥10s, reload khi đổi cấu hình.
- `gnss/internal/relay/station_position.go`: bóc frame RTCM3, lấy toạ độ
  1005/1006 để gửi GGA. Ưu tiên `client_gga_lat/lon`, rồi `stations.lat/lon`,
  cuối cùng là 1005/1006 trong luồng.
- `server/src/routes/stations.ts`: list + detail dùng chung `applyLiveStatus`.
  Live chỉ áp dụng khi trạm đang bật; trạm tắt/khóa luôn `offline`/`disabled`
  và bỏ qua snapshot cũ trong RAM Go. Khi dùng live thì điểm/trạng thái/dữ liệu
  cuối lấy cùng nguồn, không trộn mẫu DB 60s.
- `server/src/routes/quality.ts`: `/stations/:id/quality` trả `live=[]`,
  `latest=null` khi trạm tắt; `/quality/overview` loại trạm tắt khỏi cả mẫu cũ
  và live.
- Test: `station_source_test.go`, `station_position_test.go` (mock caster,
  reconnect, stall, đổi cấu hình, GGA từ cấu hình và từ 1006).
- Kiểm chứng thật 2026-11-01: station 480 TestHauLoc (rtktk.online/THA_HauLoc)
  `streaming`, GGA gửi với `19.999947,105.969244`; không có lần đứt trong thời
  gian theo dõi.
- Kiểm chứng tắt/bật qua API superadmin:
  - Trước: LIST=online, DETAIL=online, quality live=1, overview có trạm.
  - Tắt: LIST=offline, DETAIL=offline, quality live=0/latest=null, overview=0.
  - Bật lại: LIST=online, DETAIL=online, quality live=1, overview có trạm.
- `npm test` server: 58/58 PASS; `go test ./...` + `go vet ./...` PASS.
- Còn lại: nhãn "Nguồn dữ liệu" trong drawer dùng `stations.source_type`
  (`manual`) nên hiện "Thủ công" dù bảng hiện "NTRIP client"; chưa phát lại
  luồng ra mountpoint caster của trạm.

## 12. Sửa Unicode tầng source + lỗi cú pháp chặn build (2026-11-01)

- Triệu chứng: UI vẫn hiện nhãn no_data lỗi dù DB đã sạch sau mục 2.
- Nguyên nhân source:
  - `frontend/src/components/StationDetailDrawer.tsx` dòng 36 và
    `frontend/src/pages/RelayJobs.tsx` dòng 81: ký tự U+FFFD trong nhãn
    `no_data`.
  - `server/src/routes/stations.ts` 6 dòng mojibake CP1258 (UTF-8 bị decode
    Windows-1258): owner ngoài phạm vi/không tồn tại, `${label}` không hợp lệ,
    `Đến ngày`, `Từ ngày`, `Bởi ... hệ thống`.
- Đã sửa bằng script Node UTF-8, chỉ thay đúng literal:
  `'không có dữ liệu'`, `'Chủ sở hữu ngoài phạm vi quản lý'`,
  `'Chủ sở hữu không tồn tại'`, `` `${label} không hợp lệ` ``, `'Đến ngày'`,
  `'Từ ngày'`, `` `Bởi ${String(row.actor_name || 'hệ thống')}` ``.
- Kiểm tra:
  - Quét 3 file: 0 U+FFFD / 0 mojibake.
  - Quét toàn repo (frontend/server/gnss/scripts/db/docs): 0 lỗi runtime;
    các hit còn lại chỉ là mẫu test cố ý `frontend/tests/p1-unicode.spec.ts`
    và ví dụ lịch sử trong `docs/1/03_CAC_BUOC_THUC_HIEN_P1.md`; giữ nguyên.
  - Vite phục vụ module frontend đã đúng; `npm run build` frontend PASS.
  - Server: watch không nhận thay đổi bind mount Windows; build thủ công.
    Build lộ lỗi cú pháp có sẵn trong working tree: `stations.ts` lặp body
    `probeMap` (dòng 499–509) → TS1128. Đã xóa đúng khối lặp 12 dòng, build lại
    `Found 0 errors`, container healthy, `dist/routes/stations.js` chứa đủ 6
    chuỗi đúng.
- Test hiện tại:
  - `docker exec -w /app cors-mvp-server-1 npm test`: 56/58 PASS; 2 FAIL ở
    `server/tests/statusTimeline.test.ts` (file mới/untracked, logic timeline
    hiện tại, không liên quan Unicode):
    - "uses 10 seconds from disconnect before offline": bucket[0] trả `no_data`,
      test mong `online`.
    - "falls back to data age when connection tracking is unavailable":
      bucket[1] trả `offline`, test mong `no_data`.
  - `docker exec -w /app cors-mvp-web-1 npm run build`: PASS.
- Ghi chú: working tree đang có CRLF khác HEAD (LF) và nhiều thay đổi chưa
  commit; diff lớn không phải do sửa Unicode. Không sửa `docs`/test marker cố ý.
- Lệnh kiểm tra nhanh:
  - `node C:\Users\ADMIN\AppData\Local\Temp\opencode\inspect_source_unicode.js`
  - `node C:\Users\ADMIN\AppData\Local\Temp\opencode\scan_repo_unicode.js`
  - `docker exec -w /app cors-mvp-server-1 npm run build`
  - `docker exec -w /app cors-mvp-web-1 npm run build`

## Kế hoạch 07 — Menu Hệ thống & bảo trì

- P07-0 DONE: `/system` với tab Sức khỏe (mặc định) / Tối ưu / Tự động hóa;
  `/system/health` redirect `/system?tab=health`; menu đổi "Sức khỏe" →
  "Hệ thống"; tách `HealthTab`, xóa `SystemHealth.tsx`; placeholder 2 tab mới.
  Test: server build PASS, frontend build PASS, Playwright
  `system-health` + `navigation` 2/2 PASS.
- Cách chạy E2E local: đọc `SEED_SUPERADMIN_PASSWORD` từ `.env.local` gán vào
  `E2E_PASSWORD` (không in giá trị), rồi `cd frontend; npx playwright test ...`.
- Lưu ý: Vite trong container cần `docker compose restart web` để nạp file mới.
- P07-1 DONE: migration `admin/034_maintenance.sql` (11 job + settings + runs +
  2 quyền `system_ops.*`); seed.ts + matrix.ts; bỏ retention khỏi `.env.example`.
  Kiểm tra DB: jobs=11, settings=1, perms=2, super_admin=2 grant, admin/user=0.
  Server build PASS, vitest 74/74 PASS.
- P07-2 DONE: `server/src/lib/systemOptimize.ts` + `GET /api/system/optimize`
  (quyền `system_ops.view`); bảng admin/runtime, pool, đĩa, Go quality/relay,
  backlog retention, gợi ý rule-based; cache 20s; performance_schema tắt →
  `available:false`. Test: build PASS, vitest 80/80; API superadmin 200
  (11 job). Admin API 403 BLOCKED do thiếu mật khẩu local khớp; matrix test PASS.
- P07-3 DONE: `maintenanceConfig.ts` (đọc/validate/ghi DB, cache, optimistic),
  `maintenance.ts` (dry-run, batch, lock 409, runs + audit, scheduler admin,
  reconcile Go), routes jobs/settings/runs/run; scheduler khởi động trong
  `index.ts`. Test: build PASS, vitest 88/88; API jobs=11, PUT 365→366→365,
  dry-run ok, runs.total=1, validation 400. Runtime prune 502 chờ P07-4.
- P07-4 DONE: package `gnss/internal/maintenance` (đọc config admin, prune
  runtime, runner interval, status/prune/reconcile internal HMAC); prune thêm
  `caster_connections`, `station_source_sessions`, `rtcm_message_stats`; kiểm
  tra admin schema >=34; bỏ retention khỏi `config.go`/`main.go`. Go test/vet
  PASS; rebuild gnss healthy; runtime dry-run 200, PUT reconcile 200, internal
  status 11 job, optimize backlog 11/11. Đã sửa lỗi dùng nhầm admin DB để prune.
- P07-5 DONE: OptimizeTab (cards Database/Retention/Go/Node-Đĩa, gợi ý, bảng
  lớn, slow query) + AutomationTab (11 job, sửa cấu hình, dry-run/chạy thật,
  lịch chạy, lịch sử phân trang, filter). CSS tách `frontend/src/system.css`.
  FE build PASS; Playwright `system-ops` 2/2 (superadmin + user1 403/không thấy
  tab); `system-health` + `navigation` PASS.
- P07-6 DONE: server build + 88/88 test; Go vet/test PASS; FE build PASS;
  Playwright P07 4/4 PASS. Full Playwright 21 pass / 17 fail / 4 skip — FAIL
  ngoài P07 do dữ liệu test/marker và thiếu mật khẩu admin local; không có
  FAIL menu/tab P07. `graphify update .` 3493 nodes/8326 edges/244 communities.
  Docs `OPS.md`/`AGENTS.md`/`TASKS.md`/plan 07 đã cập nhật; không secret.
  Bổ sung: jobs API merge trạng thái Go (`running`/`lastStatus`/`lastRowsDeleted`)
  qua `/internal/maintenance/status`; UI hiển thị job runtime đang chạy.
- Realtime header: EntityStatusHeader (card Hiện tại + Trạng thái ở drawer Trạm/Relay) đồng bộ giờ máy chủ qua snapshot.ts của Socket.IO và tick 1s thay vì 30s; tiêu đề hiển thị trạng thái kết nối socket. FE tsc PASS.
- P11-1 DONE: `REALTIME_POLL_MS` mặc định 3000 (clamp 1000–10000), thêm
  `REALTIME_BASE_CACHE_MS` 1500; `loadBaseData()` cache TTL + in-flight dùng
  chung cho tick và `snapshot:request`. Server build PASS, vitest 119/119 PASS.
  Cách chạy: `cd server; npm run build; npm test`.
- P11-2 DONE: cache auth 45 giây/socket, revoke ngay qua room `session:<id>`
  (logout/đổi mật khẩu/khóa user), chỉ emit snapshot khi chữ ký đổi,
  `quality_alerts` LIMIT 100, sửa tick dùng `tenantIds`. Build PASS,
  vitest 19 file / 122 test PASS.
- P11-3 DONE: `caster.register()` giữ chỗ slot bằng `pending` rồi gọi
  `runtime.Start` ngoài `manager.mu`; thêm 2 test khoá/đồng thời. `go build`,
  `go vet`, `go test ./...` PASS. Lưu ý: host Windows không có cgo/gcc nên
  `go test -race` chưa chạy được, cần bổ sung trên CI Linux.
- P11-4 DONE: relay upstream + probe có `IdleTimeout` 60s (read deadline mỗi
  vòng đọc), caster bật TCP keepalive 30s và trần 500 kết nối / 50 mỗi IP.
  `go build`, `go vet`, `go test ./...` PASS (+3 test idle/limit).
- P11-5 DONE: `getMapConfig()` cache 45 giây + in-flight, invalidate khi lưu
  cấu hình bản đồ. Server build PASS, vitest 125/125 PASS.
- P11-6 DONE: `AsyncStore` ghi DB có timeout 4 giây + đếm `Failures`, health
  trả thêm `storeFailures`. Go build/vet/test quality PASS.
- P11-7 DONE: analyzer giới hạn queue theo byte (16 MB) và dọn target theo TTL
  600s; `Feed` không copy khi queue đầy. Go build/vet/test PASS (+2 test).
- P11-8 DONE: frontend bỏ state chết `qualityAlerts`, poll trùng giảm/loại,
  marker map cập nhật theo diff, thêm `staleTime` 30s, `AbortSignal`, clear
  timeout toast. `npm run build` PASS; Playwright 3 spec liên quan bị skip do
  thiếu biến E2E (không FAIL).
- P11-9 DONE: export trạm/người dùng chặn 20.000 dòng, geocode cache LRU
  1.000 entry, dashboard ops gộp COUNT theo nhóm, pool có connectTimeout.
  Server build PASS, vitest 21 file / 128 test PASS.
- P11-10 DONE: compose có `mem_limit`/`cpus` cho mysql/server/gnss, MySQL
  buffer pool 1G + max_connections 200, log rotation cho web. Kiểm tra:
  `docker compose config --quiet` → OK (không chạy `up`).
- Kế hoạch 11 hoàn tất 10/10 bước; nhật ký đầy đủ ở
  `docs/1/11_BAO_CAO_TOI_UU_TAI_NGUYEN.md` §12.
- Việc cần làm thêm: chạy `go test -race` trên CI Linux (host Windows thiếu
  cgo/gcc); chạy Playwright với biến E2E khi cần nghiệm thu UI.
- Cách chạy kiểm tra nhanh: `cd gnss; go build ./...; go vet ./...; go test ./...`
  và `cd server; npm run build; npm test` và `cd frontend; npm run build`.
- Ngưỡng sức khỏe Node: bỏ `heapUsed/heapTotal` (gây warn giả 80–95%), dùng
  `heapUsed` tuyệt đối (warn 400MB, error 700MB), `RSS %` giới hạn container
  (warn 70%, error 85%, `NODE_MEMORY_LIMIT_MB=1024` khớp `mem_limit: 1g`) và
  event-loop lag như cũ. Thêm `lib/memoryLimit.ts`; health/optimize trả thêm
  `rssPercent`, `memoryLimitBytes`; HealthTab/OptimizeTab hiển thị RSS và
  heap tuyệt đối. Test: server 21 file / 128 PASS, FE build PASS, compose
  config OK. Chi tiết: `docs/1/11_...md` §13.
- Hotfix: HealthTab/OptimizeTab coi các trường mới là tùy chọn (fallback
  `heapPercent`/`—`) để không crash khi frontend mới gặp backend cũ; đã
  `docker compose restart server` để nạp payload có `rssPercent`. Xác minh
  trong container: số liệu thực trả `ok`.
- Khảo sát 02/11 (read-only): `graphify update .` → 4109 nodes / 9409 edges
  / 288 communities (commit `5f349fe`); server build + vitest 128/128,
  Go build/vet/test, FE build PASS. Chạy lại Docker Compose để kiểm chứng:
  schema 35/7, 7 trạm/8 mountpoint/208 relay job (205 soft-delete),
  692 quality alert chưa resolve. Phát hiện live: `GET /api/mountpoints?q=...`
  trả 500 (`Unknown column 's.name'`); relay 227 `streaming` nhưng 0 frame;
  trạm 480 timeout/reconnect mỗi 30s (nhịp dữ liệu ~60s).
- Lập `docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md`: 16 lỗi chức năng
  (FIX-01..16) + rà soát lại `BAO_MAT_MA_NGUON.md` tại `5f349fe`
  (F-02/F-04/F-07/F-01/F-06/F-03/F-10/F-13/F-09 còn phải sửa; F-16 đã đóng;
  bỏ qua mục Info/Low không chặn deploy). Không sửa mã nguồn; stack Docker
  vẫn đang chạy sau khảo sát.
- Lập `docs/2/PROMPT_THUC_HIEN_KE_HOACH_FIX_LOI.md`: bộ prompt thi hành
  34 mục (16 FIX + 18 SEC, gồm SEC-F18) theo 5 đợt; quy trình 7 bước/mục
  (check tài liệu → code → test/fix → cập nhật tài liệu → cập nhật todo →
  commit → push), commit gộp 14 lô (C1–C14) thay vì 34 commit lẻ; bảng
  tiến độ bền `docs/2/THUC_HIEN_FIX_LOI.md`, chuẩn script PowerShell tiếng
  Việt UTF-8 BOM, quy tắc graphify tiết kiệm token. Chưa sửa mã nguồn.
- FIX-01 DONE (lô C1): tách `server/src/lib/mountpointList.ts` để câu COUNT
  mountpoint có `LEFT JOIN stations`, sửa 500 khi `?q=` tham chiếu `s.name`.
  Test: `cd server; npm run build; npm test` → 22 file/130 PASS. Live:
  `GET /api/mountpoints?q=DOCS` → 200/total=4; không `q` → total=8.
- FIX-02/03 DONE (lô C2): caster source có `SourceIdleTimeout` 60s
  (`CASTER_SOURCE_IDLE_TIMEOUT_SEC`, sàn 5s) và đóng lý do `timeout`; station
  source idle 30s cứng → 120s (`STATION_SOURCE_IDLE_TIMEOUT_SEC`, sàn 30s),
  log kèm station_id và byte cuối. Test: `cd gnss; go build ./...; go vet ./...;
  go test ./...` PASS (thêm 3 test caster/relay/config).
- FIX-04/05/06 DONE (lô C3): relay `StopTimeout` 15s + `waitJobDone` (hoãn
  start nếu phiên cũ chưa đóng); caster per-IP 200/trần 500; rover giới hạn
  dòng 1KB, idle 5 phút, `recover()` goroutine. Test: Go build/vet/test PASS.
- Đợt 1 gate: server 22 file/130 PASS, FE build PASS; Playwright
  `mountpoint-explorer` PASS, `station-source` FAIL do dữ liệu mẫu không có
  trạm "THA Hậu Lộc" (DB đang là `TestHauLoc`) — lỗi fixture có sẵn, không do
  thay đổi đợt 1.
- SEC-F02/04/07 DONE (lô C4): seed không ghi đè cột nghiệp vụ; credential
  trạm chỉ dùng lại khi trùng host/port/TLS, chặn loopback/link-local/multicast,
  kết nối bằng IP đã kiểm tra; import gọi `assertCanTarget` từng dòng, audit
  diff quyền. Test: server 26 file/138 PASS; live chặn `169.254.169.254` (400).
- SEC-F01 DONE (lô C5): migration admin 36 `must_change_password`; import đặt
  cờ, middleware chặn 403 ngoài auth/profile, đổi mật khẩu xoá cờ, UI chuyển
  `/profile` + banner. Live: QA login → stations 403 → đổi MK → 200; đã xoá
  user QA. Test: passwordPolicy PASS, server 138 PASS, FE build PASS.
- SEC-F10/13/09/18 + SEC-F06/03 DONE (gộp C6+C7): fail-fast production,
  cookie `__Host-`, HSTS; audit retry/fail-closed + audit login; `TRUST_PROXY`
  mặc định tắt; dummy Argon2 chống dò tài khoản; throttle xác thực sai caster;
  compose bind 127.0.0.1, TLS listener tùy chọn. Test: server 145 PASS,
  Go build/vet/test PASS.
- FIX-07..10 DONE (lô C8): resume relay dùng transaction + FOR UPDATE, chỉ xoá
  cờ pause khi nguồn không chặn; resolve quality alert khi xoá trạm/relay và
  purge alert mồ côi lúc khởi động; realtime fallback từ `relay_job_state` với
  cờ `stale` + banner; history lọc `direction` (mặc định upstream).
  Test: server 29 file/148 PASS.
- FIX-11..14 DONE (lô C9): grace 10s giữ rover khi source ngắt; `rootContext()`
  + recover internal API chống panic; credential lỗi chỉ bỏ job đó và health
  báo `relayDegraded`; chặn trùng downstream (409 `DOWNSTREAM_BUSY`, import
  báo theo dòng). Test: Go build/vet/test PASS (+5 test).
- FIX-15/16 DONE (lô C10): reset monitor + counters đầu session, backoff.Reset
  trước Next, cursor `lastSessionId` theo dòng đã fetch; timeline chỉ dùng mẫu
  `[at-window, at)`, uptime lấy mẫu số thời gian quan sát. Test: Go + server
  148 PASS.
- SEC-F08/15/19/21 DONE (lô C11): CSRF cho mapConfig; tile yêu cầu quyền
  `map.view` + rate-limit theo user; `/health` không lộ `err.message`; audit
  scope `own` chỉ trả id chính actor. Test: server 30 file/150 PASS.
- SEC-F14/12 DONE (lô C12): HTTP server Go có Read/Write/Idle timeout và
  MaxHeaderBytes; MySQL TLS tự bật với host public/FQDN, tắt nội bộ, ép bằng
  `MYSQL_TLS`. Test: server 31 file/153 PASS; Go config test PASS.
- SEC-F05 DONE (lô C13): secret `v2:<keyid>` + AAD `table:column:recordId`,
  tương thích `v1`, hỗ trợ `APP_ENC_KEY_PREVIOUS`; áp dụng cho
  `station_sources.client_password_enc` (Node + Go). Test: server 32 file/157
  PASS; Go secret/relay PASS.
- SEC-F11 DONE (lô C14): service `web-prod` (profile production) build từ
  `frontend/Dockerfile`, nginx non-root uid 101, read_only + tmpfs, bind
  127.0.0.1:8080, CSP/XFO/nosniff/Referrer/HSTS. Đã build và `curl -I` xác
  nhận header + user; sau test đã stop container web-prod.
- HOÀN TẤT 34/34 mục kế hoạch trước deploy (13 commit, 5f349fe..HEAD):
  FIX-01..16 + SEC-F01..F21 (trừ các mục Info/Low đã loại). Gate chốt:
  server build + 32 file/157 test PASS; Go build/vet/test PASS; FE build PASS;
  compose dev + production config OK; secret scan 0; graphify 4286 nodes/9817
  edges. Playwright: 9 PASS, 3 skip, 1 FAIL có sẵn (`auth-password-only`:
  superadmin chưa chọn công ty → 400 COMPANY_REQUIRED) và `station-source`
  cần fixture "THA Hậu Lộc" — cần cập nhật fixture E2E trước release.
- Việc còn lại: `go test -race` trên CI Linux; cập nhật fixture Playwright;
  chuyển dần secret v1 → v2 khi có recordId; theo dõi `relayDegraded`.
- Bảng tiến độ: `docs/2/THUC_HIEN_FIX_LOI.md` (34/34 DONE).

## Follow-up 2026-11-03 (5 lô)

Board: `docs/2/TODOS_FOLLOWUP.md`.

- Lô A DONE — Playwright fixtures & hạ tầng test:
  - `frontend/playwright.config.ts` tự nạp `.env.local`, map `SEED_*` →
    `E2E_*`; admin test mặc định `docs.admin` (tài khoản `admin` đã bị đổi
    mật khẩu khỏi `SEED_ADMIN_PASSWORD`).
  - `auth-password-only.spec.ts` viết lại thành test đổi mật khẩu thật ở
    `/profile`: đổi → đăng nhập lại bằng mật khẩu mới → khôi phục.
  - `scripts/seed-docs-fixtures.mjs` thêm trạm `DOCS-Trạm Hậu Lộc`,
    mountpoint `DOCS_HL_RTCM`, relay job `DOCS-Relay Hậu Lộc` (disabled);
    `station-source.spec.ts` dùng fixture thay vì tên cũ.
  - Sửa 15 lỗi có sẵn: thiếu `company_id` (p1-bulk, p1-mountpoint,
    p1-ntrip-acl, p1-relay-import, p1-station-fix, metrics-health), đếm
    pin/list cứng (map, map-upgrade, unified-map), admin lệch mật khẩu
    (company, p1-rbac), trạm 79 không còn (p1-unicode), form thiếu chọn công
    ty + assert xoá (ui), fixture/khôi phục trạng thái (entity-realtime).
  - Sản phẩm: relay import nhận `company_id`/`owner_web_user_id` trong dòng
    phẳng; resolve/purge `quality_alerts` qua internal API Go
    (`/internal/quality/resolve`, `/internal/quality/purge-orphans`) vì
    `cors_app` chỉ có SELECT trên `cors_runtime`.
  - Bằng chứng: Playwright **55/55 PASS** (31 file); server **33 file/160
    test PASS**; `server tsc --noEmit` PASS; `frontend npm run build` PASS;
    `go build ./...` PASS; Docker `server` + `gnss` rebuild/restart healthy.
- Lô B DONE — `relayDegraded`:
  - Go `/health` luôn phát `relayDegraded` + helper có 4 case test;
    `systemHealth` gọi `/health` song song, degraded → Go metric `warn`.
  - `useSystemHealth` dùng chung; `HealthTab` thêm card Relay; `Layout` banner
    `--warn` chỉ cho `system_health.view`.
  - Bằng chứng: Playwright **56/56 PASS** (3.3 phút); server **34 file/163
    test**; Go build/vet/test PASS; ảnh mobile 390 không tràn.
- Lô C DONE — race + CI:
  - `go test -race ./...` trong `golang:1.24`: toàn bộ package `ok`, không
    race (Windows thiếu gcc nên chạy bằng container).
  - `.github/workflows/gnss-race.yml` (push `main` + PR khi `gnss/**` đổi);
    cách chạy ghi ở `docs/OPS.md` §6.1.
- Lô D DONE — AAD read-path:
  - `relay/probe store` select id credential và giải mã bằng
    `secret.DecryptRecord` (AAD `relay_credentials:password_enc:<id>`; v1 vẫn
    đọc được); Node ghi v2 qua `lib/relayCredentials.ts` (INSERT lấy id rồi
    UPDATE trong transaction), route + CLI import dùng chung.
  - Sửa `relay/station_source.go`: trước đó dùng `DecryptWithAAD` nên secret
    v1 của `station_sources` không đọc được (station 480 lỗi
    "secret authentication failed"); nay stream lại.
  - Bằng chứng: Go test mới cho `DecryptRecord` + `scanJob` (v1/v2/sai id);
    server **35 file/170 test**; smoke tạo credential → DB `v2:0:`, decrypt
    đúng AAD; Playwright relay 4/4; `/health` `relayDegraded:false`.
- Lô E DONE — rotate secret:
  - `npm run rotate:secrets` (dry-run) + `--apply`; phạm vi
    `relay_credentials.password_enc`, `station_sources.client_password_enc`;
    fallback `APP_ENC_KEY_PREVIOUS`; verify từng dòng trong transaction.
  - Backup `cors_admin` 3.065.100 bytes ra `%TEMP%\opencode\db-backup\`
    (ngoài repo); apply 6/6; DB 5/5 + 1/1 v2; chạy lại dry-run = 0; restart
    gnss healthy, station 480 stream bằng v2.
  - Server **36 file/174 test**; quy trình ghi ở `docs/OPS.md` §6.2.
- Lưu ý: trạm 480 (`TestHauLoc`) trỏ caster công khai `rtktk.online` đang
  stream trong dev; không dùng cho test tự động (mock-first).

### Hotfix bản đồ 2026-11-03

- Triệu chứng: bản đồ xem được (tile cũ trong cache trình duyệt) nhưng zoom
  ra/vùng mới báo "Không tải được nền bản đồ"; log tile trả **403**.
- Nguyên nhân: SEC-F15 (lô C11) thêm `requirePermission('map','view')` cho
  tile proxy nhưng permission `map.view` chưa từng được seed/migration tạo,
  nên mọi tài khoản đều bị 403 khi tải tile mới.
- Sửa: migration admin **037_map_view.sql** thêm `map.view` và cấp
  `super_admin=all`, `admin/user=tenant`; seed bổ sung permission;
  `roleMatrix` cho `user` `map.view=tenant` (khôi phục quyền xem bản đồ như
  trước C11); test Playwright tải tile thật, chấp nhận 200/502 nhưng fail
  nếu 403.
- Kiểm chứng: schema admin 37; tile thật trả **200**; Playwright map +
  unified-map + realtime **7/7 PASS**; server 36 file/174 test PASS.

### Hotfix rò dữ liệu do cache phiên (2026-11-03)

- Triệu chứng: sau khi đăng xuất super_admin rồi đăng nhập admin/user, danh
  sách hiện dữ liệu toàn hệ thống vài giây rồi mới về đúng công ty.
- Tái hiện: superadmin xem 8 trạm → đăng xuất → login `docs.admin` (4 trạm) →
  mở "Danh sách trạm" bằng điều hướng SPA vẫn thấy **8 trạm** suốt ~10s cho
  tới lần refetch kế tiếp (không phát request mới lúc mount).
- Nguyên nhân: React Query cache (`staleTime 30s`, `gcTime 5m`) không được xoá
  khi phiên đổi; query key `['stations', ...]` không chứa danh tính người
  dùng nên dữ liệu của phiên trước được trả ngay, không refetch.
- Sửa: `AuthProvider` dùng `queryClient.clear()` trong `applySession` cho
  bootstrap/login/logout/refresh; `RealtimeProvider` reset snapshot/quality
  khi `user.id` đổi. Server vẫn scope đúng (test API công ty A/B đã có).
- Test: Playwright `p1-rbac.spec.ts` "đổi tài khoản không lộ dữ liệu công ty
  khác từ cache" (yêu cầu bảng về đúng số dòng trong 2s; trước fix là 10s).
- Graphify: `graphify update .` → 4402 node, 10098 cạnh, 311 community.

## Kế hoạch 12 — Relay chọn trạm (2026-11-03)

Kế hoạch: `docs/1/12_KE_HOACH_RELAY_CHON_TRAM.md`.

- Migration admin **038**: thêm `upstream_station_id`, `downstream_station_id`,
  `upstream_mountpoint_id`, `downstream_mountpoint_id` (không FK).
- Form relay chia 3 section; Mode là select `Nhập thủ công`/`Chọn trạm`;
  chọn trạm chỉ hiện đúng select trạm (+ mountpoint khi >1) và dòng tóm tắt.
- Chỉ chọn trạm ở một phía: phía còn lại tự về nhập thủ công, option bị khóa và
  form hiện banner; server trả `400 RELAY_SAME_STATION` nếu gọi thẳng.
- `GET /api/relay-jobs/station-options` trả trạm theo `stations.view`, kèm
  endpoint 2 hướng, không trả mật khẩu.
- Server resolve trạm: ưu tiên mountpoint nội bộ (`127.0.0.1` + port listener +
  tên mountpoint, credential `caster_*`), fallback `client_*` cho `ntrip_client`;
  copy mật khẩu kín sang `relay_credentials` (AAD mới).
- Relay do superadmin tạo có `company_id = NULL` (owner superadmin) nên scope
  tenant tự loại; đã lọc thêm ở relay của trạm và mountpoint explorer.
- Test: `server/tests/relayStation.test.ts` 5 case; Playwright
  `relay-station-mode.spec.ts` (3 section, đổi mode, banner, tạo relay bằng
  trạm). Gate: server **37 file/179 test**, frontend tsc/build, Playwright toàn
  bộ (ghi ở mục dưới).

## Bản đồ — zoom mặc định & nhãn quần đảo (2026-11-03)

- Bỏ auto-fit khi mở trang: bản đồ dùng đúng `center`/`zoom` trong cấu hình
  (mặc định 16.0/106.0, zoom 6); auto-fit chỉ chạy khi đổi bộ lọc/tìm kiếm.
- Nút **Về mặc định** đưa bản đồ về đúng center/zoom cấu hình thay vì chỉ xoá
  bộ lọc.
- Cấu hình bản đồ thêm **Hiện nhãn quần đảo** và **Zoom tối thiểu hiện nhãn**
  (mặc định bật, zoom 6, cho phép 3–12); API `map.config` tự điền mặc định cho
  dữ liệu cũ.
- Phủ nhãn **Quần đảo Hoàng Sa** / **Quần đảo Trường Sa** lên nền tile (che
  tên tiếng Trung), chỉ hiện khi zoom >= ngưỡng cấu hình.
- Test: server `map.test.ts` 11 case; Playwright `map-archipelago.spec.ts`
  (2 nhãn ở zoom 6, ẩn khi zoom ra 2 mức, hiện lại khi zoom vào).
- Hotfix zoom 2026-11-03: log tile có 522 response **429** do hạn mức 240/phút
  khi zoom nhanh. Nâng lên **1200/phút**, vượt hạn mức trả tile PNG trong suốt
  200 (`X-Tile-Proxy-Status: rate-limited`) thay vì 429; banner lỗi tile chờ
  1s và tự huỷ nếu có tile tải được (tránh nhấp nháy khi zoom). Smoke 1250
  request: 1200 tile thật + 50 tile trong suốt, không còn 429.

## Kế hoạch 13 — Chuyển dữ liệu hệ thống cũ

Kế hoạch: `docs/1/13_KE_HOACH_CHUYEN_DU_LIEU_CU.md`.

- Bước 0 DONE: backup `cors_admin` 3.672.151 bytes + `cors_runtime` 22.488.953
  bytes tại `%TEMP%\opencode\db-backup\` (ngoài repo); baseline 3 company/6
  user/8 trạm/9 mountpoint/13 relay/7 account/5 listener.
- Bước 1 DONE: caster hỗ trợ **nguồn không xác thực** (`SourceNoAuth` từ
  `station_sources.caster_requires_auth=0`) chỉ cho publish; đọc vẫn bắt buộc
  NTRIP account + ACL. UI trạm thêm `v1 (nguồn không xác thực)`.
  Gate: Go build/vet/test; server+frontend tsc; frontend build; Playwright
  `station-source` PASS; gnss rebuild healthy.
- Bước 2 DONE: `db:import-legacy` dry-run đọc `db/data` → 36 trạm, 31
  mountpoint, 32 mapping (26×1509 + 6×1508), 67 relay disabled, 3 account,
  0 cảnh báo; checksum `23a18b37…369ae`. Test 4 case; server 184 PASS.
  Đã sửa số liệu kế hoạch từ 35/36 về 31/32.
- Bước 3 DONE: `db:reset-legacy --apply` xoá runtime (10 bảng qua migrator) +
  alerts/audit/relay/station/mountpoint/account/session/user/company, bỏ
  listener ngoài 1508/1509; tạo WALLY + wally; listeners gán owner wally.
  Kết quả: 2 user, 1 company, 0 trạm/mountpoint/relay/account, 2 listener,
  audit 0; superadmin + wally login 200.
- Bước 4 DONE: `--apply-core` tạo 36 trạm, 31 mountpoint (1508=6, 1509=26),
  32 mapping, 31 station_sources no-auth, 3 NTRIP account + 27 ACL. Mock:
  publish no-auth 200, đọc thiếu account 401, đọc bằng `nguyen` 200, mountpoint
  1509 không lộ qua 1508 (404).
- Bước 5 DONE: `--apply-relays` tạo 67 relay disabled (giữ host cũ), 129
  credential v2+AAD; chạy lại idempotent (0 tạo/67 cập nhật); Go
  `relayDegraded=false`; superadmin và wally đều thấy 36/31/67/3.
- Bước 6 DONE: full Playwright trên DB fixture **60 passed/1 skipped**
  (`legacy-migration` skip theo env); reset + import lại trạng thái cuối rồi
  chạy `E2E_LEGACY_ONLY=1` → PASS. Counts cuối 1 company/2 user/36 trạm/
  31 mountpoint/32 mapping/67 relay (0 bật)/3 account/27 ACL/2 listener;
  server 184 test PASS; `relayDegraded=false`. Graphify 4510 node/10302 cạnh.
- Bước 7 DONE: cập nhật `docs/OPS.md` §10 (backup → reset → import → verify →
  rollback, relay disabled đến cutover), `SESSION.md`, `TASKS.md`.

### Dashboard — trạng thái trạm (2026-11-04)

- KPI Trạm đổi từ đếm cấu hình (`hoạt động/tắt/khóa`) sang trạng thái vận hành:
  **online / offline / khác**.
  - `online`: trạm bật, status active và có kết nối nguồn (`direction=source`) tới
    một mountpoint của trạm.
  - `offline`: trạm bật nhưng không có nguồn kết nối.
  - `khác`: trạm tắt hoặc khóa.
- Thêm `server/src/lib/stationHealth.ts` + test 3 case; `RawMountpoint` có
  `stationId`; ops dashboard dùng helper.
- Kiểm chứng: dashboard API `36 total/0 online/36 offline/0 khác`; mock publish
  `YBI_VanYen` → `1 online/35 offline`; server 188 test PASS; Playwright
  dashboard + legacy PASS; frontend build PASS.

## Form tài khoản NTRIP — Công ty dạng select (2026-11-03)

- `frontend/src/pages/NtripAccounts.tsx`: trường **Công ty** chuyển thành `Select`
  lấy danh sách từ `GET /api/companies`, chỉ hiện với `super_admin` (giống form
  người dùng web); khi sửa thì khóa vì server cấm đổi công ty. Bỏ hẳn trường
  **Đơn vị** (text `company`) khỏi form, bảng và drawer chi tiết; cột liên hệ
  trong bảng đổi thành **Liên hệ**.
- Khi tạo, gửi `company_id` (super admin); khi sửa không gửi để tránh
  `COMPANY_IMMUTABLE`.
- Kiểm tra: `frontend` `tsc --noEmit` PASS, `npm run lint` PASS.

## Relay GGA + NTRIP POST (2026-11-05)

- Nguyên nhân relay tới `rtk.taikhoandodac.vn` báo invalid: 67/67 `relay_jobs`
  có `lat/lon = NULL` và `nmea_interval_sec = 0` nên Go không gửi GGA; đồng thời
  POST downstream dùng `Content-Type: gnss/data` + `Transfer-Encoding: chunked`,
  khác CGBAS.
- Đã khôi phục `lat/lon` + `nmea_interval_sec=5` cho 67 relay từ
  `db/data/config.json`; `QNH_DongTrieu` lấy tọa độ trạm 21.0000000/107.3000000.
- Code: `nmea.GGAWithFix`; `relay.nmeaSender` gửi GGA ngay sau khi mở upstream,
  trước downstream; trạng thái 1=Single (chưa có dữ liệu/quá 30s), 2=DGPS,
  4=RTK Fixed, 5=RTK Float; jitter ±10%. NTRIP POST đổi sang raw
  `application/octet-stream`, bỏ chunked. Caster lọc NMEA khỏi source trước khi
  publish RTCM để không trộn vào luồng rover/relay.
- Test: `go test ./...` PASS; `go vet ./...` PASS; `TestSourcePostRaw`,
  `TestNMEAFixStateMachine`, `TestBridgeSendsInitialGGABeforeDownstream`,
  `nmea_filter_test.go` PASS.
- Deploy image `cors-gnss:prod` 2026-11-05: 10/10 trạm streaming 5 phút, CRC=0,
  score 99–100; relay 39/66 online, 43 relay có byte tăng, 12.15 MB up/down/5 phút.
- 12 relay lấy nguồn từ `rtk.taikhoandodac.vn`: 10 online/streaming; 2 relay
  `BGG_TpBacGiang`, `TQG_TPTuyenQuang` trả ICY 200 nhưng 0 byte dù đã gửi GGA
  (nguồn/trạm phía CGBAS không phát dữ liệu).
- 5 relay đích `rtk.taikhoandodac.vn` vẫn invalid vì mount cũ CMU3, KGG1, HUG2,
  TGG2, PYN6 không còn trong sourcetable 12101; cần CGBAS cấp tên mount + tài
  khoản mới trước khi sửa cấu hình.
- NTRIP rover sau GGA: tài khoản tạm 575/2101/BDH1 nhận HTTP 200, 1680 byte, byte đầu d3; xóa 204.
- Import relay: nếu file cũ có lat/lon nhưng thiếu `nmea_interval_sec`, importer mặc định 5s thay vì 0 (tránh tắt GGA khi import lại). Server 192 test PASS, `tsc --noEmit` PASS.

## Fix form 500 + bộ lọc + trạng thái fix (2026-11-05)

- Lỗi 500 khi lưu form nguồn trạm: `PUT /api/stations/:id/sources` dùng
  `const [accountRows] = await query()`; `query()` trả thẳng mảng rows nên khi
  trạm không có NTRIP account quản lý, `accountRows` là `undefined` và
  `accountRows[0]` ném lỗi. Đã sửa `stations.ts`; sửa luôn 2 chỗ tương tự
  trong `mountpoints.ts` và `lib/alerts.ts`.
- Lỗi 500 khi lưu form relay: cột JSON `relay_jobs.tags` nhận object từ DB và bị
  bind thành `[object Object]`. Thêm `jsonColumn()` chuẩn hóa string/object/
  null trước khi ghi; áp dụng cho create/update/import.
- `DOWNSTREAM_BUSY` giờ trả tên + ID relay đang giữ downstream, ví dụ:
  `Downstream http://servers.onocoy.com:2101/TNNVN đang được relay job "xuanai2" (ID 480) sử dụng`.
- Tách bộ lọc Trạm: `lock` (đã khóa/mở khóa) + `transport` (online/offline/
  no_data/đã tắt). Relay: `lock` + `state` (online/offline/no_data/pending/
  paused/disabled/locked). API lọc server-side, giữ phân trang.
- Trang Danh sách online: cột Trạng thái dùng `fixType` (fixed/float/single/
  RTD/lỗi) thay vì luôn "online"; thêm lọc theo hướng source/rover và trạng thái
  fix. Caster chỉ trả fixType cho rover, source để trống.
- Đã build/load/deploy `cors-server:prod`, `cors-web:prod`, `cors-gnss:prod`.
  Kiểm tra: PUT nguồn trạm 675 = 200; PATCH relay 479 = 200; lọc trạm online 21,
  offline 14; relay online 38, offline 27, disabled 2; connections fixed 19,
  error 3, none 22; enable 479 = 409 với thông báo nêu rõ xuanai2 (ID 480).

## daitu2 offline — nguyên nhân và fix (2026-11-05)

- Cấu hình hiện tại: upstream `rtktk.online:1508/TNN_DaiTu`, downstream
  `servers.onocoy.com:2101/TNNDT`, tài khoản upstream `aitogy123` (ID 539).
- Nguyên nhân 1: tài khoản 539 thiếu ACL mountpoint `666/TNN_DaiTu` trên caster
  mình → upstream trả `HTTP 403 Forbidden`.
- Nguyên nhân 2: sau khi thêm ACL, tài khoản chỉ cho `max_connections=1` nên
  gặp `HTTP 503 Maximum Connections Reached` vì các relay khác cũng dùng
  `aitogy123` để đọc cùng caster.
- Đã thêm ACL `666` (giữ nguyên `668/669/670/677`) và nâng
  `max_connections=20`.
- Kết quả: `daitu2` chuyển `streaming`; byte up/down tăng 5.117 byte/15 giây;
  41 relay đang streaming.

## Sourcetable mountpoint ABC (2026-11-05)

- `sourcetableMountpoints` trước đây duyệt map nên thứ tự ngẫu nhiên. Đã sort
  ABC không phân biệt hoa/thường, tie-break theo ID, trước khi build sourcetable.
- Áp dụng cho mọi listener (1508/1509/2101). Kiểm tra: 1508 6 mount, 1509 31
  mount, 2101 31 mount, tất cả `sorted=true`.
- Test `TestSourcetableMountpointsSortedABC` PASS; deploy lại `cors-gnss:prod`;
  41 relay vẫn streaming sau khi reconnect.

## Ổn định kết nối trạm & relay (2026-11-05)

### Đã sửa

- **Caster source takeover** (`gnss/internal/caster/listener.go`, `hub.go`):
  - Trạm reconnect cùng mountpoint không còn bị `409 Conflict`/chờ
    `SourceIdleTimeout` 60 giây; source mới được nhận ngay.
  - Source cũ bị đóng với lý do `source_replaced`, giải phóng slot account.
  - `publishFrom` chỉ nhận byte từ source hiện tại, tránh dữ liệu cũ xen vào.
- **Relay session lifecycle** (`relay/writer.go`, `job.go`):
  - `SessionStart` INSERT session mở khi bắt đầu (`end_ts NULL`,
    `result='streaming'`).
  - Khi kết thúc, UPDATE đúng row theo `relay_job_id + start_ts` (truncate ms),
    fallback INSERT nếu SessionStart bị drop.
  - `CloseStaleSessions` đóng session mồ côi lúc startup với
    `service_restart`; đã thấy log `closed 1 stale sessions` trên local.
- **Hourly/uptime**:
  - `splitSessionHours` chia `online_sec` theo giờ UTC, không còn dồn 7.811s
    vào bucket bắt đầu.
  - `GET /api/relay-jobs/:id` dùng `dataUptime` (quality_samples) cho uptime
    24h, nên session đang chạy vẫn được tính.
- **UI** (`frontend/src/pages/History.tsx`): phiên chưa kết thúc hiển thị
  **Đang chạy** thay vì `—`; tab Lịch sử không còn hiển thị lý do đóng giả.
- **Current status** (`server/src/routes/relayJobs.ts`): timeline lấy
  `metrics.state` từ Go; `streaming` mới xét tuổi dữ liệu, trạng thái khác trả
  `offline`. Không còn dòng “offline 10s” cuối timeline khi đang stream.
- **Retry-After 429** (`ntrip/ntrip.go`, `relay/job.go`): đọc header
  `Retry-After` (giây hoặc HTTP date), chờ tối đa 5 phút thay vì retry dồn dập.
- **Audit account dùng chung**: thêm `scripts/audit-ntrip-accounts.sql`; chạy
  read-only trên prod:
  - `nguyen`: 18 relay / max 50
  - `admin`: 14 relay / max 50
  - `aitogy123`: 5 relay / max 20
  - Không có account vượt `max_connections`.

### Test local

- `go test ./... -count=1` PASS (caster, relay, ntrip, toàn bộ).
- `go vet ./...` PASS.
- `go test -race ./...` trong `golang:1.24` Docker PASS.
- `TestSourceReconnectReplacesStaleSource`,
  `TestPublishFromIgnoresStaleSource` PASS.
- `TestSplitSessionHours`, `TestSplitSessionHoursSameHourAndZero`,
  `TestSplitSessionHoursCrossDay` PASS.
- `TestBufferedWriterSessionLifecycleMySQL` PASS với MySQL local:
  session mở → update đúng 1 row → duration 7.813s → hourly tổng 7.813s.
- `scripts/e2e-relay-mock.ps1` PASS 2 lần (capture byte, state streaming,
  session row đóng đúng).
- Server: `npm run build` PASS, `npm test` 40 file/192 test PASS.
- Frontend: `npm run build` PASS.
- Playwright targeted: `metrics-health`, `timeline`, `relay-state` 8/8 PASS.
- Local compose: `closed 1 stale sessions from previous run` khi restart gnss.

### Deploy VPS (2026-11-05)

- Commit/deploy: `f0c16c4` (stability), `06bd2e5` (GOPROXY override),
  `98b6967` (exclude open session khỏi error summary).
- Build gnss trên VPS gặp lỗi mạng Docker bridge khi tải Go module; build lại
  bằng `docker build --network=host --build-arg GOPROXY=https://goproxy.cn,direct`.
- `cors-prod-{gnss,server,web-prod}-1` healthy; `https://rtktk.online/` = 200.
- Verify:
  - Job `461`: `runtime_state=streaming`, open session `04:17:55.840`, 1 row.
  - Không có job nào có >1 open session.
  - Trạm `667` và relay `461`: frames tăng đều, `gaps=0`, `crc=0`,
    upstream/downstream khớp.
  - Không thấy lỗi 500 trong log server.
  - Deploy tạo reconnect đồng loạt: 3 job (`447`, `452`, `472`) nhận
    `429 Too Many Requests` ở lần thử đầu, sau đó tự reconnect; không còn 429
    sau ổn định. Đây là hiện tượng deploy-storm, không phải lỗi timeout.
- Lưu ý: row `relay_hourly` `01:00` với `online_sec=11483` là session cũ
  `01:18→04:17` do binary trước fix ghi; không backfill dữ liệu cũ. Session kết
  thúc sau deploy sẽ được chia đúng giờ.
- Rollback image cũ trước deploy:
  - server `sha256:4c70bc27a6ce92241207c6f8ccfbf0456e205c8aab65092f25fa9b84216d552d`
  - gnss `sha256:3c3f5e0f552093c4d7646d3f28658e0e93fc9de1cc888e66ca6857d0a73c570f`
  - web `sha256:bdc4f01aabd96679dc739fd3f32a7836e6f9b34d37f07505d2ae32748a961fe5`
  - git cũ `cc67f9d`

### Chưa làm

- Chưa có test UI riêng cho dòng “Đang chạy” (đã test API/DB + Playwright
  timeline/relay-state).
- Chưa backfill `relay_hourly` cũ; chỉ dữ liệu mới được chia đúng giờ.

---

## Plan 16 — Bước 1: Danh sách online chỉ tài khoản NTRIP (2026-11-05)

### Đã làm
- `GET /api/connections` chỉ trả `direction=rover` + `accountId`; bỏ query `direction`;
  loại item có username rỗng. `/api/caster/connections` giữ nguyên (source + rover).
- OnlineList: bỏ bộ lọc hướng, bỏ fallback `—`, nhãn "chưa gửi GGA".
- Go: `authorize()` từ chối username rỗng; `register()` từ chối rover không account;
  snapshot có `accountUsername`. Không đổi `SourceNoAuth`/`handleSource`.
- Test: Go `./internal/caster/...` PASS; vitest `casterListener` 7/7 PASS;
  frontend `tsc --noEmit` PASS.

### Chưa làm
- Playwright bổ sung sau: `navigation.spec.ts` đã PASS khi dựng stack local.
- Chưa chạy SQL kiểm chứng trên prod (chỉ chạy khi triển khai).

### Cách chạy
```powershell
cd gnss; go test ./internal/caster/...
cd server; npx vitest run tests/casterListener.test.ts
cd frontend; npx tsc --noEmit
```

---

## Plan 16 — Bước 2: z-index menu mobile vs bản đồ (2026-11-05)

### Đã làm
- `.map-shell` thêm `isolation: isolate; z-index: 0;` → overlay 1100–1400 không
  còn vượt ra ngoài trang bản đồ.
- Layout: Esc đóng drawer mobile.
- Test mới `frontend/tests/map-mobile-menu.spec.ts` (390x844, elementFromPoint).

### Chưa làm
- Playwright `map-mobile-menu.spec.ts` + `ui.spec.ts` đã PASS khi dựng stack local.
- Chưa kiểm tra thủ công 390/768 (Playwright đã phủ 390x844).

### Cách chạy
```powershell
cd frontend; npx tsc --noEmit
cd frontend; npx playwright test tests/map-mobile-menu.spec.ts tests/ui.spec.ts
```

---

## Plan 16 — Bước 3: Bản đồ MapLibre + lớp tài khoản (2026-11-05)

### Đã làm
- Thêm `renderer` vào `MapConfig` (default `leaflet`, không migration); Select trong
  Cấu hình bản đồ; tách `MapCanvas` → `LeafletCanvas` + `MaplibreCanvas` (lazy).
- MapLibre: raster tile proxy, marker trạm/tài khoản, popup, Fit/Reset, nhãn quần đảo
  bằng Marker DOM, attribution bắt buộc.
- `/api/map/overview`: thêm `accounts[]`, `counts.accounts`,
  `counts.accountsOutsideStations`, `truncated`; bucket `none` cho "chưa gửi GGA".
- Legend hiển thị tổng tài khoản + tài khoản ngoài trạm.

### Test
- vitest `map`, `mapAccountStatus`, `mapConfigCache`: 18/18 PASS.
- `tsc --noEmit`: PASS.
- Playwright: `navigation`, `map-mobile-menu`, `ui`, `map`, `map-config`,
  `unified-map`, `map-upgrade` → 11/11 PASS.
- Playwright mới: `map-maplibre.spec.ts` PASS; `map-accounts.spec.ts` PASS
  (`counts.accounts` khớp `/api/connections.total`).

### Cách chạy
```powershell
cd server; npx vitest run tests/map.test.ts tests/mapAccountStatus.test.ts tests/mapConfigCache.test.ts
cd frontend; npx tsc --noEmit
cd frontend; npx playwright test tests/map-maplibre.spec.ts tests/map-accounts.spec.ts
```

---

## Plan 16 — Bước 4: Optimize làm mới đúng (2026-11-05)

### Đã làm
- `getSystemOptimize({ fresh })`: bỏ cache khi `fresh`; thêm `computedAt`/`fetchedAt`.
- `/api/system/optimize?fresh=1`; OptimizeTab nút "Tải lại" gọi fresh, `staleTime: 0`,
  hiển thị hai mốc thời gian + nhãn "ước lượng" và ghi chú InnoDB.

### Test
- vitest `systemOptimize`: 6/6 PASS; `tsc --noEmit`: PASS.
- Playwright `system-ops.spec.ts`: 3/3 PASS (bắt request `fresh=1`).

### Cách chạy
```powershell
cd server; npx vitest run tests/systemOptimize.test.ts
cd frontend; npx tsc --noEmit
cd frontend; npx playwright test tests/system-ops.spec.ts
```

---

## Plan 16 — Bước 5: relay_events chống trùng + index (2026-11-05)

### Đã làm
- `BufferedWriter.Event`: tối đa 1 event/(jobID,type)/60s; số gộp ghi vào message
  event kế tiếp.
- Migration `db/migrations/runtime/008_relay_events_index.sql` thêm `(ts, id)`.
- Prune đổi `ORDER BY ts, id` (relay + maintenance) để dùng index.
- History tab Sự kiện: lọc theo `type` (URL `?type=`).

### Test
- `go test ./internal/relay/... ./internal/maintenance/...`: PASS (throttle 100→1).
- `tsc --noEmit`: PASS.
- Local migration applied; `EXPLAIN` dùng `idx_relay_events_ts`, `Using index`.
- Playwright `history-events` PASS; `relay-state` + `timeline` 6/6 PASS.

### Cách chạy
```powershell
cd gnss; go test ./internal/relay/... ./internal/maintenance/...
cd frontend; npx tsc --noEmit
cd frontend; npx playwright test tests/history-events.spec.ts tests/relay-state.spec.ts tests/timeline.spec.ts
```

---

## Plan 16 — Bước 6: Hướng dẫn tổng quát + deep-link (2026-11-05)

### Đã làm
- Thêm chương `docs-site/docs/02a-huong-dan-tong-quat.md` (slug
  `/huong-dan-tong-quat`) với 5 anchor và ảnh minh hoạ; nội dung host/port/
  mountpoint/username/password/NTRIP v2 + bảng lỗi.
- `guide.ts`: `guideUrl()`, `guideHref()` (validate slug/anchor).
- `Guide.tsx`: nhận `?doc=&anchor=`, iframe đổi `src` + `key`.
- Nút "Hướng dẫn" ở Trạm, Mountpoint, Tài khoản NTRIP.
- Playwright G9 kiểm tra deep-link từ cả 3 trang.

### Test
- `build-guide --check`: PASS (14 chương/19 route).
- `build-guide`: PASS, copy `frontend/public/guide`.
- `tsc --noEmit`: PASS.
- Playwright guide (trừ G5): 8/8 PASS.
- G5 chưa chạy: local DB thiếu `docs.admin`/`docs.user` (chỉ có `superadmin`).

### Cách chạy
```powershell
node scripts/build-guide.mjs --check
node scripts/build-guide.mjs
cd frontend; npx tsc --noEmit
cd frontend; npx playwright test tests/guide.spec.ts
```

---

## Plan 16 — Tổng kết (2026-11-05)

### Kết quả
- Hoàn thành 6/6 bước trên nhánh `feat/plan16`, đã push lên GitHub.
- Test cuối: Go 12/12 package OK; server 196/196; frontend tsc PASS;
  Playwright 68 PASS / 1 FAIL (test cũ `p1-station-fix` đổi `caster_username`
  bị 409 IMMUTABLE_FIELD, không liên quan plan 16) / 1 skipped.
- Graphify: 4907 nodes / 11066 edges.
- Migration mới: `db/migrations/runtime/008_relay_events_index.sql` (đã chạy local).
- Không secret trong diff; không đụng backup; không deploy.

### Cần làm khi lên VPS
1. Chạy migration runtime 008 (index `relay_events(ts,id)`).
2. `node scripts/build-guide.mjs` trước khi build/deploy frontend.
3. Kiểm tra `/online` không còn dòng `—`, `/map` đổi renderer được, tab Tối ưu
   "Tải lại" đổi số ngay, nút Hướng dẫn mở đúng mục.

### Lỗi tồn tại (không thuộc plan 16)
- `frontend/tests/p1-station-fix.spec.ts` gửi `caster_username` khác lúc tạo →
  API trả 409 `IMMUTABLE_FIELD`. Cần sửa test dùng đúng username hoặc bỏ field.

### Cập nhật sau tổng kết
- Hướng dẫn: dòng Port đổi thành "Xem trong CORS → Listener để biết port tương ứng
  (ví dụ 2101)", bỏ câu "1508/1509 chỉ để tương thích thiết bị cũ".
  Đã build lại `frontend/public/guide` và `build-guide --check` PASS.
- Bổ sung **Kế hoạch bổ sung 1** vào cuối `docs/1/16`: hai renderer cùng hoạt động,
  chuyển đổi qua lại, tự fallback khi lỗi (chưa triển khai).
  Nguyên nhân đã xác minh: build thiếu `maplibre-gl-worker.mjs`, dev thiếu worker,
  không có WebGL check/fallback, test Playwright quá yếu.
- Bổ sung **Kế hoạch bổ sung 2**: lớp ranh giới + tên 34 tỉnh, toggle trong
  "Nền bản đồ", áp dụng cả Leaflet/MapLibre (chưa triển khai).
  Lưu ý: file `vietnam-provinces.geojson` hiện chỉ nằm trong
  `frontend/public/guide/assets/map/` (thư mục build, gitignore) — phải copy sang
  `frontend/public/geo/` trước khi code, nếu không sẽ bị `build-guide` xoá.

### Kế hoạch bổ sung 1 — hai renderer + fallback (2026-11-05)

- Đã sửa: `vite.config.ts` (exclude optimizeDeps, worker es, copy worker plugin),
  `MapCanvas` (WebGL check + fallback), `MaplibreCanvas` (try/catch + timeout 8s),
  banner fallback ở `UnifiedMap`, test Playwright mạnh hơn.
- Bằng chứng: build PASS + worker 507.2 KB trong `dist/assets`;
  Playwright `map-maplibre` 3/3 PASS; hồi quy map 6/6 PASS.
- Chưa làm: kiểm tra trên trình duyệt/thiết bị thật ngoài Chrome.

### Kế hoạch bổ sung 2 — ranh giới & tên tỉnh (2026-11-05)

- Đã copy geojson về `frontend/public/geo/` (34 tỉnh, property `name`) + README nguồn.
- Thêm toggle **Ranh giới & tên tỉnh** trong "Nền bản đồ"; lưu URL `provinces=0`.
- Leaflet: geojson nét đứt + nhãn tâm bbox; MapLibre: line layer + nhãn DOM.
- Nhãn có nền trắng, bo góc; ẩn khi zoom < 6.
- Sửa nền MapLibre đúng provider: streets = OpenFreeMap Liberty (vector),
  satellite = Esri, terrain = OpenTopoMap; đổi mode dựng lại layer ứng dụng.
- Test: server 196/196; build PASS + worker ĐẠT; Playwright map 11/11,
  provinces 2/2, visual 1/1. Ảnh: `docs/1/evidence/plan16-map-{leaflet,maplibre}.png`.
- Chưa làm: hybrid/PMTiles/style_url (chưa có trong mô hình cấu hình hiện tại);
  giấy phép geojson chưa xác định.

---

## Mountpoint thủ công khi tạo trạm (2026-11-05)

### Đã làm
- Form tạo trạm: ô **Mountpoint** cho phép nhập tay; để trống thì tự sinh theo
  tên trạm (placeholder là tên dự kiến).
- Form sửa trạm vẫn read-only, ghi rõ không đổi tên sau khi tạo.
- API tạo trạm nhận `mountpoint_name`; kiểm tra rỗng/độ dài và trùng tên
  (409 `MOUNTPOINT_EXISTS`).
- `createStationResources` dùng tên người dùng nhập thay vì luôn tự sinh.

### Test
- `server/tests/stationNaming.test.ts`: 3/3 PASS.
- `frontend/tests/station-mountpoint-custom.spec.ts`: PASS (UI sửa được,
  API lưu đúng tên, trùng tên trả 409, cleanup).
- `p1-station.spec.ts`: PASS (không hỏng luồng tạo/sửa trạm).

### Cách chạy
```powershell
cd server; npx vitest run tests/stationNaming.test.ts
cd frontend; npx playwright test tests/station-mountpoint-custom.spec.ts tests/p1-station.spec.ts
```

---

## Script cập nhật VPS (2026-11-05)

- `update.sh`: pull main, backup MySQL (`/opt/cors/backup.sh`), build images,
  chạy migrate, `up -d`, health check + smoke test HTTPS.
- `hot_update.sh`: pull main, tự phát hiện service theo file thay đổi
  (web/server/gnss/stack), build + restart đúng service, không backup/migrate.
  Dừng nếu có migration hoặc repo bẩn.
- VPS: `/opt/cors/app`, branch `main`, compose `docker-compose.prod.yml`,
  HTTPS `https://rtktk.online/`.
- Chưa chạy deploy tại thời điểm ghi mục này (sẽ cập nhật sau khi chạy).


