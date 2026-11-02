---
title: Relay
sidebar_position: 7
slug: /relay
description: Cấu hình và theo dõi relay job
---

# Relay

Relay job chuyển tiếp dữ liệu RTCM từ nguồn này sang caster khác. Dữ liệu được
truyền nguyên byte, không chỉnh sửa.

Mở menu **Relay → Relay jobs**.

![Danh sách relay job](/img/docs/relay/list-light.png)

## Các cột

| Cột | Ý nghĩa |
|---|---|
| STT | Số thứ tự |
| Tên | Tên relay job |
| Công ty | Công ty sở hữu |
| Nguồn | Host, cổng và mountpoint lấy dữ liệu |
| Đích | Host, cổng và mountpoint gửi dữ liệu |
| Trạng thái | Đang chạy, tạm dừng hoặc đang tắt |
| Applied / desired | Cấu hình đã áp dụng và cấu hình mong muốn |

- Bấm biểu tượng bút chì để sửa.
- Bấm nút chạy/tạm dừng để đổi trạng thái job.
- Các thao tác khác: tải lại, kiểm tra kết nối, xoá (xoá mềm, giữ lịch sử).

## Thêm relay job

1. Bấm **Thêm relay job**.
2. Nhập tên và external key (nếu có).
3. Nhập thông tin nguồn: host, cổng, mountpoint, proxy, SSL, phiên bản NTRIP,
   username và mật khẩu.
4. Nhập thông tin đích tương tự.
5. Chọn chế độ gửi dữ liệu sang đích.
6. Bấm **Thêm**.

![Hộp thoại thêm relay job](/img/docs/relay/form-light.png)

## Chế độ gửi dữ liệu

| Chế độ | Cách gửi |
|---|---|
| `auto` | Hệ thống tự chọn cách phù hợp với caster đích |
| `post` | Gửi qua HTTP POST |
| `source` | Gửi theo giao thức SOURCE của NTRIP |

Nếu chưa rõ caster đích hỗ trợ gì, giữ `auto`.

## Tạm dừng và tự dừng

- **Tạm dừng thủ công**: job dừng nhưng cấu hình giữ nguyên.
- **Tự dừng theo trạm hoặc mountpoint**: khi trạm nguồn bị tắt hoặc mountpoint
  bị tắt, relay liên quan tự tạm dừng và tự chạy lại khi nguồn hoạt động.
- Khi job đang bị tạm dừng bởi hệ thống, thao tác thủ công có thể bị từ chối với
  lỗi `409` và thông báo lý do.

## Import JSON

1. Bấm **Import JSON**.
2. Chọn tệp cấu hình.
3. Xem kết quả kiểm tra (thêm mới, cập nhật, bỏ qua).
4. Chọn chạy thử hoặc áp dụng.

Import chạy lại nhiều lần không tạo bản ghi trùng. Bản ghi đã xoá mềm được giữ
lại trong lịch sử theo thời gian lưu trữ.

## Ma trận trạng thái

Mỗi relay job có thể ở một trong các trạng thái sau. Trạng thái hiển thị ưu tiên
cấu hình, nên đổi trạng thái là thấy ngay, không phải chờ dữ liệu runtime.

| Trạng thái | Ý nghĩa | Badge |
|---|---|---|
| `locked` | Đang khóa, không cho đổi cấu hình | offline |
| `paused` | Tạm dừng do trạm hoặc mountpoint nguồn đang tắt | offline |
| `disabled` | Đã tắt theo cấu hình | offline |
| `pending` | Đã lưu nhưng chưa áp dụng xong | offline |
| `online` | Đang truyền dữ liệu cả hai chiều | online |
| `no_data` | Có kết nối nhưng một chiều chưa có dữ liệu | không có dữ liệu |
| `offline` | Không có kết nối | offline |

### Hành động hợp lệ

| Hành động | Chỉ thực hiện được khi |
|---|---|
| Bật | Job không khóa và nguồn không bị tạm dừng |
| Tắt | Job không khóa |
| Khóa | Job đã tắt, không còn chờ áp dụng và không còn kết nối |
| Mở khóa | Job đang khóa; sau khi mở vẫn ở trạng thái tắt |
| Khởi động lại | Job đang bật và không khóa |
| Kiểm tra kết nối | Job không khóa |
| Sửa cấu hình | Luôn sửa được metadata, nhưng không được bật lại job đang khóa |
| Xóa | Job đã tắt, đã mở khóa và không còn kết nối |

Ghi chú:

- Khóa relay sẽ chuyển trạng thái sang **offline** ngay trên giao diện.
- Dịch vụ relay dừng phiên trong tối đa khoảng 10 giây; lịch sử ghi lý do `disabled`.
- Xóa là xóa mềm: cấu hình và lịch sử vẫn được giữ để tra cứu.
- Job bị tạm dừng do trạm/mountpoint nguồn chỉ tự chạy lại khi nguồn hoạt động
  và job không bị khóa.

## Chống vòng lặp

- Hệ thống tự phát hiện job trỏ về chính nó.
- Chuỗi relay vòng tròn trong cùng hệ thống cũng bị chặn.
- Với hệ thống ngoài, chỉ có thể giới hạn theo cấu hình; không phát hiện được
  vòng lặp nằm hoàn toàn bên ngoài.

## Theo dõi chất lượng

Mở chi tiết relay job để xem chất lượng theo hai chiều:

- Số bản tin, tỷ lệ mất gói, độ trễ.
- Trạng thái từng chiều (nguồn và đích).
- Lịch sử phiên và lý do đóng phiên.
