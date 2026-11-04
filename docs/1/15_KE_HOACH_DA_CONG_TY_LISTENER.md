# Kế hoạch 15 — Đa công ty cho listener/caster và sourcetable công khai

- Ngày lập: 2026-11-04
- Trạng thái: IN PROGRESS
- Phạm vi: `caster_listeners`, RBAC company, sourcetable Go, Docker port range,
  UI `/caster` và các màn hình phụ thuộc listener.
- Nguyên tắc: mock-first, không chạy relay thật, không chạm `relayrtcm/backup`,
  không commit secret, test trước khi tuyên bố PASS.

## 1. Quyết định đã chốt

1. **3 port Wally**: `1508`, `1509`, `2101` chỉ thuộc công ty `WALLY`.
2. **Port riêng theo công ty**: dải `1510–1599`; superadmin tạo port từ UI và
   gán công ty. Công ty khác không được dùng 1508/1509/2101.
3. **Wally vẫn được tạo thêm port** trong dải 1510–1599 như công ty khác.
4. **Phân quyền**:
   - `super_admin`: xem và quản lý tất cả port, tạo port mới.
   - `admin` công ty: chỉ xem port của công ty mình; không tạo/sửa/xóa.
   - `user`: chỉ xem port của công ty mình.
5. **Sourcetable công khai**: `GET /` không cần đăng nhập, trả toàn bộ
   mountpoint enabled của listener. Kết nối RTCM (rover/source) vẫn bắt buộc
   account + mật khẩu + ACL + cùng công ty.
6. Giữ ràng buộc: listener đang bật không xóa được (đã có từ trước).
7. Đầu ra (outbound) không giới hạn; chỉ quản lý port đầu vào.

## 2. Hiện trạng và vấn đề

- `caster_listeners` đang là tài nguyên toàn hệ thống, chưa có `company_id`.
- 1508/1509/2101 đang map 6/29/29 mountpoint; trong đó 1509 và 2101 có
  **3 mapping chéo công ty 87 (admin)**. Nếu public sourcetable ngay sẽ lộ
  mountpoint của công ty khác.
- Sourcetable hiện lọc theo `account_mountpoint_acl` + `account_listener_acl`;
  không account nào có đủ 29 ACL nên thường trả 0 hoặc thiếu.
- Docker chỉ publish 1508/1509/2101; port mới từ UI không ra được ngoài nếu
  không publish dải.
- Go đã bind/unbind listener động từ DB (giống CGBAS), chỉ thiếu lớp publish
  port và allowlist.

## 3. Kiến trúc sau thay đổi

```text
MySQL caster_listeners:
  company_id -> companies.id
  port UNIQUE toàn cục
  1508/1509/2101 -> WALLY
  1510-1599      -> công ty được gán

Go caster:
  đọc listener + company_id
  sourcetable public = mọi mountpoint enabled của listener
  authorize đọc dữ liệu = account + ACL + cùng company

Docker:
  publish 1508, 1509, 2101, 1510-1599
  firewall/provider mở cùng dải
  ngoài dải -> server/Go từ chối
```

## 4. Các pha thực hiện

### P15-1 — DB, migration và dữ liệu

- Thêm `caster_listeners.company_id` (nullable, FK companies, index).
- Backfill 1508/1509/2101 cho `WALLY`.
- Xoá mapping `caster_listener_mountpoints` chéo công ty.
- Xoá `account_listener_acl` / `account_mountpoint_acl` chéo công ty.
- Cập nhật `seed.ts`, `resetLegacyV2.ts`, `importLegacyV2.ts`,
  `importLegacyCaster.ts` để listener luôn có company.
- Seed tạo listener riêng cho công ty demo (port 1599) để trạm demo không dùng
  nhầm port Wally.
- Test: migration chạy sạch, counts đúng, không còn mapping chéo.

### P15-2 — API/RBAC company

- `GET /api/caster/listeners`: superadmin thấy tất cả; admin/user chỉ thấy
  `company_id` của mình; superadmin lọc được `companyId`.
- Thêm `companyId`, `companyName` vào response.
- Tạo/sửa/xóa/bật/tắt: chỉ superadmin; validate company + port.
- Port 1508/1509/2101 chỉ cho `WALLY`; port khác phải trong 1510–1599.
- Mountpoint gắn listener phải cùng company.
- `GET/PUT /listeners/:id/mountpoints` lọc/validate cùng company.
- `ntrip_accounts` listener ACL và mountpoint ACL phải cùng company.
- `stationResources` validate listener cùng company với trạm.
- `mountpoints/:id/impact` chỉ trả listener cùng company.

### P15-3 — Go

