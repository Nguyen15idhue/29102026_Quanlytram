---
title: Bắt đầu sử dụng
sidebar_position: 1
slug: /bat-dau
description: Đăng nhập, phiên làm việc, giao diện sáng tối và menu theo vai trò
---

# Bắt đầu sử dụng

## Đăng nhập

1. Mở địa chỉ hệ thống do quản trị viên cung cấp.
2. Nhập **Tên đăng nhập** và **Mật khẩu**.
3. Bấm **Đăng nhập**.

Nếu sai thông tin, hệ thống hiện thông báo lỗi ngay trên form. Sau nhiều lần sai
liên tiếp, việc đăng nhập tạm thời bị giới hạn để bảo vệ tài khoản.

Hệ thống không có chức năng tự đặt lại mật khẩu. Khi quên mật khẩu, hãy liên hệ
quản trị hệ thống để được cấp lại.

![Trang đăng nhập](/img/docs/auth/login-light.png)

## Phiên làm việc

- Phiên gắn với trình duyệt hiện tại; đóng trình duyệt không làm mất phiên ngay.
- Khi quản trị viên đổi quyền hoặc khoá tài khoản, phiên đang mở sẽ bị thu hồi và
  bạn được đưa về trang đăng nhập.
- Bấm biểu tượng **Đăng xuất** ở góc trên bên phải để kết thúc phiên.

## Giao diện sáng và tối

- Hệ thống mặc định theo thiết lập của hệ điều hành.
- Bấm nút **Chuyển giao diện** trên thanh trên cùng để đổi giữa sáng và tối.
- Lựa chọn được ghi nhớ cho lần truy cập sau.

## Menu theo vai trò

Menu chính gồm các nhóm sau, theo đúng thứ tự hiển thị:

| Nhóm | Mục | Ai thấy |
|---|---|---|
| Tổng quan | Dashboard | Mọi vai trò |
| Trạm | Danh sách trạm | Có quyền xem trạm |
| Bản đồ | Bản đồ vận hành, Danh sách online | Có quyền xem trạm / kết nối |
| CORS | Mountpoint, Listener | Có quyền xem mountpoint / caster |
| Tài khoản | Tài khoản NTRIP | Có quyền xem tài khoản NTRIP |
| Relay | Relay jobs | Có quyền xem relay |
| Hướng dẫn | Hướng dẫn sử dụng | Mọi vai trò |
| Hệ thống | Hệ thống, Cấu hình bản đồ, Cảnh báo, Lịch sử, Người dùng, Công ty, Phân quyền | Theo quyền từng mục |

Trên màn hình hẹp, bấm biểu tượng menu ở góc trái để mở danh sách. Nhấn `Esc` để đóng.

## Mẹo dùng nhanh

- Mọi danh sách đều có ô tìm kiếm và bộ lọc; bộ lọc được giữ trên đường dẫn nên có
  thể chia sẻ liên kết cho đồng nghiệp.
- Cột **STT** là số thứ tự trong trang hiện tại, không phải mã định danh.
- Bảng mặc định 10 dòng mỗi trang; có thể đổi 10, 20 hoặc 50.
- Nhấn `Esc` để đóng hộp thoại đang mở mà không lưu thay đổi.
