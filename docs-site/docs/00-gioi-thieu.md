---
title: Giới thiệu hệ thống
sidebar_position: 0
slug: /
description: Tổng quan hệ thống quản lý trạm CORS, NTRIP và RTCM
---

# Giới thiệu hệ thống

Trang hướng dẫn này dành cho mọi người dùng đã được cấp tài khoản trên hệ thống
quản lý trạm CORS. Tài liệu đi theo đúng thứ tự menu trên màn hình, mỗi mục nêu
rõ người thực hiện và các bước thao tác.

## Hệ thống làm được gì

| Nhóm chức năng | Nội dung chính |
|---|---|
| Giám sát | Dashboard, bản đồ vận hành, danh sách online, cảnh báo |
| Trạm | Hồ sơ trạm, nguồn dữ liệu, chất lượng RTCM, lịch sử |
| CORS | Mountpoint, listener caster, tài khoản NTRIP |
| Truyền dữ liệu | Relay job, lịch sử phiên, chất lượng hai chiều |
| Quản trị | Công ty, người dùng web, vai trò và quyền, cấu hình hệ thống |

## Luồng dữ liệu

```text
Máy thu GNSS ──NTRIP──> Caster listener ──> Mountpoint ──> Rover
                              │
                              ├──> Relay job ──NTRIP──> Caster đích
                              └──> Bộ phân tích RTCM ──> Chất lượng / Cảnh báo
```

Hệ thống không sửa nội dung RTCM trên đường truyền. Bộ phân tích chỉ đọc để đếm
và đo chất lượng.

## Thuật ngữ thường gặp

| Thuật ngữ | Giải thích |
|---|---|
| CORS | Trạm tham chiếu cố định cung cấp dữ liệu hiệu chỉnh GNSS |
| NTRIP | Giao thức truyền dữ liệu GNSS qua HTTP |
| RTCM | Định dạng bản tin hiệu chỉnh GNSS |
| Mountpoint | Điểm phát dữ liệu trên caster, rover kết nối vào đây |
| Source / Rover | Source là bên gửi dữ liệu lên, rover là bên nhận |
| Listener | Cổng caster lắng nghe kết nối NTRIP |
| Relay job | Job chuyển tiếp dữ liệu từ nguồn này sang caster khác |
| GGA | Bản tin vị trí rover gửi kèm khi kết nối NTRIP |
| RTK | Định vị chính xác cao dùng dữ liệu hiệu chỉnh |
| C/N0 | Tỷ số công suất tín hiệu trên tạp âm của vệ tinh |

## Vai trò và phạm vi dữ liệu

| Vai trò | Phạm vi | Ghi chú |
|---|---|---|
| Quản trị hệ thống | Toàn hệ thống | Quản lý công ty, người dùng, cấu hình |
| Quản trị công ty | Dữ liệu thuộc công ty | Quản lý trạm, mountpoint, relay trong công ty |
| Người dùng | Dữ liệu được giao | Xem và thao tác trong phạm vi được cấp |

Menu chỉ hiển thị mục mà vai trò của bạn được phép dùng. Nếu không thấy một mục,
hãy liên hệ quản trị hệ thống.

## Bắt đầu

Đọc tiếp [Bắt đầu sử dụng](./bat-dau/) để biết cách đăng nhập và làm quen giao diện.
