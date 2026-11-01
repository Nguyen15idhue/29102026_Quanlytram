---
title: Hệ thống
sidebar_position: 9
slug: /he-thong
description: Sức khỏe hệ thống, tối ưu, tự động hóa và cấu hình bản đồ
---

# Hệ thống

## Trang Hệ thống

Mở menu **Hệ thống → Hệ thống**. Trang gồm các tab tùy theo quyền:

| Tab | Ai thấy | Nội dung |
|---|---|---|
| Sức khỏe | Có quyền xem sức khỏe hệ thống | Trạng thái Node, máy chủ, MySQL, tiến trình GNSS |
| Tối ưu | Quản trị vận hành | Chỉ số tối ưu, gợi ý xử lý |
| Tự động hóa | Quản trị vận hành | Cấu hình dọn dẹp định kỳ và chạy tay |

![Sức khỏe hệ thống](/img/docs/system/health-light.png)

### Đọc trang Sức khỏe

1. Xem trạng thái tổng ở đầu trang.
2. Kiểm tra từng thẻ: Node, máy chủ, MySQL, GNSS.
3. Bấm **Tải lại** để cập nhật ngay; trang cũng tự cập nhật định kỳ.

| Trạng thái | Ý nghĩa |
|---|---|
| Hoạt động | Thành phần phản hồi bình thường |
| Suy giảm | Phản hồi chậm hoặc thiếu một nguồn số liệu |
| Lỗi | Không phản hồi hoặc phản hồi sai |

Nếu một thành phần báo lỗi, xem chương [Vận hành và sự cố](../van-hanh-su-co/).

### Tab Tự động hóa

- Xem các job dọn dẹp định kỳ và ngưỡng lưu trữ.
- Mỗi job có trạng thái, lần chạy gần nhất và số dòng đã xóa.
- **Chạy thử** chỉ đếm, không xóa. **Chạy ngay** thực hiện thật và ghi lịch sử.
- Thay đổi ngưỡng cần quyền quản trị vận hành và được ghi audit.

## Cấu hình bản đồ

Mở menu **Hệ thống → Cấu hình bản đồ**.

![Cấu hình bản đồ](/img/docs/system/map-config-light.png)

Các nhóm cấu hình:

| Nhóm | Nội dung |
|---|---|
| Nhà cung cấp ảnh nền | Chọn nguồn ảnh nền và chế độ tải |
| Khoá dịch vụ | Khoá của dịch vụ địa chỉ (không hiển thị lại sau khi lưu) |
| Kiểm tra kết nối | Thử từng nhà cung cấp trước khi lưu |

Lưu ý:

- Chỉ người có quyền sửa cấu hình mới thấy trang này.
- Thay đổi được ghi audit, giá trị bí mật được che.
- Sau khi lưu, tải lại trang bản đồ để áp dụng.
