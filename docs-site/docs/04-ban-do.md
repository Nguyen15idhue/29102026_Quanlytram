---
title: Bản đồ vận hành
sidebar_position: 4
slug: /ban-do
description: Theo dõi trạm và kết nối trên bản đồ
---

# Bản đồ vận hành

Mở menu **Bản đồ → Bản đồ vận hành**.

![Bản đồ vận hành](/img/docs/map/map-light.png)

## Lớp hiển thị

Thanh công cụ bên trái bản đồ cho phép chọn lớp dữ liệu:

| Lớp | Hiển thị |
|---|---|
| Trạm | Vị trí các trạm trong phạm vi |
| Online | Tài khoản NTRIP đang kết nối |

- **Fit**: thu khung nhìn vừa toàn bộ điểm đang hiển thị.
- **Về mặc định**: trả bản đồ về khung nhìn ban đầu.

## Bộ lọc, danh sách và chú giải

- Mở **Bộ lọc** để chọn công ty, trạng thái, tỉnh/thành và loại đối tượng.
- Mở **Danh sách** để xem dạng bảng, bấm một dòng để mở chi tiết.
- Mở **Chú giải** để hiểu màu và hình dạng điểm.
- Bộ lọc được giữ trên đường dẫn; có thể chia sẻ liên kết.

## Tìm kiếm

Ô tìm kiếm nhận cả tên trạm và địa chỉ:

1. Nhập tên trạm hoặc địa chỉ.
2. Chọn kết quả trong danh sách gợi ý.
3. Bản đồ tự di chuyển tới điểm tương ứng.

## Mở chi tiết từ bản đồ

Bấm một điểm trên bản đồ để mở thanh chi tiết.

![Chi tiết từ bản đồ](/img/docs/map/drawer-light.png)

- Mỗi trạm hiển thị trạng thái, mountpoint và chất lượng gần nhất.
- Tài khoản NTRIP đang kết nối hiện thành điểm riêng.
- Đường dẫn có dạng `/map?layer=stations&station=12`, mở lại được đúng đối tượng.

## Trạng thái hiển thị

| Trạng thái | Ý nghĩa |
|---|---|
| Online | Đang có kết nối và dữ liệu |
| Không có dữ liệu | Còn kết nối nhưng chưa nhận bản tin |
| Offline | Mất kết nối |
| Chưa xác định | Chưa từng có dữ liệu để đánh giá |

## Lưu ý

- Bản đồ dùng ảnh nền công cộng, cần kết nối mạng để tải ảnh.
- Nếu ảnh nền không tải được, bảng và danh sách vẫn hoạt động bình thường.
- Vị trí hiển thị theo toạ độ trong hồ sơ trạm hoặc toạ độ dự phòng.
