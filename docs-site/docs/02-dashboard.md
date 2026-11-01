---
title: Dashboard
sidebar_position: 2
slug: /dashboard
description: Theo dõi tình hình hệ thống qua Dashboard
---

# Dashboard

Dashboard là màn hình đầu tiên sau khi đăng nhập. Trang tổng hợp tình hình
vận hành trong phạm vi bạn được phép xem.

![Dashboard ở giao diện sáng](/img/docs/dashboard/dashboard-light.png)

## Các vùng trên trang

| Vùng | Nội dung |
|---|---|
| Chỉ số đầu trang | Số trạm, số mountpoint, relay đang chạy, cảnh báo chưa xử lý |
| Sự cố cần xử lý | Danh sách cảnh báo đang mở, kèm đối tượng bị ảnh hưởng |
| Hoạt động gần đây | Thay đổi trạng thái và sự kiện mới nhất |

- Bấm **Làm mới** để cập nhật ngay; dữ liệu cũng tự cập nhật theo thời gian thực.
- Bấm vào một sự cố để mở chi tiết trạm hoặc relay liên quan.

## Đọc chỉ số

- **Trạm online**: trạm có kết nối nguồn dữ liệu đang hoạt động.
- **Trạm có dữ liệu**: trạm đang nhận bản tin RTCM trong thời gian gần nhất.
- **Cảnh báo**: chỉ tính cảnh báo chưa xử lý trong phạm vi của bạn.

Số liệu chỉ phản ánh phạm vi dữ liệu được cấp. Quản trị hệ thống thấy toàn hệ
thống; quản trị công ty chỉ thấy dữ liệu công ty mình; người dùng thấy dữ liệu
được giao.

## Giao diện tối

Bấm nút **Chuyển giao diện** ở góc trên bên phải để đổi sáng/tối. Lựa chọn được
ghi nhớ cho lần sau.

![Dashboard ở giao diện tối](/img/docs/dashboard/dashboard-dark.png)

## Khi số liệu không như mong đợi

1. Bấm **Làm mới**.
2. Kiểm tra bộ lọc thời gian nếu trang có hiển thị khoảng thời gian.
3. Mở **Cảnh báo** để xem sự cố đang mở.
4. Nếu vẫn lệch, xem chương [Vận hành và sự cố](../van-hanh-su-co/).
