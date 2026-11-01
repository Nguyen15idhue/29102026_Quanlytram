---
title: Tài khoản NTRIP
sidebar_position: 6
slug: /tai-khoan-ntrip
description: Quản lý tài khoản rover dùng để kết nối caster
---

# Tài khoản NTRIP

Tài khoản NTRIP là tài khoản rover dùng để kết nối vào caster. Tài khoản này
**không** dùng để đăng nhập giao diện quản trị.

Mở menu **Tài khoản → Tài khoản NTRIP**.

![Danh sách tài khoản NTRIP](/img/docs/ntrip/list-light.png)

## Các cột

| Cột | Ý nghĩa |
|---|---|
| STT | Số thứ tự |
| Username | Tên đăng nhập của rover |
| Trạng thái | Đang hoạt động hoặc đã khoá |
| Max conn | Số kết nối đồng thời tối đa |
| Khu vực | Phạm vi sử dụng |
| Đơn vị | Công ty hoặc đơn vị sử dụng |
| Công ty | Công ty sở hữu tài khoản |
| Hiệu lực | Khoảng thời gian tài khoản được dùng |
| Owner | Người phụ trách |

## Thêm tài khoản

1. Bấm **Thêm tài khoản**.
2. Nhập username, mật khẩu, số kết nối tối đa.
3. Chọn công ty, khu vực, thời gian hiệu lực.
4. Nhập thông tin liên hệ và ghi chú.
5. Bấm **Thêm**.

![Hộp thoại thêm tài khoản NTRIP](/img/docs/ntrip/form-light.png)

Lưu ý:

- Username không sửa được sau khi tạo.
- Mật khẩu chỉ hiển thị khi nhập; hệ thống không hiển thị lại mật khẩu đã lưu.
- Tài khoản chỉ thấy các mountpoint được cấp; quyền này kiểm tra ở caster, không chỉ ở giao diện.

## Khoá và xoá

- **Khoá** tài khoản: các kết nối đang mở của tài khoản bị đóng ngay.
- **Xoá** tài khoản: cũng đóng các kết nối đang mở và không thể hoàn tác.
- Tài khoản bị khoá sẽ nhận lỗi `ACCOUNT_LOCKED` khi kết nối.

## Kiểm tra nhanh khi rover không kết nối được

1. Tài khoản có đang **hoạt động** và còn trong thời gian hiệu lực?
2. Đã đạt giới hạn **Max conn**?
3. Mountpoint đang bật và thuộc phạm vi tài khoản?
4. Cổng listener có đang mở và đúng giao thức NTRIP?

| Lỗi | Nguyên nhân thường gặp |
|---|---|
| `403 ACCOUNT_LOCKED` | Tài khoản bị khoá hoặc hết hiệu lực |
| `403 FORBIDDEN` | Tài khoản không có mountpoint tương ứng |
| `409 DUPLICATE_*` | Username đã tồn tại |
