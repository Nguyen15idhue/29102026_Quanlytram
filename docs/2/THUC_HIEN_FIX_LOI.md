# TIẾN ĐỘ THỰC HIỆN FIX LỖI TRƯỚC DEPLOY

- Kế hoạch: `docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md`
- Prompt thi hành: `docs/2/PROMPT_THUC_HIEN_KE_HOACH_FIX_LOI.md`
- Bắt đầu: 2026-11-03 17:05 +07
- Quy ước: TODO | ĐANG LÀM | DONE | BLOCKED | NOTE
- Commit: gộp theo lô C1–C14; cột Commit ghi hash chung, nhiều ID cùng hash hợp lệ.

| # | Đợt | Lô | ID | Trạng thái | Commit | Bằng chứng test | Ghi chú |
|---|---|---|---|---|---|---|---|
| 1 | 1 | C1 | FIX-01 | DONE | C1 | vitest 22 file/130 PASS; live q=DOCS 200/total=4, không q total=8 | — |
| 2 | 1 | C2 | FIX-02 | DONE | C2 | `go test ./internal/caster` PASS; 2 test idle/active | — |
| 3 | 1 | C2 | FIX-03 | DONE | C2 | relay/config PASS; cadence 60ms/150ms; mặc định 120s | — |
| 4 | 1 | C3 | FIX-04 | DONE | C3 | `TestWaitJobDone*` PASS; StopTimeout 15s | — |
| 5 | 1 | C3 | FIX-05 | DONE | C3 | per-IP 200/trần 500; test PASS | — |
| 6 | 1 | C3 | FIX-06 | DONE | C3 | rover 1KB + idle 5m + recover; 2 test PASS | — |
| 7 | 2 | C4 | SEC-F02 | DONE | C4 | seedUser test PASS; không ghi đè cột nghiệp vụ | — |
| 8 | 2 | C4 | SEC-F04 | DONE | C4 | outbound/sourceTarget PASS; live chặn 169.254.169.254 | — |
| 9 | 2 | C4 | SEC-F07 | DONE | C4 | assertCanTarget từng dòng; server 138 PASS | — |
| 10 | 2 | C5 | SEC-F01 | DONE | C5 | migration admin 36; live 403 → đổi MK → 200 | — |
| 11 | 3 | C6 | SEC-F10 | DONE | C6 | fail-fast production; __Host-; HSTS | — |
| 12 | 3 | C6 | SEC-F13 | DONE | C6 | audit retry + fail-closed; login audit | — |
| 13 | 3 | C6 | SEC-F09 | DONE | C6 | TRUST_PROXY mặc định tắt | — |
| 14 | 3 | C6 | SEC-F18 | DONE | C6 | dummy Argon2; 401 thống nhất | — |
| 15 | 3 | C7 | SEC-F06 | DONE | C7 | throttle (user,IP)+global; 2 test | — |
| 16 | 3 | C7 | SEC-F03 | DONE | C7 | bind 127.0.0.1; TLS tùy chọn | — |
| 17 | 4 | C8 | FIX-07 | DONE | C8 | resume FOR UPDATE; reset pause | — |
| 18 | 4 | C8 | FIX-08 | DONE | C8 | resolve + purge alert mồ côi | — |
| 19 | 4 | C8 | FIX-09 | DONE | C8 | fallback state + stale + banner | — |
| 20 | 4 | C8 | FIX-10 | DONE | C8 | lọc direction; test PASS | — |
| 21 | 4 | C9 | FIX-11 | DONE | C9 | grace 10s giữ rover; 2 test | — |
| 22 | 4 | C9 | FIX-12 | DONE | C9 | rootContext + recover API | — |
| 23 | 4 | C9 | FIX-13 | DONE | C9 | skip job lỗi, relayDegraded | — |
| 24 | 4 | C9 | FIX-14 | DONE | C9 | 409 DOWNSTREAM_BUSY; test | — |
| 25 | 5 | C10 | FIX-15 | DONE | C10 | reset monitor/backoff/cursor | — |
| 26 | 5 | C10 | FIX-16 | DONE | C10 | framesAt cửa sổ quá khứ; uptime mẫu số | — |
| 27 | 5 | C11 | SEC-F08 | DONE | C11 | CSRF mapConfig | — |
| 28 | 5 | C11 | SEC-F15 | DONE | C11 | map.view + rate-limit tile | — |
| 29 | 5 | C11 | SEC-F19 | DONE | C11 | health bỏ err.message | — |
| 30 | 5 | C11 | SEC-F21 | DONE | C11 | own = [userId]; test PASS | — |
| 31 | 5 | C12 | SEC-F14 | DONE | C12 | HTTP Go timeout/header | — |
| 32 | 5 | C12 | SEC-F12 | DONE | C12 | TLS MySQL auto + override | — |
| 33 | 5 | C13 | SEC-F05 | DONE | C13 | AAD v2 + rotation; station_sources | — |
| 34 | 5 | C14 | SEC-F11 | DONE | C14 | web-prod non-root; header đủ; bind loopback | — |

## Nhật ký quyết định

- 2026-11-03 17:03 +07: Baseline PASS — server build + vitest 21 file/128 test;
  Go build/vet/test PASS; frontend build PASS.
- 2026-11-03 17:05 +07: Bắt đầu Đợt 1, mục FIX-01 (lô C1).
- 2026-11-03 17:08 +07: FIX-01 DONE (C1). Tiếp theo: FIX-02 (C2).
- 2026-11-03 17:11 +07: FIX-02, FIX-03 DONE (C2). Tiếp theo: FIX-04 (C3).
- 2026-11-03 17:14 +07: FIX-04..06 DONE (C3). Đợt 1 xong; sang Đợt 2 — SEC-F02 (C4).
- 2026-11-03 17:16 +07: Gate Đợt 1: server 130 PASS, FE build PASS,
  Playwright mountpoint-explorer PASS; station-source FAIL do fixture thiếu
  trạm "THA Hậu Lộc" (pre-existing, đã ghi SESSION).
