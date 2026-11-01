---
title: Trạm
sidebar_position: 3
slug: /tram
description: Quản lý hồ sơ trạm, nguồn dữ liệu, chất lượng và lịch sử
---

# Trạm

Mỗi trạm là một điểm đo GNSS vật lý. Một trạm có thể phát nhiều mountpoint.

## Danh sách trạm

Mở menu **Trạm → Danh sách trạm**.

![Danh sách trạm](/img/docs/stations/list-light.png)

### Các cột

| Cột | Ý nghĩa |
|---|---|
| STT | Số thứ tự trong trang hiện tại |
| Tên trạm | Tên hiển thị của trạm |
| Công ty | Công ty sở hữu trạm |
| Trạng thái streaming | Online, offline, không có dữ liệu hoặc chưa xác định |
| Nguồn | Kiểu nguồn dữ liệu của trạm |
| Thiết bị | Máy thu và ăng-ten |
| Vị trí | Tỉnh/thành và toạ độ |
| MP | Số mountpoint thuộc trạm |
| Dữ liệu cuối | Thời điểm nhận bản tin gần nhất |
| Chất lượng | Điểm chất lượng gần nhất |
| Khóa/Mở khóa | Trạng thái khoá thao tác |

### Tìm kiếm và lọc

1. Nhập từ khoá vào ô tìm kiếm (tên trạm, thiết bị, vị trí).
2. Bấm **Bộ lọc** để chọn công ty, trạng thái, tỉnh/thành.
3. Bấm **Tải lại** để đọc lại dữ liệu.

Bộ lọc và trang hiện tại được giữ trên đường dẫn, nên có thể gửi liên kết cho
đồng nghiệp và họ thấy đúng màn hình bạn đang xem.

### Chọn nhiều và thao tác hàng loạt

- Tích ô ở đầu dòng để chọn; tích ô ở tiêu đề để chọn cả trang.
- Thanh thao tác hàng loạt hiện số dòng đã chọn và các nút bật/tắt, khoá/mở khoá.
- Thao tác ngoài phạm vi quyền sẽ bị bỏ qua và được báo lại số dòng không thực hiện được.

### Nhập và xuất Excel

- **Excel**: tải danh sách hiện tại ra tệp `.xlsx`.
- **Import**: chọn tệp `.xlsx`, xem trước kết quả rồi mới ghi dữ liệu.
- Tệp mẫu chỉ chứa các cột nghiệp vụ; không có mật khẩu hay khoá bí mật.

## Thêm và sửa trạm

Bấm **Thêm trạm** (hoặc nút sửa ở dòng tương ứng).

![Hộp thoại thêm trạm](/img/docs/stations/form-light.png)

Các nhóm trường chính:

| Nhóm | Trường tiêu biểu |
|---|---|
| Định danh | Tên trạm, loại trạm, công ty |
| Toạ độ | Vĩ độ, kinh độ, hệ toạ độ, tỉnh/thành, phường/xã |
| Thiết bị | Máy thu, số sê-ri, phiên bản firmware, ăng-ten, chiều cao |
| Nguồn dữ liệu | Kiểu nguồn, listener, phiên bản NTRIP, chế độ xác thực |
| Kỹ thuật | Góc che khuất, đơn vị thi công, ghi chú |

Lưu ý:

- Trường **bất biến** (ví dụ mã định danh) không sửa được sau khi tạo.
- Toạ độ dự phòng dùng khi nguồn chưa gửi bản tin vị trí.
- Nếu công ty đã được gán, không thể đổi sang công ty khác.

## Chi tiết trạm

Bấm vào tên trạm để mở ngăn chi tiết bên phải, gồm 4 tab.

![Chi tiết trạm — tab Tổng quan](/img/docs/stations/detail-overview-light.png)

| Tab | Nội dung |
|---|---|
| Tổng quan | Hồ sơ, nguồn dữ liệu, thiết bị, toạ độ, ghi chú |
| Dữ liệu | Bản tin, vệ tinh, độ trễ, C/N0 theo thời gian thực |
| Chất lượng | Điểm chất lượng, sky plot, cảnh báo chất lượng |
| Lịch sử | Các lần đổi trạng thái và phiên kết nối |

![Chi tiết trạm — tab Chất lượng](/img/docs/stations/detail-quality-light.png)

- Đường dẫn giữ tab đang mở, ví dụ `/stations/12?tab=quality`.
- Nhấn `Esc` hoặc bấm **Đóng** để thoát.
- Nút **Sửa** mở hộp thoại chỉnh sửa ngay trong ngăn chi tiết.

## Khoá và mở khoá trạm

- **Khoá** ngăn người khác sửa hồ sơ và cấu hình nguồn của trạm.
- Chỉ người có quyền sửa trạm mới mở khoá được.
- Không thể xoá trạm đang bật hoặc đang khoá; hãy tắt và mở khoá trước.

## Nguồn trạm và probe

- Nguồn `caster_ingest`: trạm gửi dữ liệu lên caster của hệ thống.
- Nguồn `relay_caster`: dữ liệu lấy từ một relay job.
- Nguồn `probe_client`: hệ thống chủ động đọc thử mountpoint (mặc định tắt).
- Nguồn `manual`: nhập tay, không tự động lấy dữ liệu.

Bật probe chỉ khi đã được cấp endpoint hợp lệ. Không thử với mountpoint công cộng.
