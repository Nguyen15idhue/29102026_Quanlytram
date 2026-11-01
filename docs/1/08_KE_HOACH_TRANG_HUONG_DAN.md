# 08 — KẾ HOẠCH TRANG HƯỚNG DẪN SỬ DỤNG (DOCUSAURUS + PLAYWRIGHT + MARKDOWN)

> Ngày lập: 2026-11-01
> Trạng thái: **KẾ HOẠCH — chưa triển khai**
> Phạm vi: trang `/guide` trong app shell, dự án `docs-site/` (Docusaurus),
> bộ seed + chụp ảnh Playwright, harness kiểm tra tài liệu, mục menu mới.
> Nguyên tắc: Docusaurus chỉ là **công cụ build-time**, không thêm service runtime,
> không đổi stack ứng dụng, không thêm UI kit/Tailwind vào app.
> Tham chiếu bắt buộc: `AGENTS.md`, `docs/2/PHAN_QUYEN.md`, `docs/0/UI_UX_PLAN.md`.

## 1. Kết luận rà soát hiện trạng

### 1.1. Menu và route

- Sidebar 7 nhóm, khai báo tại `frontend/src/components/Layout.tsx:62-124`:
  Tổng quan, Trạm, Bản đồ, CORS, Tài khoản, Relay, Hệ thống.
- `titles` map tại `Layout.tsx:26-44`; route tại `frontend/src/App.tsx:37-65` (17 route).
- Menu đã lọc theo `can(module, action)` — mọi mục đều có `show`.
- `navigation.spec.ts:21` assert **7 nav-group** và danh sách label cố định
  (`navigation.spec.ts:22-32`). Thêm nhóm mới **bắt buộc** cập nhật test này.
- Không có route, trang, hay mục menu hướng dẫn nào hiện tại.

### 1.2. Playwright hiện có

- 28 file spec trong `frontend/tests/`, chạy bằng `@playwright/test` (devDep của
  `frontend`), config `frontend/playwright.config.ts`: `testDir ./tests`,
  `baseURL http://127.0.0.1:3000`, `channel chrome`, `workers 1`,
  `fullyParallel false`, trace khi fail.
- Mọi spec yêu cầu `process.env.E2E_PASSWORD` (không hardcode mật khẩu).
- Đã có tiền lệ chụp ảnh trong test: `ui.spec.ts` ghi
  `test-results/dashboard-light.png` — dùng làm mẫu nhưng **không** dùng thẳng
  cho tài liệu (ảnh nằm trong `test-results/` bị gitignore).
- `scripts/seed-regression-fixtures.mjs` là mẫu seed qua MySQL trực tiếp
  (đọc `.env.local`, cổng 3307, `ON DUPLICATE KEY UPDATE`).

### 1.3. Hạ tầng dev và prod

- Dev (`docker-compose.yml:116-134`): service `web` chạy `vite` cổng 3000,
  proxy `/api`, `/socket.io`, `/health` → `server:4000`.
- Prod: `frontend/Dockerfile` build tĩnh → `nginx:alpine`;
  `frontend/nginx.conf` có `location / { try_files $uri $uri/ /index.html; }`
  và proxy `/api/`, `/socket.io/`, `/health`.
- Node **không** phục vụ file tĩnh của frontend (`server/src/app.ts` chỉ có
  helmet, cookieParser, pino redact, `trust proxy`).
- Vite tự phục vụ thư mục `frontend/public/` tại root URL → đặt build tài liệu
  ở `frontend/public/guide/` là đủ cho cả dev và prod, **không cần sửa server**.

### 1.4. Tài liệu hiện có (tái sử dụng, không chép nguyên)

| Nguồn | Dùng cho chương |
|---|---|
| `docs/2/PHAN_QUYEN.md` (§5, §8, §11, §17) | Bắt đầu / Quản trị / Phụ lục quyền |
| `docs/api.md` | Phụ lục API rút gọn |
| `docs/OPS.md` | Vận hành & sự cố (health, log, backup) |
| `docs/0/UI_UX_PLAN.md` | Quy ước UI, dark mode, a11y |
| `docs/0/RTCM_QUALITY_PLAN.md` | Chất lượng RTCM, GGA, quality panel |
| `docs/1/04_KE_HOACH_REALTIME_CRUD.md` | Hành vi realtime, CRUD dialog |
| `Stations.tsx:133` | Chi tiết trạm 4 tab `overview/data/quality/history` |
| `System.tsx:8` | `/system` 3 tab `health/optimize/automation` |

