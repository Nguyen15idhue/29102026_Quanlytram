# KẾ HOẠCH UI/UX — PHASE 3.5

> Tài liệu bổ sung cho `KE_HOACH_CHI_TIET.md`, `TASKS.md`, `CAC_BUOC_THUC_HIEN.md`.
> Phase 3.5 là phase cross-cutting trước Phase 4; không mở lại Phase 3 và không
> thay đổi bất biến Node/Go/RTCM.

## 1. Kết luận nhanh

UI hiện tại **đúng chức năng nhưng chưa đủ tốt để vận hành**: form CRUD nằm cùng
bảng, không có modal/drawer; không có icon; không phân trang; sidebar cuộn cùng
nội dung; thiếu loading/empty/error nhất quán; phản hồi thao tác yếu; và **fix cứng
light mode** nên trên máy mặc định dark mode nhiều thành phần khó nhìn. Cần một
**lớp UI foundation** dùng chung trước khi thêm màn hình Phase 4/5/6.

## 2. Hiện trạng & bằng chứng

| # | Vấn đề | Hiện trạng | Hướng sửa |
|---|---|---|---|
| 1 | Form inline | Stations/Mountpoints/Relay/NTRIP/WebUsers/Roles render form panel ngay trên bảng | Create/Edit trong `Dialog`; View trong `Drawer`; xóa bằng `AlertDialog` |
| 2 | Không icon | Không có icon; nút chỉ chữ | `lucide-react` 16/18/20px, stroke 1.5, `currentColor`; không icon màu/tinted square |
| 3 | Không phân trang | Query `pageSize=100`, render toàn bộ | Server pagination 20/50; search debounce; URL state |
| 4 | Shell cuộn sai | `.shell` là grid thường; body cuộn cả sidebar + content | Shell cao `100dvh`; sidebar/topbar cố định; chỉ `.content` cuộn |
| 5 | Xác nhận xóa | `window.confirm` | `AlertDialog` accessible, focus trap, nút nguy hiểm rõ |
| 6 | Không xem chi tiết | Chỉ có dòng bảng | Detail drawer: metadata, trạng thái, revision, audit gần đây |
| 7 | Phản hồi yếu | Lỗi hiện một dòng trên đầu trang | Field error + toast success/error + aria-live |
| 8 | Thiếu search/filter | Chỉ có `q` ở một số API, UI không dùng | Search + filter theo trạng thái/owner; debounce 300ms |
| 9 | Bảng thô | Không sticky header, không align số, empty state nghèo | DataTable chuẩn: header nhẹ, row 48px, số căn phải, sticky header |
| 10 | Responsive | Bảng tràn ngang; sidebar không thu gọn | <1024px: sidebar drawer; bảng chuyển card 2 dòng; form full-screen |
| 11 | Dashboard tĩnh | 3 card, không quick action/relay/NTRIP | KPI strip + quick actions + recent activity |
| 12 | Phân cấp thị giác | Nhiều panel cùng trọng lượng, chữ nhỏ | Title 22px, section 16px, KPI 28px, body 14px; một accent |
| 13 | Trạng thái | `badge` rời rạc, màu tùy page | Status badge dùng token ngữ nghĩa, không dùng icon màu |
| 14 | ID/owner thô | Hiện số ID trần | Tên owner + ID mono; format ngày giờ +07 |
| 15 | URL state | Mất trang/filter khi refresh | `useSearchParams` cho page/pageSize/q/status |
| 16 | Dirty form | Đóng form mất dữ liệu | Confirm đóng khi form dirty; disable submit khi đang lưu |
| 17 | A11y | Thiếu focus/aria cho dialog, icon-only | Focus trap, Esc, aria-label, keyboard order, contrast |
| 18 | Motion | Không có feedback chuyển động | 150–200ms cho dialog/drawer/hover; tôn trọng reduced-motion |
| 19 | Dark mode | `:root` fix `color-scheme: light`; nhiều màu hardcode | Theme `system/light/dark`, token dark, toggle, chống FOUC |