- 2026-11-03 17:22 +07: SEC-F02/04/07 DONE (C4); SEC-F01 DONE (C5): migration
  admin 36, live 403 → đổi mật khẩu → 200. Sang Đợt 3 — SEC-F10 (C6).
- 2026-11-03 17:30 +07: SEC-F10/13/09/18 (C6) và SEC-F06/03 (C7) DONE; gộp
  C6+C7 một commit vì cùng đợt và chạy chung gate. Sang Đợt 4 — FIX-07 (C8).
- 2026-11-03 17:33 +07: FIX-07..10 DONE (C8): resume an toàn, resolve alert,
  realtime fallback stale, lọc direction. Sang FIX-11 (C9).
- 2026-11-03 17:38 +07: FIX-11..14 DONE (C9). Sang Đợt 5 — FIX-15 (C10).
- 2026-11-03 17:41 +07: FIX-15/16 DONE (C10). Sang SEC-F08 (C11).
- 2026-11-03 17:43 +07: SEC-F08/15/19/21 DONE (C11). Sang SEC-F14 (C12).
- 2026-11-03 17:45 +07: SEC-F14/12 DONE (C12). Sang SEC-F05 (C13).
- 2026-11-03 17:47 +07: SEC-F05 DONE (C13). Sang SEC-F11 (C14).
- 2026-11-03 17:50 +07: SEC-F11 DONE (C14). Đủ 34/34 mục; chuyển sang gate chốt.
- 2026-11-03 17:52 +07: Gate chốt PASS — server 32 file/157 test; Go
  build/vet/test; FE build; compose dev + production config OK; secret scan 0;
  graphify 4286 nodes/9817 edges.
- 2026-11-03 17:52 +07: Playwright 9 PASS / 3 skip / 1 FAIL có sẵn
  (`auth-password-only`: superadmin chưa chọn công ty → API 400
  COMPANY_REQUIRED; `station-source` cần fixture "THA Hậu Lộc"). Không do
  thay đổi của đợt fix.
- 2026-11-03 17:52 +07: Gộp C6+C7 thành một commit (cùng Đợt 3, chạy chung
  gate) → tổng 13 commit thay vì 14; các lô còn lại giữ nguyên.

## Việc phát sinh

- FIX-05: chỉ nâng trần per-IP 200; throttle xác thực sai tách sang SEC-F06.
- SEC-F05: AAD áp dụng cho `station_sources.client_password_enc`; các secret
  khác vẫn v1 (tương thích ngược), sẽ chuyển dần khi có recordId thuận tiện.
- SEC-F11: nginx production đổi cổng nội bộ 80 → 8080 để chạy non-root.
- Playwright: 2 spec phụ thuộc fixture/quyền của superadmin cần cập nhật dữ
  liệu E2E trước khi dùng làm cổng chặn release.

## Follow-up 2026-11-03

- Lô A DONE: Playwright 56/56, fixture `DOCS-Trạm Hậu Lộc`, đổi mật khẩu thật.
- Lô B DONE: Go `/health` phát `relayDegraded`; card Relay + banner topbar.
- Lô C DONE: `go test -race` sạch; workflow `.github/workflows/gnss-race.yml`.
- Lô D DONE: `relay_credentials` đọc/ghi v2 + AAD `relay_credentials:password_enc:<id>`;
  sửa `station_source` để secret v1 còn đọc được (station 480 stream lại).
- Lô E DONE: `rotate:secrets` dry-run/`--apply`; đã backup `cors_admin` và
  rotate 6/6 secret sang v2, chạy lại dry-run = 0; `docs/OPS.md` §6.2.
- Còn theo dõi: trạm 480 (`TestHauLoc`) trỏ caster công khai `rtktk.online`
  đang stream trong dev; không dùng làm test tự động.
- Hotfix bản đồ 2026-11-03: tile proxy trả 403 vì permission `map.view` chưa
  được tạo; migration admin 037 + seed + matrix cấp lại quyền (super_admin
  all, admin/user tenant); thêm test Playwright tải tile thật.
- Hotfix cache phiên 2026-11-03: React Query giữ cache của phiên trước nên
  admin/user thấy dữ liệu toàn hệ thống vài giây sau khi đổi tài khoản; xoá
  cache trong `AuthProvider` khi phiên đổi + reset realtime snapshot; test
  Playwright `p1-rbac` kiểm tra bảng về đúng công ty trong 2s.
- Kế hoạch 12 (relay chọn trạm): form 3 section, Mode select
  `Nhập thủ công`/`Chọn trạm`, chỉ chọn trạm một phía + banner; server resolve
  mountpoint nội bộ hoặc `client_*`, copy mật khẩu kín; migration admin 038;
  relay do superadmin tạo có `company_id NULL` nên cấp thấp không thấy. Gate:
  server 37 file/179 test, Playwright 59/59.
- Bản đồ 2026-11-03: mở trang dùng đúng zoom/tâm cấu hình (không auto-fit lần
  đầu); nút Về mặc định theo cấu hình; thêm tùy chọn nhãn quần đảo + ngưỡng
  zoom; phủ nhãn Quần đảo Hoàng Sa/Trường Sa thay tên tiếng Trung.
- Hotfix zoom 2026-11-03: tile bị 429 khi zoom nhanh do hạn mức 240/phút; nâng
  1200/phút và vượt hạn mức trả tile trong suốt thay vì 429; banner lỗi tile
  chờ 1s và tự huỷ khi có tile tải được.
