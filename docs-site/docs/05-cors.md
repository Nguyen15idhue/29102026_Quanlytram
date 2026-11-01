---
title: CORS — Mountpoint và Caster
sidebar_position: 5
slug: /cors
description: Quản lý mountpoint, listener caster và kết nối NTRIP
---

# CORS — Mountpoint và Caster

## Mountpoint

Mở menu **CORS → Mountpoint**. Mountpoint là điểm phát dữ liệu để rover kết nối.

![Danh sách mountpoint](/img/docs/mountpoints/list-light.png)

### Cột hiển thị

| Cột | Ý nghĩa |
|---|---|
| STT | Số thứ tự trong trang |
| Tên | Tên mountpoint (bất biến sau khi tạo) |
| Trạm | Trạm nguồn |
| Công ty | Công ty sở hữu |
| Trạng thái | Đang phát hoặc đang tắt |
| Ghi chú | Mô tả ngắn |

### Thêm mountpoint

1. Bấm **Thêm mountpoint**.
2. Nhập tên mountpoint, chọn trạm, chế độ xác thực.
3. Chọn dịch vụ, chế độ vị trí, hệ vệ tinh và mô tả.
4. Bấm **Thêm**.

Lưu ý:

- Tên mountpoint không sửa được sau khi tạo; muốn đổi phải tạo mới.
- Tên trùng sẽ bị từ chối (lỗi `DUPLICATE_*`).
- Chỉ được gán mountpoint cho trạm trong phạm vi của bạn.
- Khi tắt mountpoint, relay dùng mountpoint đó ở hai chiều cũng tạm dừng.

### Ảnh hưởng khi thay đổi

| Thao tác | Ảnh hưởng |
|---|---|
| Tắt mountpoint | Rover đang kết nối bị ngắt; relay liên quan tạm dừng |
| Bật lại | Rover có thể kết nối lại; relay được phép chạy |
| Đổi trạm nguồn | Dữ liệu phát đi lấy từ trạm mới |

## Caster

Mở menu **CORS → Listener**. Trang có hai tab: **Listener** và **Kết nối**.

![Danh sách listener](/img/docs/caster/list-light.png)

### Tab Listener

| Cột | Ý nghĩa |
|---|---|
| STT | Số thứ tự |
| Listener | Tên listener |
| Vai trò | Nhận nguồn, phục vụ rover hoặc cả hai |
| Mountpoint | Số mountpoint gắn với listener |
| Trạng thái | Đang bật hoặc đang tắt |

Bấm **Thêm listener** để tạo nhóm cổng mới. Mỗi listener có cổng riêng; không
dùng cổng của dịch vụ khác trên cùng máy chủ.

### Tab Kết nối

Tab này liệt kê các phiên NTRIP đang mở: nguồn gửi lên và rover đang nhận.
Xem được mountpoint, tài khoản và thời điểm bắt đầu.

### Sourcetable

Rover đọc danh sách mountpoint qua sourcetable của caster. Nội dung sourcetable
chỉ gồm các mountpoint mà tài khoản được phép thấy. Nếu một mountpoint không
xuất hiện, kiểm tra lại quyền của tài khoản và trạng thái mountpoint.

### Phân biệt mã phản hồi NTRIP

| Phản hồi | Ngữ cảnh |
|---|---|
| `HTTP 200` | Yêu cầu HTTP thông thường (ví dụ tải sourcetable) |
| `ICY 200` | Kết nối NTRIP phiên bản 1 thành công |
| `SOURCETABLE 200` | Trả danh sách mountpoint thành công |