## 3. Hướng thiết kế đã chọn

- Style: **`framed-sheet`** (app screen), seed `973367273`; có biến thể light + dark.
- Chrome là một khung L tinted; nội dung là **white sheet** inset 8px, radius 16,
  edge 1px, **không shadow**.
- Sidebar 228px; topbar 48px; content padding 24px; gap 24px; row height 48px.
- Một accent duy nhất (giữ xanh hiện tại, dùng cho primary/active underline);
  màu khác chỉ dùng cho trạng thái dữ liệu (positive/negative/warning).
- Type: **IBM Plex Sans** (400/500/600), **IBM Plex Mono** cho ID/key/số bảng.
  Self-host qua `@fontsource` để không phụ thuộc Google Fonts runtime.
- Icon: `lucide-react`; 16–20px; stroke 1.5; `currentColor`; không icon màu,
  không icon trong ô tinted, không icon trang trí.
- Không gradient/glass/shadow ở trạng thái nghỉ; không icon-chip; không zebra table.
- App screen không dùng entrance animation; motion chỉ là feedback.

### Dark mode

- Modes: `system` (mặc định), `light`, `dark`; lưu lựa chọn `cors-theme`.
- `<html data-theme="light|dark">` + `color-scheme` tương ứng; script inline
  trước React để tránh flash sai theme.
- Dark tokens (near-black, không neon): `--ground #0f1214`, `--surface #15191c`,
  `--raised #1b2024`, `--border #2a3035`, `--text #e6eaed`, `--muted #9aa4ac`,
  accent giữ một hue xanh, status/positive/negative/warning tăng contrast.
- Không đảo màu bằng filter; mọi component đọc token, không hardcode hex.
- Sidebar/topbar dùng cùng ground/raised; active neutral; icon `currentColor`.
- Form/native select/scrollbar dùng `color-scheme`; chart/badge/table/toast
  có biến thể dark; focus ring đủ tương phản.
- Toggle theme ở topbar (`Sun/Moon` lucide, aria-label); theo dõi
  `prefers-color-scheme` khi mode = system.
- Test cả light/dark ở 1440/768/390; contrast AA; không FOUC; toggle giữ trạng thái.

## 4. Component foundation

| Component | Trách nhiệm |
|---|---|
| `AppShell` | Sidebar + topbar cố định, content scroll, mobile drawer |
| `Sidebar` | Brand/mark, nav nhóm, active neutral, user menu, collapse mobile |
| `Topbar` | Breadcrumb/title, search, user, help; 48px |
| `ThemeToggle` | `system/light/dark`; Sun/Moon lucide; lưu localStorage; aria-label |
| `PageHeader` | H1 + mô tả ngắn + primary action; một hành động chính |
| `Button` / `IconButton` | Variant primary/secondary/ghost/danger; loading; icon + label |
| `Field` / `Input` / `Select` / `Switch` | Label, help, error, `aria-describedby` |
| `Dialog` (Radix) | Create/Edit; focus trap; Esc; footer actions |
| `Drawer` (Radix Dialog side) | View detail; mobile form full-screen |
| `AlertDialog` (Radix) | Xác nhận xóa/disable; không dùng `window.confirm` |
| `Toast` | Success/error; aria-live; tự đóng; không che action |
| `DataTable` | Header, row, sticky, empty/loading/error, row actions |
| `Pagination` | Page/pageSize/total; URL sync; disabled states |
| `SearchInput` | Debounce 300ms; clear; aria-label |
| `StatusBadge` | Neutral + semantic token; không icon màu |
| `Tabs` | Underline 2px; filter trạng thái |
| `EmptyState` / `Skeleton` / `ErrorState` | Có hành động/retry; không text trơ |

## 5. Pattern CRUD chuẩn

- **List**: PageHeader + search/filter + DataTable + Pagination.
- **Create/Edit**: `Dialog` desktop; full-screen `Drawer` mobile. Không render form
  trong page/table. Mỗi field có label, help, error; submit disabled khi đang lưu.
