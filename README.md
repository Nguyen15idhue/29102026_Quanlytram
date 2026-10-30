# Hệ thống quản lý trạm CORS / NTRIP / RTCM (MVP)

Dự án xây dựng hệ thống quản lý trạm CORS/NTRIP/RTCM ở mức MVP:
quản lý trạm, mountpoint, tài khoản web, tài khoản NTRIP, relay bridge,
giám sát realtime và cấu hình hệ thống.

> Trạng thái hiện tại: **Phase 2 — Port relay & test mock (DONE)**.
> Hệ thống chạy end-to-end với MySQL, Node API, Go relay bridge và React UI.
> Relay đã được kiểm thử byte-exact bằng mock; chưa chạm caster thật.

## 1. Tài liệu

- `docs/0/KE_HOACH_CHI_TIET.md` — kế hoạch chi tiết (v2)
- `docs/0/CAC_BUOC_THUC_HIEN.md` — các bước thực hiện theo phase (v2)
- `AGENTS.md` — quy tắc làm việc
- `TASKS.md` — backlog và tiến độ
- `SESSION.md` — trạng thái phiên

## 2. Yêu cầu môi trường

- Node.js 22+
- Go 1.24+
- Docker Engine + Docker Compose
- MySQL 8 (chạy trong container)
- Chrome/Edge/Chromium (cho Taste Skill)
- Windows để phát triển, Linux để triển khai

## 3. Cấu trúc thư mục dự kiến

```text
frontend/        React + Vite + TypeScript
server/          Node + Express + TypeScript + Socket.IO
gnss/            Go: relay bridge + caster + RTCM monitor
db/migrations/   admin/ + runtime/
scripts/         mock-ntrip (caster/rover/source), fixtures, e2e relay
docs/0/          tài liệu dự án
```

## 4. Cách chạy dự kiến

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

## 5. Cổng dịch vụ

| Thành phần | Port |
|---|---|
| Frontend dev / prod | 5173 / 3000 |
| Node API + Socket.IO | 4000 |
| Go internal HTTP | 7080 |
| NTRIP caster | 2101 |
| MySQL | 3307 -> 3306 |
| Relay cũ (không đụng) | 8081 |

MySQL và Go internal không public ra ngoài.

## 6. Thời gian

- Hiển thị/log: `Asia/Ho_Chi_Minh` (+07:00), TP. Hồ Chí Minh, Việt Nam.
- Lưu trữ: UTC/epoch.
- MySQL: `default-time-zone=+00:00`.

## 7. Quy tắc an toàn

- Không sửa, ghi, xóa file trong `relayrtcm\backup`.
- Không chạy relay cũ, không chiếm cổng `8081`/`2101`.
- Mock-first cho NTRIP/RTCM.
- Không commit secret; chỉ dùng `.env.local`.
- Không thêm Redis/Kafka/RabbitMQ/K8s.

## 8. Kiểm thử

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

## 9. Ghi chú

- Phase 0 không tạo mã nguồn, không chạy Docker, không cài package.
- Không tuyên bố hoàn thành khi chưa có bằng chứng test.
