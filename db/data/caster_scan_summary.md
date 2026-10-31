# Quét caster rtktk.online — 2026-10-31T10:25:25.607Z

## Kết quả

| Port | STR trong sourcetable | Mountpoint relay config | Relay src | Relay dst |
|---|---:|---:|---:|---:|
| 1509 | 26 | 29 | 29 | 5 |
| 1508 | 6 | 3 | 3 | 2 |

- Tổng station sau khi gộp (không phân biệt hoa/thường): **36**.
- Relay config hiện tại: **67 job** (66 bật).
- Station có trong sourcetable: **31**.
- Station chỉ có trong relay config (chưa thấy ở sourcetable): **5** — DTP_TanHong, GLI2, HUG_ViThuy, PYN_SongHinh, YBI_NghiaLo.
- Mountpoint chỉ có trong sourcetable (không có trong relay config): **4** — BG.TP, hauloc, MocChautest, TNN_DaiTu.
- Cặp tên chỉ khác hoa/thường: **1** — TNN_TpThaiNguyen ↔ TNN_TPThaiNguyen.

## Cảnh báo

- Sourcetable trả `0.00` cho lat/lon; **không import 0,0**. Cột lat/lon trong file xlsx đang để trống, chờ 1005/1006 hoặc probe.
- Sourcetable không yêu cầu auth, nhưng dữ liệu mountpoint có thể yêu cầu password; chưa kiểm tra credential.
- `BG.TP` không hợp lệ làm `stations.code` (regex không cho dấu chấm) nên đã đổi thành `BG_TP`; mountpoint gốc vẫn là `BG.TP`.
- Cột `region` được suy đoán từ tiền tố mountpoint (THA, SLA, YBI, ...), cần đối chiếu trước khi dùng chính thức.
- `hauloc`, `MocChautest` là nghi vấn test/trùng; `TNN_TpThaiNguyen` và `TNN_TPThaiNguyen` đã gộp làm một station do MySQL so sánh code không phân biệt hoa/thường.
- File `caster_stations.xlsx` chỉ tạo **trạm**; chưa tạo mountpoint/account/ACL. Cần script `importLegacyCaster` trước khi thiết bị có thể publish.

## File sinh ra

- `sourcetable_1509.txt` — raw response port 1509
- `sourcetable_1508.txt` — raw response port 1508
- `caster_stations.json` — dữ liệu đầy đủ (ports, relay job, alias).
- `caster_stations.csv` — bản CSV để đối chiếu.
- `caster_stations.xlsx` — import trực tiếp qua `/api/stations/import` (sheet `Stations`).
- `caster_mountpoints.csv` / `.xlsx` — danh sách mountpoint cho bước tạo mountpoint sau.
