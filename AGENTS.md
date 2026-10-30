# AGENTS.md

## 1. Mục đích

Tài liệu này là quy tắc làm việc bền vững cho mọi agent/người tham gia dự án.
Nguồn sự thật đầy đủ nằm ở:

- `docs/0/KE_HOACH_CHI_TIET.md` (v2)
- `docs/0/CAC_BUOC_THUC_HIEN.md` (v2)
- `docs/0/RTCM_QUALITY_PLAN.md` (Phase 6)
- `docs/0/XÂY DỰNG HỆ THỐNG QUẢN LÝ TRẠM CORS.docx` (yêu cầu gốc)

Nếu tài liệu này mâu thuẫn với docs v2, docs v2 thắng.

## 2. Tổng quan dự án

Hệ thống quản lý trạm CORS/NTRIP/RTCM ở mức MVP:
quản lý trạm, mountpoint, tài khoản web, tài khoản NTRIP, relay bridge,
giám sát realtime và cấu hình hệ thống.

## 3. Stack đã chốt

- Frontend: React + Vite + TypeScript + Socket.IO client.
- Management: Node.js + Express + TypeScript + Socket.IO server.
- GNSS/relay: Go.
- RTCM parser: `github.com/go-gnss/rtcm` (Apache-2.0), parse-only.
- Database: MySQL only (hai schema `cors_admin`, `cors_runtime`).
- Triển khai: Docker Compose.
- Không dùng Redis, Kafka, RabbitMQ, Kubernetes.

## 4. Ranh giới kiến trúc

- Node ghi `cors_admin`; Go ghi `cors_runtime`.
- Go chỉ đọc cấu hình (`relay_jobs`, `relay_credentials`, `stations`,
  `mountpoints`, `ntrip_accounts`), không sửa cấu hình.
- Node không ghi trạng thái runtime; trạng thái job nằm ở
  `cors_runtime.relay_job_state`.
- Node không nằm trên đường byte RTCM.
- Live metrics nằm trong RAM của Go; Node lấy snapshot qua internal API.
- Relay là menu/thực thể riêng, không gắn FK vào `stations`.

## 5. Quy tắc bất biến

1. Không sửa, ghi, xóa, di chuyển, đổi tên file trong
   `F:\3.Laptrinh\1. Project\1. GNSS\relayrtcm\backup`.
2. Không chạy `relay.exe`, không dừng tiến trình relay cũ, không chiếm cổng
   `8081` hoặc `2101` khi chưa được xác nhận.
3. Mock-first: mọi tính năng NTRIP/RTCM phải đạt test với mock trước khi chạm
   dịch vụ thật.
4. Không commit secret. Chỉ dùng `.env.local` hoặc secret manager.
5. Không thêm Redis/Kafka/RabbitMQ/K8s.
6. Không đổi stack đã chốt nếu chưa có quyết định mới trong docs.
7. Không tạo code ứng dụng trong Phase 0.
8. Không tuyên bố hoàn thành khi chưa có bằng chứng test.

## 6. Thời gian

- Hiển thị/log: `Asia/Ho_Chi_Minh` (+07:00), TP. Hồ Chí Minh, Việt Nam.
- Lưu trữ: UTC hoặc epoch-ms nhất quán.
- MySQL: `default-time-zone=+00:00`.
- Bucket thống kê ghi rõ mốc UTC; UI quy đổi +07.
- Không trộn `DATETIME` local và epoch-ms trong cùng một loại dữ liệu.

## 7. Auth và RBAC

- Web account: session cookie server-side + CSRF; không JWT dài hạn.
- NTRIP account: bảng riêng, xác thực Basic ở caster, không login web.
- RBAC: role + permission (`view/add/edit/delete`) + scope
  (`all/subtree/own/none`).
- Mặc định deny; kiểm tra ở server, không chỉ ẩn UI.
- Chống nâng quyền: không quản lý user level >= mình; không sửa/xóa
  `super_admin`; không xóa `super_admin` cuối cùng.
- `user` tự sửa chỉ được allowlist: `display_name`, `email`, `password`.
- Mọi thay đổi quyền ghi audit; audit phải redact secret.

## 8. Dữ liệu

- `stations` là trạm vật lý; `mountpoints` là endpoint 0..n.
- Không dùng `stations.mountpoint`.
- `relay_jobs` chỉ chứa cấu hình; trạng thái chạy ở `relay_job_state`.
- Xóa relay job là soft-delete (`deleted_at`); giữ history theo retention.
- Hai version schema riêng: `schema_migrations(scope, version)`.
- Migration chỉ chạy bởi Node/CI; Go kiểm tra version runtime và fail-fast.

## 9. Relay, NTRIP, RTCM