Lưu ý lệch: `docs/1/02_CAC_BUOC_THUC_HIEN_P0.md` ghi "5 tab" nhưng code hiện có
4 tab → chương 3 phải dùng **inventory chụp từ UI**, không chép tài liệu cũ.

### 1.5. Ràng buộc bắt buộc

- `AGENTS.md` §3: không thêm UI kit/Tailwind; chart SVG zero-dep; icon
  `lucide-react` monochrome.
- `AGENTS.md` §6: không đổi stack nếu chưa có quyết định mới trong docs →
  kế hoạch này là quyết định đó, ghi rõ Docusaurus là build-time.
- `AGENTS.md` §9: không test với mountpoint công cộng; chỉ mock/endpoint cho phép.
- `AGENTS.md` §15: một accent, `framed-sheet`, dark mode `system`, a11y AA,
  Taste Skill `0 FAIL` ở 1440/768/390.
- Không commit secret; `.env.local` chỉ dùng cục bộ.

### 1.6. Khoảng trống cần lấp

1. Không có trang hướng dẫn, không có bản Markdown cho người dùng cuối.
2. Không có bộ ảnh UI chuẩn hoá (có ảnh test nhưng nằm trong `test-results/`).
3. Không có "inventory" nhãn UI → dễ viết tài liệu sai tên nút/trường.
4. Không có cơ chế phát hiện tài liệu lệch code (route đổi, ảnh mất).

## 2. Mục tiêu và tiêu chí thành công

### 2.1. Mục tiêu

1. Người dùng mọi vai trò mở **Hướng dẫn** ngay trong app, không rời shell,
   không cần tài khoản riêng.
2. Nội dung tiếng Việt, phủ **100% route hiện có** (17 route, kể cả `/profile`).
3. Ảnh minh họa sinh tự động từ app thật với **dữ liệu demo cố định**.
4. Tài liệu có thể build/test độc lập, không phụ thuộc DB khi build.
5. Phát hiện sớm tài liệu lệch code bằng test tự động.

### 2.2. Tiêu chí thành công

- `docs-site` build PASS với `onBrokenLinks: 'throw'`, `onBrokenAnchors: 'throw'`.
- `/guide` mở trong shell, menu **"Hướng dẫn"** nằm giữa **Relay** và **Hệ thống**,
  hiển thị cho `super_admin`, `admin`, `user`.
- 12 chương có nội dung thật; mỗi chương có ≥1 ảnh; không còn "TODO".
- Chạy capture 2 lần liên tiếp cho ảnh **giống nhau** (đã mask phần động).
- `guide.spec.ts` PASS 3 vai trò + mobile 390.
- `check-docs` PASS: 0 ảnh thiếu, 0 route tham chiếu không tồn tại.
- `frontend` `npm run build` PASS; `server` `npm test` giữ mức hiện tại (71/71).
- Không secret, không ảnh dữ liệu thật/khách hàng trong diff.

### 2.3. Ngoài phạm vi

- Không thay đổi nghiệp vụ/DB schema.
- Không i18n đa ngôn ngữ (chỉ `vi` ở v1).
- Không chat/feedback trong tài liệu, không analytics bên thứ ba.
- Không đưa tài liệu lên host công khai ngoài hệ thống.

## 3. Quyết định mặc định

| ID | Quyết định | Lý do |
|---|---|---|
| Q08-1 | Nội dung là Markdown/MDX trong `docs-site/docs/` | Dễ review, diff sạch, tách khỏi app |
| Q08-2 | Tích hợp bằng **route `/guide` + iframe** trong `Layout` | Giữ shell/menu/theme; tài liệu giữ sidebar + TOC + search riêng |
| Q08-3 | Docusaurus **chỉ build-time**, không service runtime | Không vi phạm AGENTS §3/§6 |
| Q08-4 | Phục vụ tĩnh tại `frontend/public/guide/`, cùng origin, **không gate auth riêng** | Đồng nhất mô hình hiện tại: bundle SPA công khai, dữ liệu do API + session bảo vệ; tài liệu chứa 0 dữ liệu thật |
| Q08-5 | Nhóm menu mới **"Hướng dẫn"** giữa **Relay** và **Hệ thống**, style nổi bật, mọi vai trò | Yêu cầu người dùng |
| Q08-6 | Ảnh: seed demo prefix `DOCS-`, 1440×900 + 390×844, light/dark, mask phần động | Không lộ dữ liệu thật, ảnh ổn định |
| Q08-7 | Search dùng plugin **index cục bộ** (offline), không Algolia | Không thêm dịch vụ ngoài |
| Q08-8 | Chỉ tiếng Việt, `baseUrl: '/guide/'` | Giảm khối lượng, đúng người dùng |

