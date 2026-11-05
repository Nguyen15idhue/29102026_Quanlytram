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

### Trạm reconnect

Khi trạm mở kết nối nguồn mới cho cùng một mountpoint, caster coi kết nối mới
nhất là kết nối hiện tại:

- Kết nối mới được nhận ngay, không bị `409 Conflict`.
- Kết nối cũ bị đóng với lý do `source_replaced`.
- Rover đang nhận được giữ tối đa `SourceGrace` (mặc định 10 giây) để chờ
  nguồn mới; không bị đóng oan nếu trạm reconnect nhanh.
- Dữ liệu còn lại từ kết nối cũ bị bỏ, không trộn vào luồng mới.

Không cấu hình hai thiết bị cùng ghi vào một mountpoint. Caster sẽ để thiết bị
kết nối sau cùng thắng, nên hai nguồn sẽ tranh nhau nếu cùng chạy.

### Account dùng chung

Nếu nhiều relay hoặc trạm cùng dùng một account NTRIP, kiểm tra
`ntrip_accounts.max_connections` lớn hơn hoặc bằng số kết nối đồng thời. Nếu
không, kết nối mới có thể bị `503 Maximum Connections Reached` dù job khác đang
lỗi. Dùng `scripts/audit-ntrip-accounts.sql` để rà soát.