- Relay bridge: GET upstream -> POST/SOURCE downstream, passthrough nguyên byte.
- Caster: Phase 4; v1 legacy, v1 auth, v2.
- RTCM monitor/analyzer chỉ parse để đếm/đo; không sửa byte, không serialize lại.
- Chất lượng dùng chung cho `station` (ingest) và `relay_job` (upstream/downstream)
  theo `target_type` + `target_id` + `direction`; không FK giữa relay và station.
- Trạm thường lấy từ caster ingest hoặc station probe GET-only (mặc định disabled).
- Analyzer dùng queue giới hạn; đầy thì drop sample, không chặn relay/caster.
- Không lưu raw RTCM/payload; chỉ aggregate/sample; không auto-disable job/probe.
- Realtime quality: Go RAM -> Node pull internal API -> Socket.IO; Node không trên đường byte.
- Kế hoạch chi tiết: `docs/0/RTCM_QUALITY_PLAN.md` (Phase 6).
- Phân biệt rõ `HTTP 200`, `ICY 200`, `SOURCETABLE 200` theo ngữ cảnh.
- Không test thật với mountpoint công cộng; chỉ endpoint được phép.
- Loop guard: self-loop + cycle nội bộ; ghi rõ giới hạn với hệ thống ngoài.

## 10. Cấu trúc thư mục dự kiến

```text
AGENTS.md  TASKS.md  SESSION.md  README.md  .env.example  .gitignore
docker-compose.yml
docs/0/
frontend/            React + Vite + TS
server/              Node + Express + TS + Socket.IO
gnss/                Go: caster + bridge + monitor
db/migrations/       admin/ + runtime/
scripts/             ntrip-probe, seed-relay, mock caster, fixtures
graphify-out/        (gitignore)
```

## 11. Lệnh dự kiến

Các lệnh dưới đây là dự kiến; chỉ dùng sau khi Phase 1 tạo mã nguồn.

```bash
docker compose up -d
docker compose ps
npm run migrate
cd gnss && go test ./...
cd server && npm test
cd frontend && npm test
node ~/.config/opencode/skills/design-taste-frontend/scripts/inspect.mjs <url> --app
graphify update .
```

## 12. Quy trình làm việc

1. Đọc docs v2 và phase hiện tại trong `TASKS.md`.
2. Mỗi task ghi rõ: phạm vi file, mục tiêu, tiêu chí nghiệm thu, lệnh kiểm tra.
3. Không đọc lại toàn repo nếu không cần; không viết lại module đang hoạt động
   chỉ để làm đẹp.
4. Chạy test phù hợp sau mỗi thay đổi.
5. Kiểm tra diff trước khi kết thúc.
6. Cập nhật `SESSION.md`: đã làm / chưa làm / lỗi / cách chạy.
7. Không chuyển phase nếu checklist chưa PASS.

## 13. Kiểm thử

- Unit Go: NTRIP, chunked, CRC24Q, fan-out, timeout, backoff, loop guard.
- Mock: mock caster/rover; byte-exact; mảnh read; nhiều frame/read; slow client.
- Restart: Go restart khi đang stream; session cũ đóng `service_restart`.
- DB failure: DB down/up; buffer giới hạn; không chặn RTCM.
- RBAC: scope, chống nâng quyền, field allowlist.
- Realtime: session auth, room theo quyền, đổi quyền khi socket mở.
- Internal API: HMAC, timestamp, nonce, body hash.
- E2E: Docker Compose; restart UI/Node không ảnh hưởng Go.

## 14. Bảo mật

- Không log Authorization/password/DSN.
- Audit redaction trước khi ghi.
- Internal API bind loopback/docker network; HMAC + nonce.
- MySQL/Go internal không public.
- Caster no-auth chỉ khi cấu hình rõ ràng + cảnh báo.
- Backup ra ngoài VPS; không để backup trên cùng ổ.

## 15. Graphify và Taste Skill

- Graphify: chạy sau Phase 1; cập nhật sau thay đổi cấu trúc lớn, không chạy
  mỗi chỉnh nhỏ. Không trỏ Graphify vào thư mục backup relay.
- Taste Skill: định hướng/soát UI theo nhánh app screen. `0 FAIL` ở
  1440/768/390 là điều kiện cần, không đủ; vẫn phải test luồng, phân quyền,
  loading/empty/error, a11y.
- Playwright không thay unit/integration test.

## 16. Definition of Done

Một task/phase chỉ DONE khi:
1. Tiêu chí nghiệm thu thoả.
2. Checklist test đã chạy, có PASS/FAIL + bằng chứng.
3. Không còn FAIL chưa xử lý (hoặc có issue ghi lại).
4. Không secret trong diff.
5. Diff đã review.
6. `SESSION.md` cập nhật.

## 17. Không được làm

- Không sửa relay backup.
- Không chạy test thật khi mock chưa đạt.
- Không commit `.env.local`.
- Không thêm dịch vụ ngoài stack.
- Không tuyên bố “đã xong” khi chưa test.