Nếu sau này cần ẩn tài liệu với người chưa đăng nhập → chuyển sang phục vụ qua
Node sau session middleware (mục 16), không đổi cấu trúc nội dung.

## 4. Kiến trúc đích

### 4.1. Luồng

```text
Dev:  browser :3000  /guide/**  ->  Vite (frontend/public/guide)  [static]
      browser :3000  /api/**    ->  proxy -> server :4000

Prod: nginx /guide/** -> /usr/share/nginx/html/guide/  (try_files, SPA fallback riêng)
      nginx /api/**   -> server :4000

Build docs (thủ công/CI):  docs-site/  ->  build/  ->  copy  ->  frontend/public/guide/
```

### 4.2. Cấu trúc thư mục

```text
docs-site/
  package.json                # Docusaurus, scripts, pin version
  docusaurus.config.ts
  sidebars.ts
  routes.json                 # danh sách route app mà tài liệu tham chiếu
  docs/
    00-gioi-thieu.md
    01-bat-dau.md
    02-dashboard.md
    03-tram.md
    04-ban-do.md
    05-cors.md
    06-tai-khoan-ntrip.md
    07-relay.md
    08-canh-bao-lich-su.md
    09-he-thong.md
    10-quan-tri.md
    11-van-hanh-su-co.md
    12-phu-luc.md
  static/img/docs/            # ảnh Playwright sinh ra (commit)
  src/css/custom.css          # token khớp app, dark mode
  src/theme/                  # swizzle tối thiểu: ẩn navbar/footer, layout bare
  .gitignore                  # build/, .docusaurus/, generated/

frontend/src/pages/Guide.tsx          # route /guide, iframe + trạng thái lỗi
frontend/tests/guide.spec.ts          # test tích hợp + tài liệu
frontend/scripts/capture-guide-shots.mjs
scripts/seed-docs-fixtures.mjs
scripts/reset-docs-fixtures.ps1
scripts/build-guide.mjs               # build docs-site + copy vào public/guide
```

`frontend/public/guide/` **gitignored** (sản phẩm build); ảnh trong
`docs-site/static/img/docs/` **commit** để build không cần app/DB.

### 4.3. Tích hợp app

- `Guide.tsx`: render `<iframe title="Hướng dẫn sử dụng" src="/guide/" />`
  trong `.content`, cao `calc(100vh - var(--topbar-height))`, không viền, có
  nút "Mở toàn màn hình" (`target="_blank"`, `rel="noreferrer"`).
- Trạng thái: loading skeleton; lỗi tải/không có build → thông báo
  "Tài liệu chưa được build" + lệnh `npm run build:guide` (chỉ hiện ở dev).
- Deep link tài liệu: `/guide/?doc=<slug>` được chuyển thành hash trong iframe
  nếu cần chia sẻ.
- Không dùng iframe sandbox chặn script (Docusaurus cần JS cho search/TOC);
  chỉ set `referrerpolicy="same-origin"`.

### 4.4. Theme và token

- Kế thừa Docusaurus classic theme, override CSS, **không Tailwind**.
- Font: `@fontsource/ibm-plex-sans` + `ibm-plex-mono` (đã có trong app, khai báo
  lại ở `docs-site` vì package riêng).
- Một accent lấy từ biến của app; dark mode mặc định `system`, có toggle;
  `color-scheme`; không gradient/glass/shadow ở rest state.
- Ẩn navbar + footer Docusaurus khi chạy trong iframe (swizzle `Layout` hoặc CSS);
  giữ sidebar + mục lục + search.

### 4.5. Ngân sách ảnh

