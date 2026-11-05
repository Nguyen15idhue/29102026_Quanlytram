---
title: Hướng dẫn tổng quát
sidebar_label: Hướng dẫn tổng quát
slug: /huong-dan-tong-quat
---

# Hướng dẫn tổng quát

Trang này gom các thao tác thường dùng theo đúng thứ tự: tạo trạm, tạo mountpoint,
tạo tài khoản NTRIP, lấy thông tin kết nối và xử lý lỗi. Mỗi mục có mã neo
(`#tao-tram`, `#tao-mountpoint`, …) để các trang trong ứng dụng mở thẳng tới đúng phần.

## Tạo trạm {#tao-tram}

Trạm là thiết bị/thực thể vật lý. Một trạm có thể có nhiều mountpoint.

1. Mở **Trạm → Thêm trạm**.
2. Điền tên, mã, công ty, khu vực và toạ độ (nếu có).
3. Chọn kiểu nguồn dữ liệu: thiết bị đẩy trực tiếp lên caster, relay kéo từ
   caster khác, hoặc probe GET-only.
4. Lưu, sau đó kiểm tra trạng thái ở trang chi tiết trạm.

![Hộp thoại thêm trạm](/img/docs/stations/form-light.png)

## Tạo mountpoint {#tao-mountpoint}

Mountpoint là endpoint dữ liệu rover kết nối vào. Tên mountpoint phải duy nhất
trên toàn hệ thống.

1. Mở **CORS → Mountpoint → Thêm mountpoint**.
2. Chọn trạm chủ (có thể để trống với mountpoint độc lập), bật/tắt và gán listener.
3. Lưu ý: mountpoint không gắn trạm vẫn nhận kết nối nhưng không có toạ độ để
   hiển thị trên bản đồ.

![Danh sách mountpoint](/img/docs/mountpoints/list-light.png)

## Tạo tài khoản NTRIP {#tao-tai-khoan}

Tài khoản NTRIP là tài khoản xác thực ở caster, **không phải** tài khoản đăng nhập web.

1. Mở **Tài khoản → Tài khoản NTRIP → Thêm tài khoản**.
2. Nhập username (tối thiểu 3 ký tự, chỉ chữ/số/`_.-`) và mật khẩu tối thiểu 8 ký tự.
3. Gán công ty trùng với công ty của listener và cấp ACL mountpoint được phép dùng.
4. Chọn `max_connections` phù hợp; tài khoản bị tắt sẽ không xác thực được.

![Biểu mẫu tài khoản NTRIP](/img/docs/ntrip/form-light.png)

:::note
Trang **Danh sách online** chỉ hiển thị tài khoản NTRIP đã xác thực thành công.
Không quan tâm tài khoản có gửi GGA hay không. Kết nối nguồn (source) của trạm
hoặc relay không phải tài khoản, nên được xem ở **CORS → Listener → Kết nối**.
:::

## Thông tin kết nối tới trạm {#thong-tin-ket-noi}

| Trường | Giá trị |
| --- | --- |
| Host/IP | Tên miền hoặc IP của caster (ví dụ `rtktk.online`) |
| Port | **2101** (mặc định); 1508/1509 chỉ để tương thích thiết bị cũ |
| Mountpoint | Tên mountpoint đã tạo, ví dụ `YBI_XuanAI` |
| Username | Tài khoản NTRIP đã cấp |
| Password | Mật khẩu của tài khoản đó |
| NTRIP version | Khuyến nghị **v2** (Basic auth); v1 chỉ dùng khi thiết bị không hỗ trợ |

Ví dụ cấu hình rover/RTK:

```text
Host: rtktk.online
Port: 2101
Mountpoint: YBI_XuanAI
Username: tram_ybi
Password: ********
NTRIP: v2
```

Ví dụ thiết bị/trạm đẩy dữ liệu lên caster (SOURCE/POST) cũng dùng đúng
host/port/mountpoint và tài khoản đã cấp ACL.

![Bản đồ vận hành](/img/docs/map/map-light.png)

## Kiểm tra kết nối và lỗi thường gặp {#kiem-tra-ket-noi}

1. Mở **CORS → Listener → Kết nối** để xem cả nguồn (source) và rover.
2. Mở **Danh sách online** để xem tài khoản NTRIP đang kết nối.
3. Dùng nút **Kiểm tra** ở relay job để thử luồng trước khi bật.

| Mã | Ý nghĩa | Cách xử lý |
| --- | --- | --- |
| `401` | Thiếu hoặc sai username/password | Kiểm tra lại tài khoản, mật khẩu và NTRIP version |
| `403` | Tài khoản không có ACL mountpoint/listener, hoặc khác công ty | Cấp ACL đúng và đảm bảo cùng công ty với listener |
| `404` | Mountpoint không tồn tại hoặc đang tắt | Kiểm tra tên mountpoint và trạng thái bật |
| `429` | Quá nhiều lần xác thực sai từ cùng IP | Chờ hết thời gian chặn rồi thử lại |
| `503` | Caster quá tải hoặc cấu hình vừa thay đổi | Thử lại sau; kiểm tra giới hạn kết nối |

![Danh sách listener và kết nối](/img/docs/caster/list-light.png)