- **View**: `Drawer` phải/trái; hiển thị metadata, trạng thái, revision, audit.
- **Delete/Disable**: `AlertDialog`; nêu hậu quả; nút danger; toast sau khi xong.
- **Actions**: icon + tooltip + aria-label; hành động nguy hiểm không đặt cạnh primary.
- **Refresh**: invalidate query sau mutation; giữ trang/filter hiện tại.

## 6. Theo màn hình

### Dashboard
- KPI strip: Trạm, Relay streaming, TK NTRIP, cảnh báo mở (một container, divider).
- Quick actions theo quyền: thêm trạm, thêm relay, thêm TK NTRIP.
- Recent activity: 5 dòng gần nhất; link “Xem tất cả”.
- Không dùng 3 card icon; không số liệu trang trí.

### Trạm / Mountpoint
- Bảng: mã/tên, host:port, owner (tên), trạng thái; row click mở drawer.
- Create/Edit dialog; xóa alert dialog; search + pagination.
- Mountpoint: cột trạm, enabled, auth; form chọn trạm.

### Relay
- Bảng: tên, upstream/downstream, state badge, applied/desired revision.
- Create/Edit dialog (2 cột endpoint); detail drawer: state, last error, session gần đây.
- Actions: enable/disable/restart/test/delete trong menu hàng; test result toast.
- Phân biệt “đã lưu” (desired) và “đã áp dụng” (applied) rõ ràng.

### TK NTRIP
- Bảng: username, trạng thái, max conn, owner; create/edit dialog.
- ACL mountpoint: tab/drawer riêng; multi-select; lưu qua API placeholder.
- Không hiện password/hash; password chỉ nhập khi tạo/đổi.

### Web users / Roles
- Create/Edit dialog; role matrix trong drawer lớn; xóa/lock alert dialog.
- Field allowlist self-edit giữ nguyên; lỗi quyền hiển thị rõ.

## 7. Shell, bảng, phân trang

- Theme: `system` mặc định; `data-theme` trên `<html>`; không hardcode light.
- `html, body, #root { height: 100% }`; `.shell { height: 100dvh; overflow: hidden }`.
- Sidebar/topbar cố định; `.content { overflow: auto; overscroll-behavior: contain }`.
- Mobile: sidebar thành drawer; topbar có menu button; content full width.
- DataTable: server pagination mặc định 20; page size 10/20/50; `page`, `pageSize`,
  `q`, `status` lưu URL; search debounce 300ms.
- Không `pageSize=100`; không render toàn bộ; không phân trang client.
- Bảng: header 12px grey sentence-case, row 48px, rule nhẹ, số căn phải,
  ID mono, action cột cuối; sticky header trong content scroll.
- Mobile: row thành 2 dòng; ẩn cột phụ; action menu; không tràn ngang.

## 8. Accessibility & motion

- Dialog/Drawer: focus trap, Esc, restore focus, `aria-labelledby/describedby`.
- Icon-only: `aria-label`; tooltip không thay label.
- Form: label thật, error `aria-describedby`, `aria-invalid`.
- Keyboard: tab order, Enter/Space, không bẫy focus ngoài dialog.
- Contrast AA; focus ring rõ; không chỉ dùng màu để báo trạng thái.
- Motion 150–200ms; `prefers-reduced-motion` giữ nội dung, bỏ travel.
- Không entrance animation cho app screen; chỉ feedback.

## 9. Phase mapping — không xung đột

| Phase | Việc UI | Ghi chú |
|---|---|---|
| Phase 3.5 | Foundation + sửa toàn bộ màn hình hiện có | Làm trước Phase 4 |
| Phase 4 | Màn hình caster/client dùng lại foundation | Không làm lại shell/table/modal |
| Phase 5 | Dashboard/history/alert dùng foundation | P5-02 chỉ bổ sung nội dung mới |
| Phase 6 | Quality station/relay dùng foundation | P6-05 nhúng panel/chart/alert vào popup trạm/relay |
| Phase 7–12 | Dùng lại foundation; không làm lại shell | Bổ sung dictionary, form nhóm, detail tab, notification, log viewer |