- PNG rộng tối đa 1440 (mobile 390), mỗi ảnh ≤ 300 KB, tổng ≤ 15 MB.
- Tên file ASCII: `static/img/docs/<khu-vuc>/<slug>-<light|dark>.png`
  (ví dụ `stations/list-light.png`), không dấu, không khoảng trắng.
- Quy ước: ảnh light dùng trong nội dung; ảnh dark chỉ cho chương "Giao diện".

## 5. Dữ liệu / migration

- **Không migration**, không đổi schema, không ghi `cors_admin` ngoài seed demo.
- Fixture demo (idempotent, prefix `DOCS-`/`DOCS_`):

| Bảng | Nội dung |
|---|---|
| `companies` | 1 company `DOCS Demo` |
| `web_users` | `docs.admin` (admin công ty), `docs.user` (user) |
| `stations` | 3 trạm: Hà Nội, Đà Nẵng, TP.HCM (tọa độ thật của 3 thành phố) |
| `mountpoints` | 4 mountpoint (1 tắt, 1 đang chạy) |
| `station_sources` | source cho 2 trạm |
| `caster_listeners` | 2 listener (`DOCS` group) |
| `ntrip_accounts` | 2 tài khoản (1 khoá, 1 hoạt động) |
| `relay_jobs` / `relay_credentials` | 2 job (1 running, 1 paused) |
| `alerts` | 3 cảnh báo mức khác nhau |

- Guard an toàn: chỉ chạy khi `ALLOW_DOCS_SEED=1` và `MYSQL_HOST` local;
  script in tổng số dòng sẽ ghi, **dry-run mặc định**; `reset` xoá **chỉ** bản
  ghi có prefix `DOCS`.
- Không seed tài khoản NTRIP trỏ mountpoint công cộng; host `example.invalid`.

## 6. Thay đổi backend / hạ tầng

| Khu vực | Thay đổi |
|---|---|
| `server/` | Không đổi route/API/middleware |
| `frontend/public/guide/` | Thư mục build (gitignored) |
| `frontend/vite.config.ts` | Không đổi bắt buộc; tùy chọn thêm proxy `/guide` → docs dev server khi viết nội dung |
| `frontend/nginx.conf` | Thêm `location /guide/ { try_files $uri $uri/ /guide/index.html; }` trước `location /` để deep link tài liệu không rơi vào SPA fallback |
| `docker-compose.yml` | Không thêm service; thêm biến môi trường chỉ khi cần `ALLOW_DOCS_SEED` cho workflow seed |
| Build prod | `scripts/build-guide.mjs` chạy **trước** `docker build frontend/` (Dockerfile giữ context `frontend/`); ghi rõ trong README |

## 7. Thay đổi frontend

### 7.1. File mới

| File | Nội dung |
|---|---|
| `frontend/src/pages/Guide.tsx` | iframe, skeleton, lỗi thiếu build, fullscreen |
| `frontend/src/guide.ts` | hằng số `GUIDE_PATH`, `GUIDE_TITLE`, helper build URL |
| `frontend/tests/guide.spec.ts` | test tích hợp + nội dung tài liệu |
| `frontend/scripts/capture-guide-shots.mjs` | chụp ảnh + inventory |
| `scripts/build-guide.mjs` | build docs-site, copy sang `public/guide`, xoá cũ |
| `scripts/seed-docs-fixtures.mjs` | seed demo |
| `scripts/reset-docs-fixtures.ps1` | xoá fixture `DOCS-` |

### 7.2. File sửa

| File | Sửa |
|---|---|
| `frontend/src/App.tsx` | thêm `<Route path="/guide" element={<Guide />} />`; alias `/huong-dan` → `/guide` |
| `frontend/src/components/Layout.tsx` | thêm nhóm `{ label: 'Hướng dẫn', items: [{ to: '/guide', label: 'Hướng dẫn sử dụng', icon: BookOpen, show: true }] }` **sau nhóm Relay, trước nhóm Hệ thống**; thêm `titles['/guide']`; class `nav-group-highlight` cho nhóm này |
| CSS chứa `.nav-group` | `.nav-group-highlight` dùng accent 1 lần, không icon tinted |
| `frontend/tests/navigation.spec.ts` | `toHaveCount(8)` và danh sách label thêm `Hướng dẫn` trước `Hệ thống` |
| `frontend/tests/p1-rbac.spec.ts` | nếu assert menu theo vai trò: thêm "Hướng dẫn" cho cả 3 vai trò |
| `.gitignore` | `frontend/public/guide/`, `docs-site/.docusaurus/`, `docs-site/build/`, `docs-site/generated/` |
| `README.md`, `TASKS.md`, `SESSION.md`, `AGENTS.md` | mục lục tài liệu 08, lệnh build/capture/test, nhóm menu mới |

