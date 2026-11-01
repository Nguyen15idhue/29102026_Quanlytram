---
title: Cảnh báo và Lịch sử
sidebar_position: 8
slug: /canh-bao-lich-su
description: Xử lý cảnh báo và tra cứu lịch sử hoạt động
---

# Cảnh báo và Lịch sử

## Cảnh báo

Mở menu **Hệ thống → Cảnh báo**.

![Danh sách cảnh báo](/img/docs/alerts/list-light.png)

### Các cột

| Cột | Ý nghĩa |
|---|---|
| STT | Số thứ tự |
| Mức độ | Nghiêm trọng, cảnh báo hoặc thông tin |
| Cảnh báo | Tiêu đề và nội dung |
| Đối tượng | Relay job, caster hoặc hệ thống bị ảnh hưởng |
| Thời điểm | Lúc cảnh báo được tạo |
| Trạng thái | Đang mở hoặc đã xử lý |

### Xử lý cảnh báo

1. Bấm vào cảnh báo để xem đối tượng liên quan.
2. Khắc phục nguyên nhân (ví dụ bật lại nguồn, kiểm tra kết nối).
3. Bấm **Đánh dấu đã đọc** để đóng cảnh báo.

Lưu ý:

- Cảnh báo trùng nguyên nhân được gộp theo khoá chống trùng.
- Hệ thống không tự tắt relay hay tự đổi cấu hình khi có cảnh báo.
- Cảnh báo chỉ hiển thị trong phạm vi dữ liệu bạn được xem.

### Mức độ

| Mức | Khi nào |
|---|---|
| Nghiêm trọng | Mất dữ liệu hoặc mất kết nối ảnh hưởng rover |
| Cảnh báo | Chất lượng giảm, sắp chạm ngưỡng |
| Thông tin | Thay đổi trạng thái theo kế hoạch |

## Lịch sử

Mở menu **Hệ thống → Lịch sử**.

![Lịch sử relay](/img/docs/history/list-light.png)

Trang có 4 tab:

| Tab | Nội dung |
|---|---|
| Phiên | Phiên relay: thời điểm bắt đầu, thời lượng, kết quả, lý do đóng |
| Sự kiện | Sự kiện rời rạc: mất kết nối, đổi trạng thái, lỗi xác thực |
| Theo giờ | Tổng hợp theo giờ để xem xu hướng |
| Audit | Thay đổi cấu hình và thao tác quản trị |

### Tra cứu

1. Chọn tab phù hợp.
2. Chọn khoảng thời gian và đối tượng.
3. Bấm **Tải lại**.

Lý do đóng phiên thường gặp:

| Lý do | Ý nghĩa |
|---|---|
| Nguồn đóng kết nối | Bên gửi dữ liệu chủ động ngắt |
| Đích đóng kết nối | Caster đích ngắt kết nối |
| Dịch vụ khởi động lại | Hệ thống relay khởi động lại |
| Tạm dừng theo cấu hình | Job hoặc mountpoint bị tắt |
| Lỗi xác thực | Sai tài khoản hoặc mật khẩu |

Audit ghi lại ai đổi gì và khi nào, đã che các trường bí mật. Không xem được
mật khẩu trong audit.
