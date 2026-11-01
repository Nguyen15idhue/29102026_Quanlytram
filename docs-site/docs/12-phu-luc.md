---
title: Phụ lục
sidebar_position: 12
slug: /phu-luc
description: Bảng quyền theo module, thuật ngữ và tài liệu kỹ thuật
---

# Phụ lục

## Quyền theo module

Mỗi module có bốn hành động: xem, thêm, sửa, xóa. Phạm vi dữ liệu quyết định
bạn thấy bản ghi nào.

| Module | Dùng cho |
|---|---|
| Công ty | Quản lý công ty |
| Người dùng web | Tài khoản đăng nhập giao diện |
| Vai trò và quyền | Cấu hình phân quyền |
| Trạm | Hồ sơ trạm, nguồn dữ liệu |
| Mountpoint | Điểm phát dữ liệu |
| Tài khoản NTRIP | Tài khoản rover |
| Relay | Job chuyển tiếp |
| Caster | Listener và kết nối |
| Cảnh báo | Cảnh báo và xử lý |
| Chất lượng | Điểm chất lượng và probe |
| Lịch sử và audit | Phiên, sự kiện, thay đổi cấu hình |
| Bản đồ và Dashboard | Dữ liệu tổng hợp |
| Sức khỏe và cấu hình | Trạng thái hệ thống, cấu hình bản đồ |
| Trang cá nhân | Hồ sơ của chính mình |

## Phạm vi dữ liệu

| Phạm vi | Ý nghĩa |
|---|---|
| Toàn hệ thống | Mọi bản ghi |
| Nhánh | Bản ghi thuộc cây người dùng của mình |
| Của mình | Chỉ bản ghi do mình sở hữu |
| Không có | Không thấy dữ liệu của module |

Mặc định là từ chối. Nếu không thấy dữ liệu, hãy kiểm tra quyền và phạm vi
trước khi báo lỗi hệ thống.

## Thuật ngữ

| Thuật ngữ | Giải thích |
|---|---|
| Caster | Máy chủ NTRIP phát dữ liệu cho rover |
| Listener | Cổng lắng nghe kết nối của caster |
| Mountpoint | Điểm phát dữ liệu trên caster |
| Source | Bên gửi dữ liệu lên caster |
| Rover | Thiết bị nhận dữ liệu hiệu chỉnh |
| GGA | Bản tin vị trí rover gửi kèm |
| RTCM | Định dạng bản tin hiệu chỉnh GNSS |
| CRC24Q | Mã kiểm tra lỗi của bản tin RTCM |
| Ephemeris | Lịch vệ tinh dùng để tính vị trí |
| C/N0 | Tỷ số công suất tín hiệu trên tạp âm |
| Sky plot | Biểu đồ vị trí vệ tinh trên bầu trời |
| Relay job | Cấu hình chuyển tiếp dữ liệu |
| Session | Một phiên kết nối |
| Audit | Bản ghi thay đổi cấu hình và thao tác quản trị |

## Tài liệu kỹ thuật

- Hợp đồng API: `docs/api.md` trong kho mã nguồn.
- Phân quyền chi tiết: `docs/2/PHAN_QUYEN.md`.
- Vận hành và sao lưu: `docs/OPS.md`.
- Kế hoạch và tiến độ: `docs/1/`, `TASKS.md`.

Tài liệu kỹ thuật dành cho người phát triển và vận hành; người dùng cuối không
cần đọc để sử dụng hệ thống.