### 7.3. Hành vi UI

- Menu: nhóm "Hướng dẫn" chỉ 1 mục, nhãn "Hướng dẫn sử dụng", icon `BookOpen`,
  nổi bật bằng accent + chữ đậm; active khi `/guide`.
- Topbar title: "Hướng dẫn sử dụng".
- Mobile 390: sidebar là drawer; iframe chiếm toàn bộ content, docs sidebar mặc
  định thu gọn (override CSS ở ≤768px).
- Không tải iframe khi route khác (lazy bằng `React.lazy` như `UnifiedMap`).
- `prefers-reduced-motion`: tắt transition Docusaurus.

### 7.4. A11y

- `<iframe title>` mô tả; `aria-busy` khi đang tải.
- Focus: phím Tab đi vào iframe, Esc không đóng gì (không phải dialog).
- Tài liệu: skip-link, TOC có `aria-label`, contrast AA cả light/dark.

## 8. Nội dung hướng dẫn (12 chương)

| # | Chương | Route/nguồn | Ảnh | Vai trò |
|---|---|---|---|---|
| 00 | Giới thiệu & thuật ngữ (CORS, NTRIP, RTCM, mountpoint, source/rover, listener, relay, GGA, RTK, CRC24Q) | — | sơ đồ luồng text | all |
| 01 | Bắt đầu: đăng nhập/đăng xuất, phiên, sáng–tối, menu theo vai trò | `/login` | login, dashboard-dark | all |
| 02 | Dashboard: KPI, vùng cảnh báo, realtime 1s | `/` | dashboard | all |
| 03 | Trạm: danh sách, filter, phân trang, chọn nhiều, bulk, import/export `.xlsx`; form thêm/sửa; chi tiết 4 tab; nguồn trạm & probe | `/stations`, `/stations/:id` | list, form, detail-overview, detail-quality | all |
| 04 | Bản đồ vận hành: layer, toolbar, filter, search trạm+địa chỉ, drawer, deep link, marker trạng thái, popup tài khoản | `/map` | map, map-filter, map-drawer | all |
| 05 | CORS: Mountpoint Explorer/danh sách/listener mapping; Caster listener, kết nối, sourcetable, ACL | `/mountpoints`, `/caster` | mountpoint-list, caster | all |
| 06 | Tài khoản NTRIP: CRUD, khoá/mở, mật khẩu, ACL mountpoint, `max_connections`, đóng kết nối online | `/ntrip-accounts` | accounts, account-form | admin+ |
| 07 | Relay: tạo job, upstream/downstream, pause/resume, loop guard, import JSON, quality, lịch sử | `/relay-jobs` | relay-list, relay-form, relay-quality | admin+ |
| 08 | Cảnh báo & Lịch sử: ack, filter, alert impact | `/alerts`, `/history` | alerts, history | admin+ |
| 09 | Hệ thống: 3 tab health/optimize/automation; Cấu hình bản đồ | `/system`, `/system/map-config` | system-health, map-config | admin+ |
| 10 | Quản trị: Công ty, Người dùng web, Vai trò & quyền, Trang cá nhân, đổi mật khẩu | `/companies`, `/web-users`, `/roles`, `/profile` | companies, roles, profile | super/admin |
| 11 | Vận hành & sự cố: mã lỗi 401/403/409/422/423/429, checklist, log, backup/restore | `docs/OPS.md`, `PHAN_QUYEN.md` §10 | — | super/admin |
| 12 | Phụ lục: bảng 43 permission tóm tắt, API reference rút gọn, glossary | `PHAN_QUYEN.md` §4, `docs/api.md` | — | all |

Quy ước viết: câu ngắn, thể mệnh lệnh, mỗi bước 1 hành động, dùng đúng nhãn UI
lấy từ `inventory.json`; không chép mã nguồn/DSN/secret; không nêu host thật.

