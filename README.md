# Hệ thống quản lý trạm CORS / NTRIP / RTCM (MVP)

Dự án xây dựng hệ thống quản lý trạm CORS/NTRIP/RTCM ở mức MVP:
quản lý trạm, mountpoint, tài khoản web, tài khoản NTRIP, relay bridge,
giám sát realtime và cấu hình hệ thống.

> Trạng thái hiện tại: **Phase 6 — RTCM Analytics & chất lượng (DONE mock)**.
> Hệ thống chạy end-to-end với MySQL, Node API, Go relay/caster/quality và React UI.
> Đã có Socket.IO realtime, dashboard, history, alerts/ack, quality panel trong
> popup trạm/relay, dark mode, CRUD dialog/drawer; hot reload Vite polling 1s.
>
> Roadmap hoàn thiện **Phase 7–12** theo menu mới: Trạm (bản đồ/danh sách),
> CORS (bản đồ online/danh sách online/NTRIP/mountpoint/caster), Relay,
> Hệ thống (phân quyền/người dùng/lịch sử/cảnh báo), trang cá nhân ẩn menu.
> Xem `docs/0/PHASES_7_12_PLAN.md`.

## 1. Tài liệu

- `docs/0/KE_HOACH_CHI_TIET.md` — kế hoạch chi tiết (v2)
- `docs/0/CAC_BUOC_THUC_HIEN.md` — các bước thực hiện theo phase (v2)
- `docs/0/RTCM_QUALITY_PLAN.md` — kế hoạch Phase 6: chất lượng trạm/relay
- `docs/0/PHASES_7_12_PLAN.md` — khảo sát CGBAS + roadmap hoàn thiện Phase 7–12
- `docs/0/UI_UX_PLAN.md` — kế hoạch Phase 3.5: UI/UX Foundation
- `AGENTS.md` — quy tắc làm việc
- `TASKS.md` — backlog và tiến độ
- `SESSION.md` — trạng thái phiên

## 2. Menu mục tiêu

```text
Dashboard
Trạm: Bản đồ trạm | Danh sách trạm
CORS: Bản đồ online | Danh sách online | Tài khoản NTRIP | Mountpoint | Caster
Relay
Hệ thống: Phân quyền | Người dùng | Lịch sử | Cảnh báo
(Ẩn) Trang cá nhân — mở bằng avatar/tên người dùng
```

Mọi danh sách dùng phân trang mặc định **10**, luôn hiển thị; import/export
`.xlsx` bằng `exceljs`; import người dùng không có cột password, mật khẩu mặc
định `123456`.

## 3. Yêu cầu môi trường

- Node.js 22+
- Go 1.24+
- Docker Engine + Docker Compose
- MySQL 8 (chạy trong container)
- Chrome/Edge/Chromium (cho Taste Skill)
- Windows để phát triển, Linux để triển khai

## 4. Cấu trúc thư mục dự kiến

```text
frontend/        React + Vite + TypeScript
server/          Node + Express + TypeScript + Socket.IO
gnss/            Go: relay bridge + caster + RTCM monitor/analyzer
db/migrations/   admin/ + runtime/
scripts/         mock-ntrip (caster/rover/source), fixtures, e2e relay
docs/0/          tài liệu dự án
```

## 5. Cách chạy dự kiến

```bash
# 1. Tạo file môi trường
cp .env.example .env.local
# điền giá trị thật trong .env.local (không commit)

# 2. Khởi động hạ tầng
docker compose up -d

# 3. Migration
npm run migrate

# 4. Kiểm tra
docker compose ps
curl http://localhost:4000/health
curl http://localhost:7080/health
```

## 6. Cổng dịch vụ

| Thành phần | Port |
|---|---|
| Frontend dev / prod | 5173 / 3000 |
| Node API + Socket.IO | 4000 |
| Go internal HTTP | 7080 |
| NTRIP caster | 1509 (mặc định, tùy chỉnh theo nhóm mountpoint) |
| MySQL | 3307 -> 3306 |
| Relay cũ (không đụng) | 8081 |

MySQL và Go internal không public ra ngoài.

## 7. Thời gian

- Hiển thị/log: `Asia/Ho_Chi_Minh` (+07:00), TP. Hồ Chí Minh, Việt Nam.
- Lưu trữ: UTC/epoch.
- MySQL: `default-time-zone=+00:00`.

## 8. Quy tắc an toàn

- Không sửa, ghi, xóa file trong `relayrtcm\backup`.
- Không chạy relay cũ, không chiếm cổng `8081`/`2101`.
- Mock-first cho NTRIP/RTCM.
- Không commit secret; chỉ dùng `.env.local`.
- Không thêm Redis/Kafka/RabbitMQ/K8s.

## 9. Kiểm thử

```bash
cd gnss && go test ./... && go vet ./...
cd server && npx tsc --noEmit && npm test
cd frontend && npm test
```

Mock relay (không dùng caster thật, không chiếm 8081/2101):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-relay-mock.ps1
```

Mock/fixtures nằm ở `scripts/mock-ntrip`, `scripts/fixtures`; chi tiết
nghiệm thu Phase 2 ở `SESSION.md` mục 7.

Kiểm thử UI bằng Taste Skill (app screen):

```bash
node ~/.config/opencode/skills/design-taste-frontend/scripts/inspect.mjs <url> --app
```

## 10. Ghi chú

- Phase 0 không tạo mã nguồn, không chạy Docker, không cài package.
- Không tuyên bố hoàn thành khi chưa có bằng chứng test.
