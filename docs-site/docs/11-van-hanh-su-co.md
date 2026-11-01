---
title: Vận hành và sự cố
sidebar_position: 11
slug: /van-hanh-su-co
description: Mã lỗi, checklist chẩn đoán, log và sao lưu
---

# Vận hành và sự cố

## Mã lỗi thường gặp

| HTTP | Mã | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Dữ liệu nhập sai định dạng |
| 400 | `COMPANY_REQUIRED` | Thiếu công ty khi tạo tài nguyên |
| 400 | `OWNER_COMPANY_MISMATCH` | Người phụ trách khác công ty |
| 400 | `COMPANY_IMMUTABLE` | Cố đổi công ty sau khi tạo |
| 400 | `INVALID_PARENT` | Người quản lý không hợp lệ |
| 400 | `STATION_ENABLED` / `STATION_LOCKED` | Xóa trạm khi còn bật hoặc còn khoá |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Chưa đăng nhập hoặc phiên hết hạn |
| 403 | `FORBIDDEN` | Thiếu quyền hoặc ngoài phạm vi |
| 403 | `CSRF_INVALID` | Phiên làm việc không hợp lệ, cần tải lại trang |
| 403 | `ACCOUNT_LOCKED` | Tài khoản bị khoá |
| 403 | `COMPANY_DISABLED` | Công ty bị tắt |
| 403 | `SYSTEM_ROLE` | Cố sửa hoặc xóa vai trò hệ thống |
| 404 | `NOT_FOUND` | Không tồn tại hoặc ngoài phạm vi |
| 409 | `LAST_SUPER_ADMIN` | Thao tác sẽ làm mất quản trị hệ thống cuối |
| 409 | `SELF_DELETE` / `SELF_LOCK` | Tự xóa hoặc tự khoá mình |
| 409 | `DUPLICATE_*` | Trùng tên, cổng, username |
| 409 | `ROLE_IN_USE` | Xóa vai trò đang được gán |
| 409 | `COMPANY_IN_USE` | Xóa công ty còn dữ liệu |
| 409 | `IMMUTABLE_FIELD` | Sửa trường không được phép |
| 429 | `RATE_LIMITED` | Thao tác quá nhanh, chờ rồi thử lại |

## Checklist chẩn đoán

### Trạm không có dữ liệu

1. Mở chi tiết trạm, xem tab **Tổng quan**.
2. Kiểm tra trạng thái streaming và nguồn dữ liệu.
3. Kiểm tra mountpoint của trạm có đang bật.
4. Kiểm tra listener và tài khoản nguồn còn hiệu lực.
5. Xem **Lịch sử → Sự kiện** để tìm lỗi xác thực hoặc mất kết nối.

### Rover không nhận được dữ liệu

1. Xác nhận mountpoint đang phát.
2. Kiểm tra tài khoản NTRIP: trạng thái, hiệu lực, `Max conn`.
3. Kiểm tra quyền tài khoản trên mountpoint.
4. Xem **CORS → Listener → Kết nối** để biết rover đã vào chưa.

### Relay không chạy

1. Xem trạng thái job và cột Applied/desired.
2. Kiểm tra job có bị tạm dừng bởi trạm hoặc mountpoint không.
3. Kiểm tra thông tin xác thực hai đầu.
4. Xem lịch sử phiên và lý do đóng.

## Kiểm tra sức khỏe dịch vụ

Người vận hành có thể kiểm tra nhanh trên máy chủ:

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:7080/health
docker compose ps
```

Kỳ vọng: các container ở trạng thái healthy và API trả về phiên bản schema hợp lệ.

## Xem log

```bash
docker compose logs --tail=200 server
docker compose logs --tail=200 gnss
```

Log đã che authorization, cookie, mật khẩu và token. Không dán log chứa thông
tin phiên lên kênh công khai.

## Sao lưu và phục hồi

- Sao lưu định kỳ cơ sở dữ liệu MySQL ra ngoài máy chủ.
- Không để bản sao lưu trên cùng ổ đĩa với dữ liệu đang chạy.
- Kiểm tra phục hồi định kỳ; chỉ coi là thành công khi đếm được số dòng sau phục hồi.
- Khi cần khôi phục, thực hiện theo quy trình vận hành và ghi lại thời điểm.

## Khi cần hỗ trợ

Chuẩn bị trước:

1. Đường dẫn trang và thời điểm xảy ra (giờ Việt Nam).
2. Mã lỗi hiển thị trên màn hình.
3. Ảnh chụp màn hình (che thông tin nhạy cảm).
4. Tên trạm, mountpoint hoặc relay liên quan.