## 9. Playwright: seed, capture, inventory, test

### 9.1. Seed (`scripts/seed-docs-fixtures.mjs`)

- Đọc `.env.local` như `seed-regression-fixtures.mjs`; dry-run in bảng đếm.
- Upsert theo prefix `DOCS`; chạy lại nhiều lần không nhân bản.
- Chạy trước capture; reset sau khi chụp nếu môi trường là dữ liệu thật.

### 9.2. Capture (`frontend/scripts/capture-guide-shots.mjs`)

Dùng `chromium` từ `@playwright/test` (đã có trong `frontend`), không cài thêm.

Các bước cho mỗi trang:

1. `baseURL = process.env.DOCS_BASE_URL || 'http://127.0.0.1:3000'`,
   mật khẩu `process.env.E2E_PASSWORD` (bắt buộc, không hardcode).
2. Login đúng vai trò (`docs.admin`, `docs.user`, `superadmin`) theo bảng chương.
3. `goto` route, chờ `networkidle` + skeleton biến mất (`[data-loading]` không còn).
4. Chèn CSS mask: `time`, `.realtime`, `[data-docs-mask]` → `visibility:hidden`;
   đặt text "—" cho số liệu biến động nếu cần.
5. Viewport 1440×900 (desktop) và 390×844 (mobile cho chương Bản đồ/Trạm).
6. Theme light + dark (`data-theme`), mỗi theme 1 ảnh.
7. Lưu `docs-site/static/img/docs/<area>/<slug>-<theme>.png`, `fullPage: false`
   (giữ khung nhìn thực tế), `scale: 'css'`.
8. Đồng thời ghi `docs-site/generated/ui-inventory.json`:
   `{ route, role, headings[], fields[], buttons[], tableColumns[], tabs[] }`.
9. In bảng tổng kết + `git status --short` cảnh báo ảnh thay đổi.

### 9.3. Kiểm tra ổn định ảnh

- Chạy capture 2 lần, so hash SHA-256; lệch → liệt kê trang lệch để bổ sung mask.
- Không so sánh pixel với baseline trong CI (tránh flaky); chỉ so hash giữa 2 lần
  chạy liên tiếp trên cùng máy.

### 9.4. `frontend/tests/guide.spec.ts`

| Case | Nội dung |
|---|---|
| G1 | Menu "Hướng dẫn" hiện giữa "Relay" và "Hệ thống", thứ tự 8 nhóm |
| G2 | Bấm menu → `/guide`, topbar title đúng, iframe visible, `title` đúng |
| G3 | Iframe tải tài liệu: heading chương 00 hiển thị, không có phần tử lỗi |
| G4 | Search trong tài liệu trả kết quả cho "mountpoint" |
| G5 | 3 vai trò đều thấy menu; `user` vẫn thấy chương (nội dung admin ghi rõ quyền) |
| G6 | Ảnh trong tài liệu tải 200, không 404 (đếm `img` + `naturalWidth > 0`) |
| G7 | Mobile 390: mở drawer, vào Hướng dẫn, iframe không tràn ngang |
| G8 | Không console error/pageerror suốt luồng |

### 9.5. `check-docs` (trong `scripts/build-guide.mjs`)

- Mọi `img src` trong `docs/**/*.md(x)` phải tồn tại trong `static/`.
- Mọi route ghi trong `docs-site/routes.json` phải tồn tại trong `App.tsx`.
- Mỗi file chương phải có ≥1 ảnh (trừ 00, 11, 12 — allowlist).
- `onBrokenLinks: 'throw'` + `onBrokenAnchors: 'throw'` của Docusaurus là lớp 2.

## 10. Kế hoạch theo bước

### P08-0 — Baseline & quyết định

- Chụp baseline: `server npm test`, `frontend npm run build`, Playwright hiện có.
- Ghi quyết định Q08-1..Q08-8 vào tài liệu này; cập nhật `TASKS.md`.
- Nghiệm thu: có bằng chứng baseline; không đổi mã nguồn.

### P08-1 — Scaffold Docusaurus

- `docs-site` (classic, TS, `baseUrl '/guide/'`, `locale vi`, `trailingSlash true`),
  pin version tại thời điểm triển khai.
