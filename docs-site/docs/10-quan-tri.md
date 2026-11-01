---
title: Quản trị
sidebar_position: 10
slug: /quan-tri
description: Công ty, người dùng web, vai trò và trang cá nhân
---

# Quản trị

Chương này dành cho quản trị hệ thống và quản trị công ty. Người dùng thường
chỉ cần phần **Trang cá nhân**.

## Người dùng web

Mở menu **Hệ thống → Người dùng**.

![Danh sách người dùng web](/img/docs/users/list-light.png)

| Cột | Ý nghĩa |
|---|---|
| STT | Số thứ tự |
| Username | Tên đăng nhập |
| Tên | Tên hiển thị và email |
| Vai trò | Vai trò được gán |
| Công ty | Công ty trực thuộc |
| Đăng nhập cuối | Lần đăng nhập gần nhất |
| Trạng thái | Đang hoạt động hoặc đã khoá |

### Thêm và sửa

1. Bấm **Thêm tài khoản**.
2. Nhập username, tên hiển thị, email, vai trò, công ty.
3. Đặt mật khẩu ban đầu.
4. Bấm **Thêm**.

Quy tắc bắt buộc:

- Không quản lý được người có cấp vai trò cao hơn hoặc bằng mình.
- Không sửa hoặc xóa tài khoản `super_admin`.
- Không xóa quản trị hệ thống cuối cùng.
- Username không sửa được sau khi tạo.
- Import người dùng từ `.xlsx` không có cột mật khẩu; hệ thống tạo mật khẩu mặc
  định và ghi audit. Không export mật khẩu.

## Vai trò và quyền

Mở menu **Hệ thống → Phân quyền**.

![Vai trò và quyền](/img/docs/roles/list-light.png)

Mỗi vai trò gồm hai phần:

| Phần | Ý nghĩa |
|---|---|
| Quyền theo module | Xem, thêm, sửa, xóa trên từng module |
| Phạm vi dữ liệu | Toàn hệ thống, nhánh, của mình hoặc không có |

Ba vai trò mặc định:

| Vai trò | Phạm vi | Ghi chú |
|---|---|---|
| Quản trị hệ thống | Toàn hệ thống | Quản lý công ty, người dùng, cấu hình |
| Quản trị công ty | Dữ liệu công ty | Quản lý tài nguyên trong công ty |
| Người dùng | Dữ liệu được giao | Chỉ thao tác trong phạm vi được cấp |

Lưu ý:

- Vai trò hệ thống không sửa và không xóa được (`SYSTEM_ROLE`).
- Không xóa vai trò đang được gán (`ROLE_IN_USE`).
- Mọi thay đổi quyền được ghi audit.

## Công ty

Mở menu **Hệ thống → Công ty** (chỉ quản trị hệ thống).

- Mỗi công ty có nhiều quản trị viên.
- Tài nguyên tạo trong công ty chỉ hiển thị với người thuộc công ty đó.
- Tắt công ty sẽ chặn đăng nhập của người dùng thuộc công ty.
- Chỉ xóa được công ty khi không còn dữ liệu (`COMPANY_IN_USE`).

## Trang cá nhân

Mở bằng cách bấm tên người dùng ở góc trên bên phải.

![Trang cá nhân](/img/docs/profile/profile-light.png)

Ba vùng chính:

| Vùng | Việc được làm |
|---|---|
| Hồ sơ | Sửa tên hiển thị và email |
| Đổi mật khẩu | Nhập mật khẩu hiện tại và mật khẩu mới |
| Phiên đăng nhập | Xem thiết bị/IP và thời hạn phiên |

Người dùng tự sửa hồ sơ chỉ được đổi **tên hiển thị**, **email** và **mật khẩu**.
Các trường khác do quản trị viên quản lý.