- Phase 3 vẫn DONE; Phase 3.5 là cross-cutting, không mở lại checklist Phase 3.
- Phase 5 Taste gate vẫn là gate cuối cho dashboard/panel quality; Phase 3.5 có gate riêng
  cho các màn hình hiện có.
- Không thay đổi API/DB trong Phase 3.5 (trừ bug UI nhỏ); nếu cần API mới thì
  ghi rõ và cập nhật `docs/api.md` trước.

### 9.1. Menu Phase 7–12

```text
Dashboard
Trạm: Bản đồ trạm | Danh sách trạm
CORS: Bản đồ online | Danh sách online | Tài khoản NTRIP | Mountpoint | Caster
Relay
Hệ thống: Phân quyền | Người dùng | Lịch sử | Cảnh báo
(Ẩn) Trang cá nhân — mở bằng avatar/tên người dùng
```

Quy ước mới:
- Mọi danh sách có pagination server-side **mặc định 10**, luôn hiển thị; chọn 10/20/50.
- Toolbar list: Thêm, Import, Export Excel, Tải lại.
- Import/export `.xlsx` dùng `exceljs`; template + preview + lỗi theo dòng.
- Bản đồ trạm chỉ trạm; bản đồ online chỉ marker tài khoản NTRIP có toạ độ.
- Tài khoản online không có toạ độ: hiện tổng “x tài khoản không gửi tọa độ”,
  chi tiết ở menu **Danh sách online**.
- Caster có tab **Kết nối live** và force disconnect.
- Trang cá nhân không nằm trong menu; mở từ avatar/tên người dùng.
- Chi tiết trường theo nhóm: `docs/0/PHASES_7_12_PLAN.md` §8.

## 10. Phụ thuộc dự kiến

- `lucide-react` — icon monochrome.
- `@radix-ui/react-dialog` — Dialog/Drawer accessible.
- `@radix-ui/react-alert-dialog` — xác nhận nguy hiểm.
- `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` — font self-host.
- Không thêm UI kit/Tailwind; giữ CSS hiện có + component layer.

## 11. Acceptance & test

- Không còn form CRUD inline trong page/table; mọi create/edit dùng Dialog/Drawer.
- Không còn `window.confirm`; delete dùng AlertDialog.
- Mọi bảng có phân trang server-side; URL giữ page/filter; không `pageSize=100`.
- Sidebar/topbar cố định; chỉ content scroll; mobile có drawer.
- Icon lucide monochrome; không icon màu/tinted chip.
- Loading/empty/error có skeleton/empty action/retry; toast sau mutation.
- Keyboard/focus/aria đạt; contrast AA ở **cả light và dark**; reduced-motion.
- Dark mode: system default, toggle persist, không FOUC; form/table/chart/badge đọc rõ.
- `inspect.mjs --app` 0 FAIL tại 1440/768/390.
- Playwright: login → CRUD trạm/mountpoint/relay/NTRIP → phân trang/search → xóa confirm.
- Không gây lỗi hồi quy API/RBAC/reconcile; test Go/Node vẫn PASS.

## 12. Rủi ro

- Thay shell có thể ảnh hưởng route/layout; làm sau khi có test Playwright.
- Radix/font thêm dependency; kiểm tra bundle size và license.
- Bảng responsive dễ mất cột; ưu tiên cột identity + trạng thái.
- Không để Phase 3.5 kéo dài sang Phase 4; chốt foundation trước khi thêm màn hình.
- Không dùng icon màu để trang trí; màu chỉ cho trạng thái/dữ liệu.
- Dark mode dễ sai contrast; test token/status/focus riêng cho dark.
- Chống FOUC: script inline + token mặc định theo system trước khi React mount.