- Theme token, dark mode, ẩn navbar/footer, search index cục bộ.
- 2 chương mẫu (00, 01) để kiểm tra theme.
- Nghiệm thu: `npm run build` PASS; `npm run serve` xem được; 0 broken link.

### P08-2 — Tích hợp app & hạ tầng

- `Guide.tsx`, route, menu nhóm mới, styles nổi bật, `titles`.
- `scripts/build-guide.mjs` (build + copy + dọn + check-docs).
- `nginx.conf` thêm location `/guide/`; Vite dev phục vụ từ `public/`.
- Cập nhật `navigation.spec.ts`, `p1-rbac.spec.ts`.
- Nghiệm thu: `/guide` chạy trong compose; menu đúng vị trí; test nav cập nhật PASS.

### P08-3 — Seed + capture + inventory

- `seed-docs-fixtures.mjs`, `reset`, `capture-guide-shots.mjs`.
- Sinh ảnh cho toàn bộ bảng chương 8 + `ui-inventory.json`.
- Nghiệm thu: 2 lần chạy cho hash giống nhau; ảnh không chứa dữ liệu thật.

### P08-4 — Viết nội dung 12 chương

- Chia 4 đợt: (a) 00–02, (b) 03–04, (c) 05–07, (d) 08–12.
- Dùng `ui-inventory.json` để khớp nhãn; chèn ảnh; cross-link giữa chương.
- Review: đúng vai trò, không lộ secret/host thật, ngôn ngữ người dùng.
- Nghiệm thu: 12 chương đầy đủ, 0 TODO, mỗi chương có ảnh (trừ allowlist).

### P08-5 — Test, a11y, đóng gói

- `guide.spec.ts` 8 case; Taste Skill/kiểm tra 1440/768/390; a11y keyboard.
- `server npm test`, `frontend npm run build`, toàn bộ Playwright liên quan.
- Nghiệm thu: bảng test matrix mục 11 PASS, có ảnh chụp bằng chứng.

### P08-6 — Tài liệu hoá & bàn giao

- `README.md` (lệnh build/capture), `TASKS.md`, `SESSION.md`, `AGENTS.md`
  (nhóm menu mới + lệnh), graphify update một lần sau khi cấu trúc ổn định.
- Nghiệm thu: DoD mục 15.

**Ước lượng:** P08-0 0.5 · P08-1 1.5 · P08-2 1.5 · P08-3 1 · P08-4 3 · P08-5 1.5 · P08-6 0.5 ≈ **9.5 ngày công**.

## 11. Test matrix bắt buộc

| # | Hạng mục | Lệnh | Kỳ vọng |
|---|---|---|---|
| T1 | Docs build | `cd docs-site; npm run build` | PASS, 0 broken link/anchor |
| T2 | Check-docs | `node scripts/build-guide.mjs --check` | 0 ảnh thiếu, 0 route lạ |
| T3 | Ảnh ổn định | chạy capture 2 lần | hash giống nhau |
| T4 | Guide spec | `cd frontend; npx playwright test tests/guide.spec.ts` | 8/8 PASS |
| T5 | Menu/nav | `npx playwright test tests/navigation.spec.ts` | PASS, 8 nhóm |
| T6 | RBAC menu | `npx playwright test tests/p1-rbac.spec.ts` | PASS |
| T7 | Regression FE | `npx playwright test` (bộ hiện có) | PASS như baseline |
| T8 | FE build | `cd frontend; npm run build` | PASS (tsc + vite) |
| T9 | Server | `cd server; npm test` | 71/71 (hoặc = baseline) |
| T10 | Compose | `docker compose up -d` → mở `/guide` | Tải đúng, iframe OK |
| T11 | Mobile/a11y | Playwright 390 + Tab/Esc/contrast | Không tràn, focus đúng |
| T12 | Bảo mật | grep ảnh/nội dung: không secret, không host thật, không mật khẩu | 0 phát hiện |

## 12. File/khu vực dự kiến