- Thêm `CompanyID` vào `ListenerConfig` và `AccountConfig`.
- `authorize()` chặn account khác company với listener.
- `sourcetableMountpoints()` trả toàn bộ mountpoint enabled, không cần auth.
- Allowlist port Go: `CASTER_PUBLIC_PORTS` mặc định
  `1508,1509,2101,1510-1599`.
- Test: anonymous sourcetable đủ mountpoint; data không auth vẫn 401;
  account khác company bị 403; port ngoài allowlist không bind.

### P15-4 — Docker/firewall

- `docker-compose.yml`: publish thêm dải `1510-1599`.
- `.env.example`: thêm `CASTER_PUBLIC_PORTS`.
- `docs/3/KE_HOACH_DEPLOY_VPS_2026-11-03.md`: publish/firewall dải mới.
- Test: `docker compose config`, container healthy, port trong dải mở được.

### P15-5 — UI

- `/caster`: cột/filter Công ty cho superadmin; company admin/user chỉ thấy
  port của mình.
- Form tạo: chọn company (superadmin), port 1508/1509/2101 hoặc 1510–1599;
  port reserved chỉ chọn được khi company = WALLY.
- `/stations`: listener mặc định 2101 nếu có, nếu không lấy listener đầu tiên
  của company.
- `/ntrip-accounts`: listener options chỉ cùng company.
- Cập nhật type `CasterListener`.

### P15-6 — Test tổng và tài liệu

- Server unit/integration, Go test/vet, frontend build.
- Playwright: superadmin thấy tất cả; admin/user chỉ thấy company; tạo port
  cho company; sourcetable anonymous đủ; data auth vẫn đúng.
- `graphify update .`.
- Cập nhật `SESSION.md`, `docs/2/PHAN_QUYEN.md`, `docs/api.md`, `AGENTS.md`.

## 5. Checklist nghiệm thu

- [ ] Migration 040/041 áp dụng sạch; admin schema version đúng.
- [ ] 1508/1509/2101 thuộc Wally; không còn mapping chéo company.
- [ ] Superadmin tạo được port 1510 cho company khác; company chỉ thấy port đó.
- [ ] Company admin/user không thấy port company khác.
- [ ] Tạo port 1508 cho company khác bị 400.
- [ ] Sourcetable anonymous trả đủ mountpoint enabled của listener.
- [ ] Kết nối data không auth bị 401; account khác company bị 403.
- [ ] Docker publish 1510–1599; port ngoài dải bị từ chối.
- [ ] Server test PASS, Go test/vet PASS, frontend build PASS.
- [ ] Playwright company/sourcetable PASS.
- [ ] Không có secret trong diff.

## 6. Kết quả thực hiện

| Pha | Kết quả | Bằng chứng |
|---|---|---|
| P15-1 | PASS 2026-11-04 | Migration 040 áp dụng; 1508/1509/2101 → WALLY; mapping 1509/2101 còn 26 Wally (bỏ 3 admin); listener demo 1599 → company admin; 0 mapping/ACL/source chéo công ty. Backup trước migration: `Backup/cors-mysql-20261104-203843.sql.zip`. |
| P15-2 | PASS 2026-11-04 | Migration 041: admin/user `caster.view=tenant`, super `all`. API: super thấy 4 listener; user1 chỉ thấy 1599; wally thấy 3 port; super filter companyId=87 trả 1. Tạo 1510 company 87 OK, 1508 company 87 → 400, mountpoint Wally trên listener company 87 → 400, user1 tạo → 403. Station dùng listener khác company → 400. ACL account khác company → 400. Server test 192/192 PASS. |
| P15-3 | PASS 2026-11-04 | Sourcetable anonymous port 2101 trả 26 STR (Wally); data anonymous `GET /BDH1` trả 401. Go thêm `CompanyID` cho listener/account + check cùng company; thêm `CASTER_PUBLIC_PORTS` (mặc định 1508,1509,2101,1510-1599). `go test ./...` + `go vet ./...` PASS; image gnss rebuild/recreate healthy. |
| P15-4 | PENDING | |
| P15-5 | PENDING | |
| P15-6 | PENDING | |

## 7. Rủi ro và rollback

- **Docker published range bypass UFW**: firewall nhà cung cấp phải mở dải;
  chỉ socket đang bật mới accept.
- **Đổi company của listener**: không cho sửa sau khi tạo; muốn đổi phải xóa
  listener đã tắt và tạo lại.
- **Dữ liệu cũ chéo company**: migration xoá mapping/ACL chéo; cần backup trước.
- Rollback: `docker compose down` (giữ volume), restore dump trước migration;
  code revert commit P15.
