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

Form chia 3 phần: **Nguồn dữ liệu**, **Đích đến dữ liệu**, **Thông tin khác**.

1. Bấm **Thêm relay job**.
2. **Nguồn dữ liệu**: chọn Mode
   - `Nhập thủ công` (mặc định): nhập host, cổng, mountpoint, proxy, SSL,
     phiên bản NTRIP, username, mật khẩu.
   - `Chọn trạm`: chọn một trạm có sẵn trong phạm vi quyền. Hệ thống tự dùng
     nguồn của trạm: trạm `ntrip_caster` dùng mountpoint trên caster nội bộ;
     trạm `ntrip_client` dùng `client_host/client_port/client_mount` (nguồn NTRIP
     bên ngoài) vì mountpoint nội bộ không có dữ liệu. Mật khẩu đã lưu được
     dùng tự động; form chỉ hiện dòng tóm tắt để kiểm tra.
3. **Đích đến dữ liệu**: cấu trúc tương tự, kèm **Đích mode** (`auto`/`post`/
   `source`). Nếu trạm có nhiều mountpoint thì chọn thêm mountpoint.
4. Chỉ được chọn trạm ở **một phía**. Khi một phía dùng `Chọn trạm`, phía còn
   lại bị khóa ở `Nhập thủ công` và form hiện banner giải thích — tránh relay
   vòng một trạm về chính nó.
5. **Thông tin khác**: tên (bắt buộc), external key, tick **Có gửi GGA** (hiện
   vĩ độ, kinh độ, NMEA interval), UA prefix, tick **Bật relay job**.
6. Bấm **Thêm**.

Trạm hiển thị theo quyền `stations.view`: superadmin thấy mọi trạm, admin/user
chỉ thấy trạm thuộc công ty mình. Relay do superadmin tạo chỉ superadmin thấy.

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

## Phiên và uptime

- Phiên relay được ghi **ngay khi bắt đầu**. Trong lúc đang chạy, tab Lịch sử
  hiển thị **Đang chạy**; khi phiên kết thúc mới có thời lượng và lý do đóng.
- Khi dịch vụ khởi động lại, các phiên còn mở từ lần chạy trước được đóng với
  lý do `service_restart` để không treo trạng thái.
- Thời lượng online được chia theo từng giờ UTC. Uptime 24 giờ lấy từ dữ liệu
  chất lượng thực tế, nên phiên đang chạy vẫn được tính.
- Caster đích (ví dụ onocoy) có thể tự reset kết nối TCP khi họ cập nhật hệ
  thống. Relay sẽ reconnect trong vài giây; đây là reset phía đích, không phải
  lỗi timeout của relay. Biểu đồ 24 giờ có thể gộp các khoảng ngắt rất ngắn
  thành một đoạn online; muốn đếm chính xác từng lần ngắt, xem tab Lịch sử →
  Phiên hoặc cột lỗi/reconnect.