| Đường dẫn | Loại |
|---|---|
| `docs-site/**` | Mới (Docusaurus, nội dung, theme) |
| `frontend/src/pages/Guide.tsx` | Mới |
| `frontend/src/guide.ts` | Mới |
| `frontend/scripts/capture-guide-shots.mjs` | Mới |
| `frontend/tests/guide.spec.ts` | Mới |
| `scripts/build-guide.mjs` | Mới |
| `scripts/seed-docs-fixtures.mjs` | Mới |
| `scripts/reset-docs-fixtures.ps1` | Mới |
| `frontend/src/App.tsx` | Sửa (route) |
| `frontend/src/components/Layout.tsx` | Sửa (menu + title) |
| CSS `.nav-group` | Sửa (highlight) |
| `frontend/tests/navigation.spec.ts` | Sửa (8 nhóm) |
| `frontend/tests/p1-rbac.spec.ts` | Sửa (nếu assert menu) |
| `frontend/nginx.conf` | Sửa (location `/guide/`) |
| `.gitignore`, `README.md`, `TASKS.md`, `SESSION.md`, `AGENTS.md` | Sửa |
| `server/**` | Không đổi |

## 13. Rủi ro và cách xử lý

| Rủi ro | Mức | Xử lý |
|---|---|---|
| 2 sidebar gây rối trong content | Cao | Ẩn navbar/footer docs; sidebar docs thu gọn ≤768px; test G7 |
| Tài liệu tĩnh công khai | TB | Q08-4 chấp nhận (0 dữ liệu); nếu cần ẩn → mục 16 |
| Ảnh lệch khi UI đổi | Cao | mask + check-docs + capture trong checklist release |
| `npm`/Docusaurus nặng, tốn thời gian CI | TB | project riêng, chỉ chạy khi có thay đổi `docs-site/**` |
| Seed lỡ vào DB thật | Cao | dry-run mặc định, `ALLOW_DOCS_SEED=1`, prefix `DOCS`, script reset |
| Deep link docs rơi vào SPA fallback | TB | thêm `location /guide/` trong nginx; test reload 1 URL sâu |
| Vi phạm "không đổi stack" | TB | Q08-3 + mục 1.5 ghi rõ build-time; không service mới |
| Nhãn UI sai do tài liệu cũ | TB | chỉ dùng `ui-inventory.json` sinh từ UI thật |

## 14. Rollback

1. Xoá route `/guide` + nhóm menu trong `Layout.tsx`, `App.tsx`, revert test nav.
2. Xoá `frontend/public/guide/`, `docs-site/`, script seed/capture.
3. Revert `nginx.conf` nếu đã thêm location.
4. Chạy `reset-docs-fixtures.ps1` để xoá dữ liệu `DOCS-`.
5. `docker compose up -d --force-recreate web`; xác nhận menu về 7 nhóm.

## 15. Definition of Done

1. Tiêu chí mục 2.2 thoả, T1–T12 PASS có bằng chứng.
2. 12 chương đầy đủ, ảnh khớp UI thật, không dữ liệu thật/secret.
3. Menu "Hướng dẫn" đúng vị trí giữa Relay và Hệ thống, 3 vai trò thấy.
4. Không thêm service runtime, không đổi schema, không đổi nghiệp vụ.
5. Diff review xong; `SESSION.md`, `TASKS.md`, `README.md`, `AGENTS.md` cập nhật.

## 16. Việc để sau (ngoài kế hoạch 08)

- Gate auth cho `/guide` nếu cần ẩn tài liệu (chuyển sang Node static + session).
- i18n `en` bằng Docusaurus i18n.
- Export PDF/bản in phục vụ đào tạo.
- Video ngắn (nếu cần) — phải cân nhắc dung lượng và không lộ dữ liệu.
- Đưa capture vào CI chỉ khi phát hiện drift ảnh (không chạy mọi commit).

## 17. Nhật ký thực hiện

### P08-0 — Baseline & chốt kế hoạch (2026-11-01 23:05 +07:00)

- Việc: chốt kế hoạch 08 vào `TASKS.md` mục 9.3; chạy baseline; không sửa mã nguồn.
- Lệnh: `server npm test`; `frontend npm run build`; `frontend npx playwright test tests/navigation.spec.ts`.
- Kết quả: PASS — server 88/88 test (14 file), frontend build PASS, navigation 1/1 PASS (1 worker, không skip). Stack compose healthy (mysql/server/gnss/web).
- File: `docs/1/08_KE_HOACH_TRANG_HUONG_DAN.md`, `TASKS.md`, `SESSION.md`.
- Sai lệch: baseline server là **88/88** (kế hoạch ghi 71/71 theo số liệu cũ) — dùng 88/88 làm mốc chống regress.
