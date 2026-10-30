# SESSION.md

## 1. Thông tin phiên

- Thời điểm: 2026-10-30 08:49 (Asia/Ho_Chi_Minh, +07:00)
- Phase hiện tại: Phase 0 — Chuẩn bị & xác minh
- Trạng thái Phase 0: DONE
- Người thực hiện: OpenCode

## 2. Trạng thái

### Đã làm
- Đọc `docs/0/KE_HOACH_CHI_TIET.md` (v2)
- Đọc `docs/0/CAC_BUOC_THUC_HIEN.md` (v2)
- Baseline relay read-only (không sửa file)
- Tạo `AGENTS.md`, `TASKS.md`, `SESSION.md`, `README.md`,
  `.env.example`, `.gitignore`

### Đã kiểm tra
- Kiểm tra cuối Phase 0: PASS (xem mục 8)

### Tiếp theo
- Phase 1 — Skeleton & hợp đồng dữ liệu

### Blocker
- Không có

## 3. Baseline relay (read-only)

Đường dẫn: `F:\3.Laptrinh\1. Project\1. GNSS\relayrtcm\backup`

- Ngôn ngữ: Go 1.24.5, module `relayrtcm`
- Deps trực tiếp: `golang.org/x/net` (SOCKS5), `modernc.org/sqlite`
- Bản chất: NTRIP **bridge** GET upstream -> POST downstream, không phải caster
- Bằng chứng: `main.go:690` (GET), `main.go:724` (POST), `main.go:1071` (ICY 200)
- Hỗ trợ: chunked, SOCKS5, TLS, NMEA, backoff, đếm byte
- Monitor: cổng `8081` (`main.go:31`)
- History: SQLite (`history.go`, `OpenHistoryStore`)
- Không có RTCM framing/CRC24Q, không có caster/ACL/multi-client
- `config.json`: 65 job, 64 job bật; có trường `src_pass`/`dst_pass`
  (không đọc/in giá trị)

### SHA256 baseline

```text
main.go             74D084C01455802377B6C34393CA0BFC92C165DF540A31AA8D01221255A293DA
history.go          664B27B4B4776A8810123FB5939D0ADC977C72A2CC2C016FC88F41AE8F5A432D
go.mod              EC8F40D45A2A29D86EEBA34EC0F5C0A71F30FFFD5CEDDAC9C43BE2F709E47D14
config.json         5ACAFA85D114CF4EC8A0A448BA7A69CD06F7EA5893C47CD82667494DC4608FF8
README.md           130FDFCDF03815FA4FC554F99FF99A91053A9111D7A6F8D6207EC51883409314
chunked_test.go     B27F350D317417022600FBF4BE128C4FA07A1DE8D923E9678398405037B74608
history_test.go     E386AA0C30C9B433EE04D6CE02F52EBDBB5E8D3784D25735BDF9E503611440BC
config.example.json 18ADE398DAD06C76CA161946675B94360846FB0C22B570A9C63FAB7B6DB4A18C
```

## 4. Quyết định đã chốt (tóm tắt)

- D1: Không đụng relay backup.
- D2: Port relay vào codebase mới, bỏ binary cũ.
- D3: Bỏ history SQLite; chỉ giữ dữ liệu kết nối `config.json`.
- D4: Relay là menu/thực thể riêng.
- D5: Chỉ MySQL.
- D6: Go ghi MySQL trực tiếp.
- D7: Caster ở Phase 4.
- D8–D10: Mock-first; test thật chỉ endpoint được phép; mặc định disabled.
- D11: Import 2–3 job giai đoạn đầu.
- D12: Credential không commit/log.
- D13: Hiển thị +07; lưu trữ UTC/epoch.
- D14: RBAC role + permission + scope.
- D15: Tách web account và NTRIP account.
- D16: Auth web bằng session cookie + CSRF.
- D17: Schema ownership Model A; hai version.
- D18: Station khác Mountpoint.
- D19: Soft-delete relay job.
- D20: Reconcile bằng revision.
- D21: Internal API HMAC + nonce.
- D22: Audit redaction.
- D23: Không dùng room role cho dữ liệu nhạy cảm.
- D24: Go restart phải có test.

## 5. Giả định đang mở

- MySQL 8 chạy cùng VPS/Docker Compose.
- Node và Go dùng chung MySQL server, khác schema/quyền.
- Chưa có mã nguồn; mọi lệnh trong README là dự kiến.
- VPS sẽ được chọn sau; Phase 0 không phụ thuộc nhà cung cấp.

## 6. Rủi ro đang theo dõi

- Test thật NTRIP có thể ảnh hưởng dịch vụ nếu chưa kiểm soát quyền.
- 65 relay job + MySQL + Node trên VPS nhỏ cần tối ưu RAM/disk.
- Secret trong `config.json` cũ có thể lọt vào log/audit nếu không redaction.
- Reconcile Node–Go có thể lệch trạng thái nếu thiếu revision.
- RBAC scope có thể sai nếu thiếu `owner_web_user_id` ở bảng nghiệp vụ.

## 7. Nhật ký thay đổi Phase 0

| File | Hành động | Ghi chú |
|---|---|---|
| `AGENTS.md` | Tạo | Quy tắc làm việc |
| `TASKS.md` | Tạo | Backlog Phase 0–5 |
| `SESSION.md` | Tạo | Trạng thái phiên |
| `README.md` | Tạo | Hướng dẫn dự kiến |
| `.env.example` | Tạo | Chỉ tên biến |
| `.gitignore` | Tạo | Bảo vệ secret/build |

## 8. Kết quả kiểm tra cuối Phase 0

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Đủ 6 file Phase 0 | PASS | AGENTS, TASKS, SESSION, README, .env.example, .gitignore |
| Không secret trong repo | PASS | Quét mẫu secret: 0 match; không có `.env.local` |
| Relay backup không đổi | PASS | SHA256 main.go/history.go/go.mod/config.json khớp baseline |
| Không có mã nguồn ứng dụng | PASS | Không có `frontend/`, `server/`, `gnss/`, `docker-compose.yml` |
| Không docker/package/migration | PASS | Không chạy lệnh nào |
| Tài liệu khớp docs v2 | PASS | Nội dung theo KE_HOACH/CAC_BUOC v2 |

Ghi chú: `git status` có mục `D docs/0/~$...docx` — đây là file khóa tạm của Word,
không liên quan Phase 0 và không phải file nội dung. Không khôi phục file tạm này.

## 9. Cập nhật lần cuối

- 2026-10-30 08:50 +07:00
