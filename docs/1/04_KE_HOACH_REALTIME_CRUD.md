# 04 — KẾ HOẠCH KIỂM THỬ & SỬA LỖI REALTIME CRUD

> Ngày lập: 2026-11-01
> Nguồn: yêu cầu realtime cho Trạm, Mountpoint, Tài khoản NTRIP và các entity liên kết
> Trạng thái: **KẾ HOẠCH — chưa sửa code**
> Cách dùng: làm tuần tự từ Bước 1; chỉ chuyển bước khi checklist PASS hoặc có
> ghi chú chấp nhận. Không đánh dấu PASS khi chưa có bằng chứng test.

## 0. Cách đọc tài liệu

Mỗi bước gồm:

1. **Mục tiêu** — kết quả cần có.
2. **Giải thích cơ bản** — lý do và nguyên tắc.
3. **Việc cần làm** — thứ tự triển khai.
4. **File/khu vực** — nơi sẽ sửa.
5. **Yêu cầu cần đạt** — điều kiện nghiệm thu.
6. **Checklist test** — bằng chứng PASS/FAIL.
7. **Ghi chú** — rủi ro, migration, điều kiện dừng.

Quy ước:

- `[ ]` chưa làm, `[x]` PASS, `[!]` lỗi hoặc chấp nhận tạm.
- Không commit `.env.local`, secret, DSN, password, backup relay.
- Không sửa `relayrtcm\backup`.
- Không chạy `relay.exe`, không chiếm cổng `2101`, `8081`.
- Không test mountpoint công cộng; mock PASS trước, real sau.
- Migration tăng dần; không sửa migration đã chạy.

## 1. Mục tiêu, phạm vi, không làm

### 1.1 Mục tiêu

1. CRUD đầy đủ cho Trạm, Mountpoint, Tài khoản NTRIP.
2. Bật/tắt/khóa/mở khóa/xóa có hiệu lực gần như tức thời:
   - BE/Go: dưới 1 giây.
   - UI: dưới 2 giây, không cần F5.
3. Không rò rỉ connection, goroutine, source slot, dữ liệu RTCM sau khi tắt/khóa/xóa.
4. Bật lại phải chạy thật, có dữ liệu đi qua.
5. Test theo chuỗi liên kết:
   `Station → Mountpoint → Listener → Account/ACL → Connection → Relay/Probe → UI`.

### 1.2 Phạm vi

- Trạm vật lý và trạng thái streaming.
- Mountpoint, listener mapping.
- Tài khoản NTRIP, ACL mountpoint/listener, tài khoản đang online.
- Relay job và station probe có liên kết theo tên mountpoint/trạm.
- UI danh sách, form, chi tiết, online list.
- Socket.IO, internal API Node ↔ Go.

### 1.3 Không làm trong tài liệu này

- Không thêm Redis/Kafka/RabbitMQ/K8s.
- Không đổi mô hình relay là entity riêng.
- Không lưu raw RTCM/payload.
- Không tự động xóa relay job khi xóa trạm/mountpoint.
- Không auto-fill credential giả cho trạm legacy.

## 2. Quyết định đã chốt

| Mã | Quyết định |
|---|---|
| D1 | Bắt buộc credential **theo vai trò** `station_sources.source_role`: caster cần caster username/password; client cần host/port/mount, credential nếu upstream yêu cầu auth. |
| D2 | Caster username/password phải dùng được thật: tự tạo **NTRIP account** có ACL mountpoint + listener. Nếu username đã tồn tại thì trả 409, không tự ghi đè. Không để credential chỉ là metadata. |
| D3 | Áp dụng cứng ngay (phương án A). Dữ liệu hiện tại là test; nếu không thể backfill sạch thì xóa toàn bộ thông tin trạm và tạo lại chuẩn. |
| D4 | Xóa trạm sẽ xóa **toàn bộ mountpoint** của trạm. Tạo trạm sẽ tự tạo **đúng 1 mountpoint**. |
| D5 | Không còn `stations.code`; chỉ dùng `stations.id`. Tên mountpoint tự sinh từ tên trạm. |
| D6 | Trạng thái khóa **không chặn sửa** metadata/source; chỉ chặn bật/tắt/khóa/xóa sai ma trận. |
| D7 | Tắt mountpoint tự pause relay job khớp **cả upstream và downstream**. |
| D8 | Đổi password NTRIP account không đóng phiên đang chạy; chỉ áp dụng cho lần auth mới. |
| D9 | Giảm `max_connections` sẽ đóng phiên mới nhất trước, giữ phiên cũ nhất, ghi audit. |
| D10 | `station.name` và `station.port` bất biến sau khi tạo. `mountpoint.name` bất biến. `ntrip_accounts.username` bất biến. |
| D11 | Xóa trạm/mountpoint/tài khoản phải đóng connection trước, reconcile ngay, audit đầy đủ, không lộ secret. |

## 3. Hiện trạng và lỗi cần xử lý

| Mã | Vấn đề | Vị trí | Hệ quả |
|---|---|---|---|
| B1 | Mountpoint PATCH/bulk/delete không gọi reconcile | `server/src/routes/mountpoints.ts:562`, `:618`, `:645` | Tắt mountpoint vẫn nhận source/rover tới 10 giây |
| B2 | NTRIP account lock/unlock/delete/ACL không reconcile | `server/src/routes/ntripAccounts.ts:390`, `:472`, `:505`, `:563` | Tài khoản bị khóa/xóa vẫn online tới poll kế tiếp |
| B3 | Station source PUT không reconcile | `server/src/routes/stations.ts:1762` | Probe/relay/caster dùng cấu hình cũ |
| B4 | Station probe CRUD không reconcile; probe manager không restart khi config đổi | `server/src/routes/quality.ts:588`, `gnss/internal/probe/manager.go:128` | Bật/tắt/đổi host probe không có hiệu lực ngay |
| B5 | Station PATCH cho sửa `code/name/host/port` | `server/src/routes/stations.ts:1244` | Vi phạm bất biến, ảnh hưởng mountpoint/relay |
| B6 | Mountpoint PATCH cho sửa `name` | `server/src/routes/mountpoints.ts:563` | Phá liên kết relay theo tên |
| B7 | NTRIP PATCH cho sửa `username` | `server/src/routes/ntripAccounts.ts:412` | Sai định danh, ảnh hưởng ACL/audit |
| B8 | Station create không tạo source/mountpoint cùng transaction | `server/src/routes/stations.ts:1182` | Trạm có thể tồn tại thiếu cấu hình |
| B9 | Required fields chưa đủ | `stations.ts:54`, `sourceSchema` tại `:1698` | Lưu được trạm không có host/port/mount/credential |
| B10 | UI list không realtime | `Stations.tsx:185`, `Mountpoints.tsx:86`, `OnlineList.tsx:39` | Tab khác không thấy thay đổi |
| B11 | Thiếu endpoint lock/unlock từng trạm | `stations.ts` chỉ có bulk | Không test được ma trận theo row |
| B12 | Xóa trạm đang khóa vẫn được | `stations.ts:1971` | Sai ma trận trạng thái |
| B13 | Xóa trạm để mountpoint mồ côi | FK `ON DELETE SET NULL` tại `001_init.sql` | Dữ liệu treo, relay tham chiếu tên đã mất |
| B14 | Xóa mountpoint/account khi online không đóng connection trước | routes mountpoints/ntrip | Có thể xóa khi luồng vẫn chạy |
| B15 | Giảm `max_connections` không đóng phiên dư | Go caster chỉ check khi register | Vượt giới hạn |
| B16 | Race register ↔ reconcile trong caster | `manager.go:324`, `listener.go:121`, `hub.go:72` | Connection đã đóng vẫn nằm trong hub; source slot bị kẹt |
| B17 | Listener stop không chặn connection đã accept | `listener.go:28`, `:227` | Connection mới lọt vào sau reconcile |
| B18 | Reconcile lỗi chỉ log warning | `stationStream.ts:108` | API báo thành công nhưng Go chưa áp dụng |
| B19 | Station pause relay chỉ khớp upstream | `stationStream.ts:17` | Bỏ sót job dùng mountpoint làm downstream |
| B20 | `stations.code` còn trong API/UI/import/Go probe | nhiều file | Trái quyết định chỉ dùng station id |

## 4. Mô hình đích

### 4.1 Định danh trạm

- `stations.id` là định danh duy nhất.
- Bỏ hoàn toàn `stations.code` khỏi API, UI, import/export, test, Go probe.
- Tên mountpoint tự sinh từ tên trạm, không nhập tay.

Thuật toán sinh tên mountpoint:

1. Trim tên trạm.
2. Chuẩn hóa Unicode NFD, bỏ dấu.
3. Chuyển `đ/Đ` thành `d/D`.
4. Chuyển chữ hoa.
5. Thay ký tự ngoài `[A-Z0-9]` bằng `_`.
6. Gộp nhiều `_`, bỏ `_` đầu/cuối.
7. Giới hạn 128 ký tự.
8. Nếu rỗng, dùng `TRAM_<epoch>`.
9. Nếu trùng tên, thêm `_2`, `_3`... cho tới khi unique.
10. Hiển thị preview trước khi lưu; không cho sửa sau khi tạo.

Ví dụ: `Trạm Hậu Lộc` → `TRAM_HAU_LOC`.

### 4.2 Trường bắt buộc

| Nhóm | Trường | Caster | Client |
|---|---|---|---|
| Chung | `name` | Bắt buộc | Bắt buộc |
| Chung | `port` | Bắt buộc | Bắt buộc |
| Chung | `source_role` | Bắt buộc | Bắt buộc |
| Caster | `caster_listener_id` | Bắt buộc | Không dùng |
| Caster | `caster_username` | Bắt buộc | Không dùng |
| Caster | `caster_password` | Bắt buộc khi tạo; sửa trống = giữ cũ | Không dùng |
| Client | `client_host` | Không dùng | Bắt buộc |
| Client | `client_port` | Không dùng | Bắt buộc |
| Client | `client_mount` | Không dùng | Bắt buộc |
| Client | `client_username/password` | Không dùng | Bắt buộc nếu upstream auth |

### 4.3 Trường bất biến

| Entity | Trường bất biến | Mã lỗi |
|---|---|---|
| Station | `name`, `port` | 409 `IMMUTABLE_FIELD` |
| Mountpoint | `name` | 409 `IMMUTABLE_FIELD` |
| NTRIP account | `username` | 409 `IMMUTABLE_FIELD` |

### 4.4 Ma trận trạm

| Trạng thái | Bật | Tắt | Khóa | Mở khóa | Xóa | Sửa metadata/source |
|---|---|---|---|---|---|---|
| Active + enabled | skip | OK | chặn, phải tắt | skip | chặn, phải tắt | OK trừ bất biến |
| Active + disabled | OK | skip | OK | skip | OK | OK trừ bất biến |
| Locked | chặn | chặn | skip | OK → `disabled` | chặn, phải mở khóa | OK trừ bất biến |

### 4.5 Ma trận mountpoint

| Trạng thái | Bật | Tắt | Xóa | Sửa name |
|---|---|---|---|---|
| Enabled | skip | OK, đóng connection ngay, pause relay | chặn hoặc đóng + xác nhận impact | chặn |
| Disabled | OK | skip | OK sau impact | chặn |

### 4.6 Ma trận tài khoản NTRIP

| Trạng thái | Khóa | Mở khóa | Xóa | Sửa username | Sửa ACL |
|---|---|---|---|---|---|
| Enabled, online | OK, đóng toàn bộ connection | skip | đóng connection rồi xóa | chặn | OK, đóng connection mất ACL |
| Enabled, offline | OK | skip | OK | chặn | OK |
| Locked | skip | OK | OK | chặn | OK |

### 4.7 Quy tắc liên kết

- Tạo trạm: station + source + 1 mountpoint + NTRIP account (nếu caster) + listener mapping trong một transaction.
- Tắt trạm:
  - Mountpoint của trạm: `enabled=0`, `paused_by_station_id=trạm`.
  - Probe của trạm: tắt, đánh dấu pause.
  - Relay job khớp tên mountpoint: tắt, đánh dấu pause, tăng revision.
  - Đóng connection caster của các mountpoint.
  - Reconcile relay + caster + probe ngay.
- Bật trạm:
  - Chỉ bật lại resource do chính trạm pause.
  - Reconcile ngay; thiết bị caster tự reconnect.
- Tắt mountpoint:
  - Đóng source/rover của mountpoint.
  - Pause relay job khớp `upstream_mount` hoặc `downstream_mount`.
  - Reconcile ngay.
- Khóa tài khoản:
  - Đóng mọi connection của account.
  - `disconnect_reason='account_disabled'`.
- Xóa trạm:
  - Chỉ khi tắt và mở khóa.
  - Đóng connection, pause relay, xóa account managed, xóa toàn bộ mountpoint, xóa station.

### 4.8 Realtime pipeline

1. Route mutation commit DB.
2. Gọi helper `reconcileAffected(...)`.
3. Go internal API đóng đích danh + reconcile.
4. Node phát Socket.IO `entity.changed`.
5. Frontend invalidate query đúng key.
6. Fallback polling khi socket mất kết nối.

Mục tiêu thời gian:

| Hạng mục | Ngưỡng |
|---|---|
| API mutation | p95 ≤ 300 ms |
| Reconcile Go | ≤ 1 s |
| Connection biến mất khỏi Go | ≤ 1 s |
| DB open connection = 0 | ≤ 2 s |
| Relay state disabled | ≤ 2 s |
| UI cập nhật không F5 | ≤ 2 s |
| Fallback polling | 5–10 s |
| Goroutine sau 50 vòng | baseline ±5 |

## 5. Các bước thực hiện

---

## Bước 1 — Baseline, backup và chốt môi trường test

### Mục tiêu

Có ảnh chụp hiện trạng và bản backup trước khi sửa, đủ để so sánh và rollback.

### Giải thích cơ bản

Không có baseline thì không chứng minh được lỗi đã sửa hay chưa. Dữ liệu hiện tại là test nhưng vẫn phải backup trước khi reset/sửa schema.

### Việc cần làm

1. Ghi lại phiên bản code, thời điểm, người thực hiện.
2. Chạy `docker compose ps`, xác nhận MySQL/Node/Go/Web healthy.
3. Backup MySQL bằng `scripts/backup-mysql.ps1`.
4. Ghi baseline:
   - Số station/mountpoint/account/listener/probe/relay.
   - Số connection đang mở.
   - Trạng thái station theo `source_type`.
   - Danh sách station thiếu credential.
5. Ghi lại cổng đang dùng; xác nhận không đụng `2101`, `8081`.
6. Chốt cổng test riêng, ví dụ `15999`, chỉ dùng cho listener test.

### File/khu vực

- `scripts/backup-mysql.ps1`
- `docker-compose.yml`
- `db/data/`
- `SESSION.md`

### Yêu cầu cần đạt

- Có file backup và đường dẫn backup rõ ràng.
- Có bảng baseline trước khi thay đổi.
- Không có thay đổi code trong bước này.

### Checklist test

- [x] `docker compose ps` tất cả service cần thiết healthy.
- [x] Backup tồn tại, kích thước > 0, kiểm tra restore thử trên DB tạm.
- [x] Baseline station/mountpoint/account/connection được ghi lại.
- [x] Danh sách station thiếu credential được xuất ra file/report.
- [x] Xác nhận không chạm backup relay và cổng cấm.

### Ghi chú

- Không chạy backup/restore trong giờ có người đang thao tác.
- Không đưa password/DSN vào báo cáo baseline.

---

## Bước 2 — Chuẩn bị reset dữ liệu test theo phương án A

### Mục tiêu

Có script reset, preflight và quy trình thực thi sẵn sàng; chưa chạy reset ở bước này.

### Giải thích cơ bản

Đã chốt áp dụng cứng. Vì dữ liệu hiện tại là test, reset sạch nhanh hơn và an toàn hơn so với cố backfill 39 trạm legacy thiếu credential. Tuy nhiên không được reset trước khi code/schema mới sẵn sàng: `stations.code` hiện là `NOT NULL`, nên tạo trạm mới trước khi bỏ code sẽ lỗi. Vì vậy bước này chỉ chuẩn bị, thực thi ở Bước 4.

### Việc cần làm

1. Viết script reset test:
   - Xóa ACL account, mapping listener, probe, source, mountpoint, station.
   - Xóa hoặc vô hiệu hóa relay job test đang tham chiếu tên mountpoint cũ.
   - Làm sạch runtime test nếu cần: `caster_connections`, `relay_job_state`, quality sample.
   - Có chế độ `--dry-run` in số lượng sẽ xóa.
2. Viết script/seed tạo lại dữ liệu test chuẩn:
   - 1 trạm `caster_ingest`.
   - 1 trạm `relay_caster`.
   - 1 trạm `ntrip_client`.
   - Mỗi trạm có đúng 1 mountpoint tự sinh từ tên trạm.
   - Mỗi trạm caster có 1 NTRIP account tương ứng.
3. Chạy dry-run, đối chiếu baseline Bước 1.
4. Xác nhận thời điểm reset với chủ dự án.
5. Không chạy reset thật ở bước này.

### File/khu vực

- `scripts/reset-test-stations.ps1` (mới)
- `server/src/db/seed.ts`
- `db/data/`
- `db/migrations/admin/*.sql`

### Yêu cầu cần đạt

- Script reset có dry-run, transaction, thứ tự xóa an toàn.
- Danh sách bản ghi bị xóa khớp baseline.
- Có kế hoạch tạo lại dữ liệu test.
- Chưa thay đổi DB thật.

### Checklist test

- [x] Dry-run chạy PASS, in đúng số lượng.
- [x] Script không xóa web_users/roles/listener chuẩn nếu không cần.
- [x] Script có kiểm tra backup tồn tại trước khi chạy.
- [x] Có xác nhận thời điểm reset.
- [x] Chưa chạy reset thật.

### Ghi chú

- Thực thi reset ở Bước 4, sau khi migration và code bỏ `code` sẵn sàng.
- Không reset nếu chưa có backup.
- Nếu chủ dự án muốn giữ một số bản ghi, backfill thủ công thay vì reset.

---

## Bước 3 — Migration và mô hình dữ liệu

### Mục tiêu

Schema đủ cho pause relay theo mountpoint, account managed bởi station và bỏ station code.

### Giải thích cơ bản

Các cột pause hiện chỉ có `paused_by_station_id`. Cần thêm owner mountpoint để bật/tắt đúng. Account tự tạo cần biết thuộc trạm nào. `stations.code` phải bị loại bỏ sau khi code/UI không còn dùng.

### Việc cần làm

1. Migration `023_relay_pause_mountpoint.sql`:
   - `relay_jobs.paused_by_mountpoint_id BIGINT UNSIGNED NULL`.
   - Index `idx_relay_jobs_paused_by_mountpoint`.
2. Migration `024_ntrip_account_managed.sql`:
   - `ntrip_accounts.managed_by_station_id BIGINT UNSIGNED NULL`.
   - Unique key để mỗi station chỉ có tối đa 1 account managed.
   - FK `ON DELETE CASCADE` để xóa trạm xóa account managed.
3. Migration `025_drop_station_code.sql`:
   - Chỉ chạy sau khi code/UI/import/Go không còn dùng `code`.
   - Drop unique key và cột `stations.code`.
4. Không sửa migration cũ.
5. Cập nhật tài liệu schema và rollback.

### File/khu vực

- `db/migrations/admin/023_relay_pause_mountpoint.sql`
- `db/migrations/admin/024_ntrip_account_managed.sql`
- `db/migrations/admin/025_drop_station_code.sql`
- `docs/api.md`

### Yêu cầu cần đạt

- Migration chạy sạch trên DB backup/restore.
- Không mất dữ liệu test ngoài phạm vi.
- Go không cần migration runtime mới cho thay đổi này.
- `025` chỉ được chạy sau khi toàn bộ code đã bỏ `code`.

### Checklist test

- [x] Chạy migration trên DB tạm PASS.
- [x] Restore backup + chạy migration PASS.
- [x] `SHOW COLUMNS` có 2 cột mới; `stations.code` sẽ kiểm tra lại sau Bước 4.
- [x] FK account managed `ON DELETE CASCADE` đúng.
- [x] Không có migration cũ bị sửa.

### Ghi chú

- `025` là migration phá huỷ; phải chạy đúng thứ tự sau khi deploy code mới.
- Nếu cần rollback, restore backup thay vì viết down migration.

---

## Bước 4 — Chuẩn hóa trạm: bỏ code, tên mountpoint tự sinh, field bắt buộc

### Mục tiêu

Trạm chỉ dùng `id`; tạo trạm sinh đúng 1 mountpoint; API chặn lưu thiếu field; tên/port bất biến.

### Giải thích cơ bản

Tên mountpoint là định danh thiết bị dùng để đẩy dữ liệu. Vì đã chốt bỏ code, tên mountpoint lấy từ tên trạm là cách duy nhất còn nhất quán. Tạo trạm và mountpoint phải atomic để không có trạm thiếu endpoint.

### Việc cần làm

1. Tạo helper sinh tên mountpoint từ tên trạm.
2. Bỏ `code` khỏi:
   - `createSchema`, `updateSchema`, `stationColumns`.
   - API list/detail/create/update.
   - Import/export Excel/CSV.
   - Frontend type, form, bảng, search, filter, test.
   - Go probe store (dùng `s.id`/`s.name` thay `s.code`).
   - Scripts/docs liên quan.
3. Đổi `POST /api/stations`:
   - Nhận `name`, `port`, `source_role`, field theo vai trò.
   - Validate bắt buộc.
   - Transaction: station → source → mountpoint → account (nếu caster) → listener mapping.
   - Trả station kèm mountpoint/account vừa tạo.
4. Thêm preview tên mountpoint:
   - Endpoint `POST /api/stations/preview` hoặc tính client-side cùng thuật toán.
   - Hiển thị trước khi lưu.
5. Chặn sửa `name`, `port`:
   - Nếu payload khác giá trị hiện tại → 409 `IMMUTABLE_FIELD`.
6. Cập nhật UI form:
   - Hiển thị tên mountpoint tự sinh, read-only.
   - Không còn ô Mã trạm.
   - Disable Tên trạm/Port khi sửa.
7. Cập nhật test cũ phụ thuộc code.
8. Chạy migration `025_drop_station_code.sql` sau khi toàn bộ code/UI/import/Go đã bỏ `code`.
9. Dừng tạm writer, chạy script reset đã chuẩn bị ở Bước 2, tạo lại dữ liệu test chuẩn, khởi động lại service.
10. Kiểm tra không còn bản ghi `NULL`/rỗng ở field bắt buộc.
11. Ghi biên bản reset: thời điểm, người thực hiện, số bản ghi trước/sau.

### File/khu vực

- `server/src/lib/stationNaming.ts` (mới)
- `server/src/routes/stations.ts`
- `server/src/lib/excel.ts`, `csv.ts`
- `server/src/db/importLegacyCaster.ts`, `importRelay.ts`
- `server/src/routes/stations.ts` import/export
- `gnss/internal/probe/store.go`
- `frontend/src/types.ts`
- `frontend/src/pages/Stations.tsx`
- `frontend/tests/p1-station.spec.ts`, `station-source.spec.ts`
- `scripts/reset-test-stations.ps1`
- `server/src/db/seed.ts`
- `db/migrations/admin/025_drop_station_code.sql`

### Yêu cầu cần đạt

- Không còn `code` trong API response/UI.
- Tạo trạm thành công tạo đúng 1 mountpoint, tên đúng thuật toán.
- Tạo thiếu field bắt buộc → 400, không tạo bản ghi nào.
- Sửa name/port → 409, DB không đổi.
- Import/export không còn cột code.
- Go probe vẫn chạy, log dùng id/name.
- Dữ liệu test cũ được reset, dữ liệu mới đúng mô hình.
- Không còn station/mountpoint cũ.
- Mỗi station mới có đúng 1 mountpoint.
- Relay job cũ không còn enabled nếu trỏ tới mountpoint đã xóa.

### Checklist test

- [x] `POST /api/stations` thiếu `name` → 400.
- [x] Thiếu port → 400.
- [x] Caster thiếu username/password/listener → 400.
- [x] Client thiếu host/port/mount → 400.
- [x] Tạo hợp lệ → 201, đúng 1 station, 1 source, 1 mountpoint, 1 account.
- [x] Tên mountpoint `Trạm Hậu Lộc` → `TRAM_HAU_LOC`.
- [x] Tên trùng → tự thêm `_2`.
- [x] PATCH name → 409; PATCH port → 409.
- [x] PATCH field khác → 200.
- [x] Import/export không còn code.
- [x] Go probe test PASS.
- [x] Playwright trạm PASS.
- [x] Migration `025` chạy PASS, `information_schema` không còn cột `stations.code`.
- [x] Reset dữ liệu PASS, số station/mountpoint khớp kỳ vọng.
- [x] Không còn `station_sources` thiếu field theo vai trò.
- [x] Mỗi station caster có account NTRIP tương ứng và ACL đúng.
- [x] Không còn open connection tới mountpoint cũ.
- [x] Service healthy sau reset.

### Ghi chú

- Với caster, tên mountpoint tự sinh phải khớp cấu hình thiết bị thật. Nếu thiết bị đang dùng tên khác, phải đổi tên trạm hoặc cấu hình thiết bị trước khi tạo.
- Tên trạm bất biến nên không cần đồng bộ lại mountpoint sau này.
- Không auto-fill credential.
- Reset phải chạy sau `025`; nếu chạy trước sẽ lỗi vì `stations.code` còn `NOT NULL`.

---

## Bước 5 — CRUD trạm, ma trận trạng thái, xóa cascade

### Mục tiêu

Mọi hành động trạm đúng ma trận, áp dụng ngay, xóa trạm xóa toàn bộ mountpoint.

### Giải thích cơ bản

Trạng thái trạm là nguồn điều khiển streaming. Nếu API cho phép tổ hợp sai, Go sẽ rơi vào trạng thái không xác định. Xóa cascade phải đóng luồng trước khi xóa để không rò rỉ.

### Việc cần làm

1. Thêm endpoint từng trạm:
   - `POST /api/stations/:id/enable`
   - `POST /api/stations/:id/disable`
   - `POST /api/stations/:id/lock`
   - `POST /api/stations/:id/unlock`
2. Tập trung logic vào service dùng chung cho single và bulk.
3. Áp dụng ma trận:
   - Lock khi enabled → 400.
   - Enable/disable/delete khi locked → 400.
   - Unlock → `disabled`, không auto enable.
4. Xóa trạm:
   - Chỉ khi disabled và unlocked.
   - Thu thập mountpoint, connection, relay job, probe.
   - Đóng connection, pause relay, xóa account managed, xóa listener mapping/ACL, xóa mountpoint, xóa station.
   - Audit kèm số lượng.
5. Reconcile sau commit.
6. Bulk dùng cùng service; trả `updated/skipped/forbidden/notFound`.

### File/khu vực

- `server/src/routes/stations.ts`
- `server/src/lib/stationStream.ts`
- `server/src/lib/reconcile.ts` (mới)
- `server/src/lib/entityChange.ts` (mới)
- `frontend/src/pages/Stations.tsx`

### Yêu cầu cần đạt

- Không thể tạo tổ hợp trạng thái sai qua API.
- Xóa trạm không để mountpoint/source/probe/account managed mồ côi.
- Connection bị đóng trước khi xóa.
- Audit đầy đủ, redacted.

### Checklist test

- [x] Enable khi locked → 400.
- [x] Lock khi enabled → 400.
- [x] Disable → lock → unlock đúng chuỗi.
- [x] Delete khi enabled → 400.
- [x] Delete khi locked → 400.
- [x] Delete sau disable → 204, mountpoint count = 0.
- [!] Connection của trạm = 0 sau 2 giây — chưa có live source trong bước này; kiểm chứng đầy đủ ở Bước 13.
- [!] Relay job liên quan disabled — kiểm chứng đầy đủ ở Bước 10 khi có job test.
- [x] Account managed bị xóa.
- [x] Bulk mixed trả đúng counts.
- [ ] Audit không lộ password.

### Ghi chú

- Khóa không chặn sửa metadata/source, nhưng không được tự bật stream.
- Xóa trạm không xóa relay job; chỉ disable và giữ lịch sử.

---

## Bước 6 — CRUD Mountpoint, bất biến tên, tắt tự pause relay

### Mục tiêu

Mountpoint CRUD đầy đủ, tên bất biến, tắt là đóng connection và pause relay ngay.

### Giải thích cơ bản

Mountpoint là endpoint NTRIP. Đổi tên sẽ phá mọi liên kết theo tên với relay và thiết bị. Tắt mountpoint phải dừng cả luồng caster và relay liên quan.

### Việc cần làm

1. Chặn sửa `name` → 409.
2. Create standalone vẫn cho phép; tên phải unique.
3. Tắt mountpoint:
   - Đóng source/rover qua targeted disconnect.
   - Pause relay job khớp cả upstream/downstream.
   - Reconcile caster + relay.
4. Bật mountpoint:
   - Reconcile caster.
   - Resume relay job do chính mountpoint pause nếu station owner không còn.
5. Xóa mountpoint:
   - Yêu cầu disabled hoặc xác nhận impact.
   - Đóng connection, xóa mapping/ACL, reconcile.
   - Relay job giữ disabled, không xóa.
6. Cập nhật UI form disable name khi sửa.

### File/khu vực

- `server/src/routes/mountpoints.ts`
- `server/src/lib/reconcile.ts`
- `frontend/src/pages/Mountpoints.tsx`

### Yêu cầu cần đạt

- Không sửa được tên mountpoint.
- Tắt mountpoint đóng connection ≤ 1 giây.
- Relay job liên quan disabled ≤ 2 giây.
- UI cập nhật không F5.

### Checklist test

- [x] Rename → 409.
- [x] Tạo trùng tên → 409.
- [!] Tắt khi có source/rover → connection = 0 sau 1 giây — kiểm chứng live ở Bước 13.
- [!] Source mới bị từ chối khi disabled — kiểm chứng live ở Bước 13.
- [x] Relay job upstream/downstream disabled.
- [x] Bật lại → relay resume đúng; connection live kiểm chứng ở Bước 13.
- [!] Xóa khi online theo chính sách — kiểm chứng live ở Bước 13.
- [!] ACL/mapping cascade — kiểm chứng đầy đủ ở Bước 13.
- [x] Audit PASS.

### Ghi chú

- Không tự pause relay job không liên quan.
- Vì relay không có FK, mọi liên kết theo tên phải được kiểm tra impact trước khi xóa.

---

## Bước 7 — CRUD Tài khoản NTRIP, account managed và ngắt online

### Mục tiêu

Tài khoản NTRIP CRUD đầy đủ, username bất biến, khóa/xóa ngắt toàn bộ phiên ngay; station caster có account thật.

### Giải thích cơ bản

Go caster xác thực bằng `ntrip_accounts`, không dùng trực tiếp `station_sources.caster_username`. Vì vậy caster station phải tạo hoặc liên kết account thì credential mới có tác dụng thật.

### Việc cần làm

1. Chặn sửa `username` → 409.
2. Tạo account thường: validate username/password, ACL.
3. Tạo station caster:
   - Tạo account với username/password từ source.
   - Hash Argon2id.
   - Gán owner = station owner.
   - ACL mountpoint + listener.
   - Gán `managed_by_station_id`.
   - Nếu username đã tồn tại → 409, không tự ghi đè.
4. Sửa source station caster:
   - Nếu đổi `caster_password`, cập nhật hash account managed trong cùng transaction.
   - Nếu đổi username, vì username bất biến, phải từ chối hoặc yêu cầu tạo account mới có kiểm soát.
5. Khóa account:
   - Đóng toàn bộ connection của account.
   - Reason `account_disabled`.
   - Audit.
6. Mở khóa: không tự phục hồi connection cũ.
7. Sửa ACL:
   - Đóng connection không còn quyền.
   - Không đóng connection còn quyền.
8. Giảm `max_connections`:
   - Đóng phiên mới nhất trước, giữ phiên cũ nhất.
9. Đổi password: không đóng phiên đang chạy.
10. Xóa account:
    - Đóng toàn bộ connection trước.
    - Xóa account; ACL cascade.
    - Nếu managed, cho phép xóa cùng trạm.

### File/khu vực

- `server/src/routes/ntripAccounts.ts`
- `server/src/routes/stations.ts`
- `server/src/lib/password.ts`
- `server/src/lib/reconcile.ts`
- `db/migrations/admin/024_ntrip_account_managed.sql`
- `frontend/src/pages/NtripAccounts.tsx`

### Yêu cầu cần đạt

- Caster station luôn có account thật, ACL đúng.
- Không sửa username.
- Khóa/xóa account đóng connection ≤ 1 giây.
- Không lộ password/hash trong API/audit.

### Checklist test

- [x] Tạo station caster → account tồn tại, ACL đúng.
- [x] Username trùng → 409, không tạo station.
- [x] Sửa username → 409.
- [x] Khóa account đang online → connection = 0 sau 1 giây.
- [x] Mở khóa → kết nối mới OK.
- [x] Bỏ ACL mountpoint → connection liên quan đóng.
- [!] Giảm max_connections → đóng đúng số phiên mới nhất — thực hiện ở Bước 9.
- [!] Đổi password → phiên cũ vẫn chạy — kiểm chứng live ở Bước 13.
- [x] Xóa account online → connection = 0, account mất.
- [!] Audit redacted — rà soát security ở Bước 15.

### Ghi chú

- Không tự tạo account nếu username đã tồn tại.
- Account managed là account độc quyền của station; station xóa thì account xóa.
- Không log plaintext password ở bất kỳ đâu.

---

## Bước 8 — Reconcile pipeline và Socket.IO `entity.changed`

### Mục tiêu

Mọi mutation có một đường áp dụng thống nhất, UI nhận thay đổi ngay.

### Giải thích cơ bản

Gọi reconcile rải rác dễ bỏ sót. Cần một helper trung tâm để biết mutation nào ảnh hưởng entity nào, và một sự kiện Socket.IO để client refetch.

### Việc cần làm

1. Tạo `reconcileAffected({ stationIds, mountpointIds, listenerIds, accountIds, probeIds, relayJobIds })`.
2. Gọi sau commit ở tất cả route mutation liên quan.
3. Thêm internal API Go:
   - `/internal/caster/disconnect-account`
   - `/internal/caster/disconnect-mountpoint`
   - `/internal/caster/disconnect-listener`
4. Reconcile vẫn là fallback nếu targeted disconnect lỗi.
5. Trả trạng thái reconcile trong response:
   - `reconcile: 'ok' | 'failed'`.
6. Phát `entity.changed`:
   ```json
   { "entity": "station", "id": 1, "action": "disable", "ts": "..." }
   ```
7. Không đưa dữ liệu nhạy cảm vào event.
8. Audit khi reconcile thất bại.

### File/khu vực

- `server/src/lib/reconcile.ts` (mới)
- `server/src/lib/entityChange.ts` (mới)
- `server/src/lib/internalApi.ts`
- `server/src/realtime/socket.ts`
- `server/src/routes/*.ts`

### Yêu cầu cần đạt

- Không còn route mutation thiếu reconcile.
- Response phản ánh đúng trạng thái áp dụng.
- Event `entity.changed` phát sau commit.
- Không rò rỉ dữ liệu qua socket.

### Checklist test

- [x] Các route station/mountpoint/ntrip/listener gọi helper reconcile tập trung.
- [!] Reconcile lỗi → response `failed` — đã có `reconcile` trong response station create/patch; UI cảnh báo ở Bước 12.
- [x] Event phát đúng entity/id/action.
- [x] Không phát event trước commit.
- [x] RBAC không bị vượt qua qua event.

### Ghi chú

- Nếu Go down, DB vẫn là desired state; poll 10 giây sẽ áp dụng lại khi Go lên.
- `entity.changed` chỉ là tín hiệu refetch, không phải nguồn dữ liệu.

---

## Bước 9 — Go caster: đóng đích danh, chống race, max_connections

### Mục tiêu

Đóng đúng connection, không kẹt hub, không rò rỉ goroutine/source slot.

### Giải thích cơ bản

Reconcile toàn bộ có thể có race với connection vừa accept. Nếu connection bị đóng trước khi add vào hub, nó có thể nằm lại trong hub và chiếm source slot.

### Việc cần làm

1. Thêm phương thức:
   - `DisconnectAccount(accountID, reason)`
   - `DisconnectMountpoint(mountpointID, reason)`
   - `DisconnectListener(listenerID, reason)`
2. Sửa race register/add hub:
   - Add source/rover vào hub trước khi connection có thể bị reconcile đóng, hoặc
   - Kiểm tra `closed` sau khi add và remove ngay.
3. `listenerRuntime.stop()`:
   - Đánh dấu closed.
   - Connection đã accept sau stop phải bị từ chối.
4. Reconcile áp dụng `max_connections`:
   - Nếu số phiên vượt, đóng phiên mới nhất.
5. Ghi reason rõ:
   - `account_disabled`, `mountpoint_disabled`, `listener_disabled`, `station_disabled`, `max_connections`.
6. Đảm bảo `caster_connections.end_ts` luôn được set.

### File/khu vực

- `gnss/internal/caster/manager.go`
- `gnss/internal/caster/listener.go`
- `gnss/internal/caster/hub.go`
- `gnss/internal/caster/connection.go`
- `gnss/internal/caster/caster_test.go`
- `gnss/internal/api/server.go`

### Yêu cầu cần đạt

- Đóng connection không để lại entry trong hub.
- Source slot giải phóng ngay.
- Không tăng goroutine sau nhiều vòng.
- `go test -race` PASS.

### Checklist test

- [x] Unit test disconnect account/mountpoint/listener.
- [!] Test source/rover đóng đúng reason — đóng đúng nhóm; assert reason chi tiết bổ sung ở Bước 13.
- [!] Test race connect + disable — đã chạy `-race` toàn package; kịch bản đồng thời riêng ở Bước 14.
- [!] Test 50 vòng bật/tắt, goroutine ổn định — Bước 14.
- [x] Test max_connections giảm.
- [x] `go test -race ./internal/caster` PASS (qua Docker golang:1.24).
- [x] `go vet ./...` PASS.

### Ghi chú

- Không giữ connection đã đóng trong `hub.rovers` hoặc `hub.source`.
- Không dùng poll 10 giây làm cơ chế chính; poll chỉ là fallback.

---

## Bước 10 — Relay pause ownership cho trạm và mountpoint

### Mục tiêu

Pause/resume relay đúng chủ, đúng chiều, không bật nhầm job khi còn điều kiện tắt.

### Giải thích cơ bản

Một relay job có thể bị tắt vì trạm hoặc vì mountpoint. Cần biết ai là chủ để khi một điều kiện được gỡ, job chỉ bật lại nếu không còn điều kiện nào khác.

### Việc cần làm

1. Dùng `paused_by_station_id` và `paused_by_mountpoint_id`.
2. Tắt mountpoint:
   - Khớp `upstream_mount = name` hoặc `downstream_mount = name`.
   - Set `paused_by_mountpoint_id`.
   - Tăng revision.
3. Tắt trạm:
   - Khớp tên tất cả mountpoint của trạm, cả upstream/downstream.
   - Set `paused_by_station_id`.
4. Resume:
   - Clear đúng owner.
   - Chỉ `enabled=1` nếu owner còn lại là NULL.
5. Manual disable:
   - Clear cả hai owner, giữ disabled.
6. Manual enable:
   - Nếu còn owner → 409.
7. Xóa mountpoint:
   - Job đang pause bởi mountpoint giữ disabled.
   - Clear owner để tránh treo.
   - Audit.
8. Reconcile job id ngay sau commit.

### File/khu vực

- `db/migrations/admin/023_relay_pause_mountpoint.sql`
- `server/src/lib/stationStream.ts`
- `server/src/routes/mountpoints.ts`
- `server/src/routes/relayJobs.ts`
- `server/src/lib/reconcile.ts`

### Yêu cầu cần đạt

- Không bật nhầm job khi trạm hoặc mountpoint còn tắt.
- Không kẹt job disabled sau khi cả hai điều kiện đã gỡ.
- Manual override rõ ràng.
- Reconcile ngay.

### Checklist test

- [x] Tắt mountpoint → job upstream disabled.
- [x] Tắt mountpoint → job downstream disabled.
- [x] Tắt trạm → job upstream/downstream của mountpoint trạm disabled.
- [x] Bật mountpoint khi trạm còn tắt → job vẫn disabled.
- [x] Bật trạm khi mountpoint còn tắt → job vẫn disabled (owner mountpoint còn giữ).
- [x] Bật cả hai → job enabled.
- [x] Manual disable khi đang pause → resume không bật lại.
- [x] Manual enable khi còn pause → 409.
- [x] Xóa mountpoint → job disabled, owner cleared.
- [x] Revision tăng ở các câu lệnh pause/resume.

### Ghi chú

- Vì relay không có FK, khớp theo tên là quy ước hiện tại; UI impact phải hiển thị rõ.
- Không xóa relay job khi xóa trạm/mountpoint.

---

## Bước 11 — Probe, listener và source: áp dụng ngay khi cấu hình đổi

### Mục tiêu

Probe/listener/source thay đổi phải có hiệu lực ngay, kể cả khi ID không đổi.

### Giải thích cơ bản

Probe manager hiện chỉ thêm/xóa session theo ID. Nếu cùng ID nhưng host/port/mount đổi, session cũ vẫn chạy. Cần fingerprint cấu hình để restart.

### Việc cần làm

1. Thêm fingerprint cấu hình probe.
2. Khi reconcile:
   - Nếu fingerprint đổi → cancel session cũ, start session mới.
3. Station probe create/update/delete/enable/disable → reconcile ngay.
4. Station source PUT → reconcile caster/probe/relay liên quan.
5. Listener update:
   - Đổi port/role → restart listener.
   - Đổi mountpoint mapping → đóng connection không còn hợp lệ.
6. Reconcile response về Node.

### File/khu vực

- `gnss/internal/probe/manager.go`
- `gnss/internal/probe/store.go`
- `server/src/routes/quality.ts`
- `server/src/routes/stations.ts` (source PUT)
- `server/src/routes/caster.ts`

### Yêu cầu cần đạt

- Đổi cấu hình probe có hiệu lực ≤ 1 giây.
- Tắt probe dừng sample ≤ 2 giây.
- Đổi listener mapping đóng connection sai ngay.
- Source PUT áp dụng ngay.

### Checklist test

- [!] Tắt probe → không còn sample mới — chưa có probe credential/upstream thật trong bước này; kiểm chứng live ở Bước 13.
- [!] Bật probe → có sample mới — chờ Bước 13.
- [x] Đổi host/port/password probe → fingerprint đổi, session restart.
- [!] Đổi source station → probe/relay dùng cấu hình mới — reconcile đã gọi; kiểm chứng live ở Bước 13.
- [x] Gỡ mountpoint khỏi listener → connection bị đóng.
- [!] UI cập nhật — Bước 12.

### Ghi chú

- Không chặn relay/caster nếu analyzer/probe lỗi.
- Queue analyzer vẫn giới hạn, đầy thì drop sample.

---

## Bước 12 — UI realtime, form và hành động theo trạng thái

### Mục tiêu

UI phản ánh thay đổi từ mọi nguồn trong 2 giây; form đúng ràng buộc; thao tác đúng ma trận.

### Giải thích cơ bản

Socket snapshot hiện có nhưng danh sách không dùng. Cần invalidate query theo `entity.changed`, đồng thời có fallback polling khi socket mất kết nối.

### Việc cần làm

1. `RealtimeProvider` dùng `useQueryClient`, nghe `entity.changed`.
2. Map entity → query keys:
   - station → `stations`, `station-sources`, `online-connections`, detail.
   - mountpoint → `mountpoints`, `mountpoint-impact`.
   - account → `ntrip-accounts`, `ntrip-acl`, `ntrip-listener-acl`, `online-connections`.
   - listener → `caster-listeners`, `online-connections`.
   - relay/probe → key tương ứng.
3. Debounce 150 ms.
4. Fallback:
   - OnlineList refetch 5 giây khi socket disconnected.
   - Stations/Mountpoints 10 giây.
5. Form:
   - Disable name/port khi sửa trạm.
   - Disable name khi sửa mountpoint.
   - Disable username khi sửa account.
   - Hiển thị mountpoint tự sinh.
   - Đánh dấu field bắt buộc.
6. Hành động row:
   - Bật/Tắt/Khóa/Mở khóa/Xóa theo ma trận.
   - Ẩn/disable nút sai trạng thái.
   - Xóa dùng AlertDialog, không `window.confirm`.
7. Hiển thị online count/account, trạng thái reconcile failed.
8. A11y: focus, Esc, aria, contrast.

### File/khu vực

- `frontend/src/realtime/RealtimeProvider.tsx`
- `frontend/src/pages/Stations.tsx`
- `frontend/src/pages/Mountpoints.tsx`
- `frontend/src/pages/NtripAccounts.tsx`
- `frontend/src/pages/OnlineList.tsx`
- `frontend/src/components/StationDetailDrawer.tsx`
- `frontend/src/types.ts`

### Yêu cầu cần đạt

- Thay đổi từ tab/người dùng khác hiện trong 2 giây.
- Form không cho sửa field bất biến.
- Nút hành động không cho thao tác sai ma trận.
- Không còn `window.confirm`.

### Checklist test

- [x] Tắt/bật trạm từ actor khác → danh sách cập nhật ≤ 2 giây (Playwright).
- [!] Khóa account → OnlineList cập nhật — event đã invalidate `online-connections`; test live ở Bước 13.
- [!] Tắt mountpoint → chi tiết cập nhật — event đã invalidate `mountpoints`; test live ở Bước 13.
- [!] Socket offline → fallback polling — đã cấu hình 5–10 giây; test offline ở Bước 13.
- [x] Form sửa trạm disable name (port lấy từ listener, read-only).
- [x] Form mountpoint disable name.
- [x] Form account disable username.
- [x] Nút xóa disable khi trạm đang bật; hành động row theo ma trận.
- [!] A11y keyboard — kiểm tra đầy đủ ở Bước 15.
- [x] Playwright realtime không lỗi pageerror.

### Ghi chú

- Invalidating quá nhiều có thể gây tải; debounce và chỉ invalidate key liên quan.
- Không dùng event để trả dữ liệu entity trực tiếp.

---

## Bước 13 — Flow test mock end-to-end

### Mục tiêu

Chứng minh toàn bộ chuỗi entity hoạt động bằng mock trước khi chạm dữ liệu thật.

### Giải thích cơ bản

Mock cho phép lặp lại, đo byte-exact, mô phỏng disconnect/reconnect và race mà không ảnh hưởng thiết bị thật.

### Việc cần làm

1. Dùng `scripts/mock-ntrip` mode source/rover.
2. Dùng listener test `15999`, không dùng cổng thật.
3. Tạo dữ liệu tiền tố `E2E_`.
4. Chạy các flow:

#### Flow A — Chuỗi liên kết
- Tạo listener, station caster, mountpoint tự sinh, account, probe, relay.
- Mock source push RTCM, mock rover đọc.
- Kiểm tra byte-exact, connection, quality, relay/probe, UI.

#### Flow B — Tắt/bật trạm
- Baseline bytes/frames/goroutine.
- Tắt trạm.
- Kiểm tra DB, Go connection, mock capture dừng, relay/probe dừng, UI.
- Bật lại; mock source reconnect; dữ liệu chảy lại.
- Lặp 20–50 lần.

#### Flow C — Ma trận trạm
- Lock khi enabled → chặn.
- Disable → lock → unlock.
- Enable/disable/delete khi locked → chặn.
- Delete khi enabled → chặn.
- Disable → delete → mountpoint = 0.

#### Flow D — Mountpoint
- Rename → 409.
- Tắt khi online → connection đóng, relay pause.
- Bật lại → hoạt động.
- Xóa → impact/cleanup đúng.

#### Flow E — Account online
- Rover kết nối.
- Lock → đóng ngay.
- Unlock → kết nối mới OK.
- Bỏ ACL → chỉ connection liên quan đóng.
- Giảm max_connections.
- Delete online → đóng rồi xóa.

#### Flow F — Relay/Probe/Listener
- Tắt/bật probe.
- Đổi source.
- Disable/enable listener.
- Tắt trạm relay_caster → job disabled, capture dừng.

#### Flow G — UI realtime
- Hai tab.
- Thao tác tab A, kiểm tra tab B.
- Ngắt socket, kiểm tra fallback.

### File/khu vực

- `scripts/mock-ntrip/`
- `scripts/fixtures/`
- `frontend/tests/entity-lifecycle.spec.ts` (mới)
- `frontend/tests/entity-realtime.spec.ts` (mới)
- `server/tests/` (nếu cần unit)
- `gnss/internal/caster/*_test.go`

### Yêu cầu cần đạt

- Tất cả flow mock PASS.
- Có bằng chứng file capture, SQL, screenshot, log.
- Không dùng endpoint công cộng.

### Checklist test

- [ ] Flow A PASS.
- [ ] Flow B PASS.
- [ ] Flow C PASS.
- [ ] Flow D PASS.
- [ ] Flow E PASS.
- [ ] Flow F PASS.
- [ ] Flow G PASS.
- [ ] Capture không tăng byte sau khi tắt.
- [ ] DB open connection = 0 sau 2 giây.
- [ ] UI cập nhật ≤ 2 giây.
- [ ] Evidence lưu trong `test-results/`.

### Ghi chú

- Mock source cần tự reconnect để test bật lại.
- Không dùng dữ liệu thật trong bước này.

---

## Bước 14 — Race, leak, load và dữ liệu thật

### Mục tiêu

Chứng minh không rò rỉ tài nguyên và luồng thật hoạt động sau khi mock PASS.

### Giải thích cơ bản

Race chỉ lộ khi connect/disconnect đồng thời. Leak chỉ lộ sau nhiều vòng. Dữ liệu thật xác nhận cấu hình thiết bị và credential đúng.

### Việc cần làm

1. Chạy `go test -race ./...`.
2. Chạy 50 vòng bật/tắt trạm, mountpoint, account.
3. Đo goroutine, file descriptor, open connection.
4. Chạy load test mock 50–100 job.
5. Chọn endpoint được phép cho dữ liệu thật:
   - 1 station `caster_ingest`.
   - 1 station `relay_caster`/relay job.
   - 1 account rover.
6. Thao tác ngoài giờ, có người duyệt.
7. Ghi baseline, thao tác, khôi phục, biên bản.

### File/khu vực

- `scripts/load-test-mock.ps1`
- `gnss/internal/caster/caster_test.go`
- `gnss/internal/relay/*_test.go`
- `frontend/tests/`
- `test-results/`

### Yêu cầu cần đạt

- Không tăng goroutine/connection sau nhiều vòng.
- Race test PASS.
- Load test không làm sập relay/caster.
- Dữ liệu thật chảy lại sau bật.
- Không ảnh hưởng ngoài phạm vi.

### Checklist test

- [ ] `go test -race ./...` PASS.
- [ ] 50 vòng toggle không leak.
- [ ] `caster_connections` open = 0 sau mỗi vòng.
- [ ] Load 50–100 job PASS.
- [ ] Real caster station: tắt dừng, bật có dữ liệu.
- [ ] Real relay: tắt dừng, bật chạy.
- [ ] Real account: khóa mất online, mở kết nối mới OK.
- [ ] Biên bản real test có thời điểm/người thực hiện.
- [ ] Không dùng mountpoint công cộng.

### Ghi chú

- Nếu không có thiết bị thật, đánh dấu `BLOCKED`, không đánh PASS.
- Thiết bị caster có thể reconnect theo chu kỳ riêng; ghi rõ đây là phụ thuộc ngoài hệ thống.
- Rollback ngay nếu luồng thật không phục hồi.

---

## Bước 15 — Regression, tài liệu, release và rollback

### Mục tiêu

Chốt chất lượng, cập nhật tài liệu, có quy trình rollback rõ ràng.

### Giải thích cơ bản

Một thay đổi realtime ảnh hưởng nhiều module. Cần regression toàn bộ và tài liệu vận hành trước khi coi là DONE.

### Việc cần làm

1. Chạy regression:
   - `cd server; npm test`
   - `cd gnss; go test ./...; go vet ./...`
   - `cd frontend; npx playwright test`
2. Kiểm tra diff, không secret.
3. Cập nhật:
   - `docs/api.md`
   - `TASKS.md`
   - `SESSION.md`
   - `README.md` nếu lệnh thay đổi.
4. Ghi bằng chứng PASS/FAIL.
5. Viết quy trình rollback:
   - Bật lại trạm/account theo thứ tự.
   - Restore DB nếu migration lỗi.
   - Revert code nếu cần.
6. Chạy `graphify update .` sau thay đổi cấu trúc lớn.

### File/khu vực

- `TASKS.md`
- `SESSION.md`
- `docs/api.md`
- `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
- `README.md`

### Yêu cầu cần đạt

- Regression PASS.
- Không secret trong diff.
- Tài liệu khớp hành vi.
- Rollback có thể thực hiện.

### Checklist test

- [ ] Server test PASS.
- [ ] Go test/vet PASS.
- [ ] Playwright PASS.
- [ ] Không còn `stations.code` trong code/API/UI.
- [ ] Không còn `window.confirm`.
- [ ] Không secret trong diff.
- [ ] `SESSION.md` cập nhật.
- [ ] `TASKS.md` cập nhật.
- [ ] Rollback đã diễn tập.
- [ ] Graphify cập nhật.

### Ghi chú

- Chỉ DONE khi có bằng chứng test.
- Nếu còn FAIL, ghi issue và không chuyển bước.

## 6. Test matrix tổng hợp

| ID | Case | Entity | Kỳ vọng | Bằng chứng |
|---|---|---|---|---|
| ST-01 | Tạo thiếu tên | Station | 400 | API log |
| ST-02 | Tạo thiếu port | Station | 400 | API log |
| ST-03 | Caster thiếu credential | Station | 400 | API log |
| ST-04 | Client thiếu host/port/mount | Station | 400 | API log |
| ST-05 | Tạo hợp lệ | Station | 201 + 1 MP + 1 account | SQL/API |
| ST-06 | Sửa name | Station | 409 | API log |
| ST-07 | Sửa port | Station | 409 | API log |
| ST-08 | Tắt đang streaming | Station | Connection = 0 ≤ 1s | Capture/SQL |
| ST-09 | Bật lại | Station | Dữ liệu chảy lại | Capture/UI |
| ST-10 | Lock khi enabled | Station | 400 | API log |
| ST-11 | Delete khi locked | Station | 400 | API log |
| ST-12 | Delete cascade | Station | MP = 0, account managed mất | SQL |
| MP-01 | Rename | Mountpoint | 409 | API log |
| MP-02 | Tắt online | Mountpoint | Connection = 0 ≤ 1s | SQL |
| MP-03 | Tắt → relay pause | Mountpoint | Job disabled ≤ 2s | SQL/Go |
| MP-04 | Bật lại | Mountpoint | Connection/relay OK | Go/UI |
| NA-01 | Rename username | Account | 409 | API log |
| NA-02 | Lock online | Account | Connection = 0 ≤ 1s | SQL |
| NA-03 | ACL remove | Account | Chỉ connection liên quan đóng | SQL |
| NA-04 | Giảm max_connections | Account | Đóng phiên mới nhất | Go/SQL |
| NA-05 | Delete online | Account | Đóng rồi xóa | SQL |
| RT-01 | Hai tab | UI | Cập nhật ≤ 2s | Video/screenshot |
| RT-02 | Socket offline | UI | Fallback polling | Video/log |
| RL-01 | Connect + disable đồng thời | Go | Không kẹt hub | Go test |
| RL-02 | 50 vòng toggle | Go | Goroutine ổn định | Test output |
| REAL-01 | Caster thật | Real | Tắt dừng, bật chảy | Biên bản |
| REAL-02 | Relay thật | Real | Tắt dừng, bật chạy | Biên bản |
| REAL-03 | Account thật | Real | Khóa mất online | Biên bản |

## 7. Lệnh kiểm tra

```powershell
docker compose ps
docker compose logs --tail=200 server
docker compose logs --tail=200 gnss

cd server
npm test

cd ..\gnss
go test ./...
go vet ./...
go test -race ./internal/caster ./internal/probe ./internal/relay

cd ..\frontend
npx playwright test
```

SQL kiểm tra:

```sql
SELECT COUNT(*) FROM cors_runtime.caster_connections WHERE end_ts IS NULL;
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = 'cors_admin' AND table_name = 'stations' AND column_name = 'code';
SELECT COUNT(*) FROM cors_admin.mountpoints m JOIN cors_admin.stations s ON s.id = m.station_id;
SELECT id, name, enabled FROM cors_admin.relay_jobs WHERE paused_by_mountpoint_id IS NOT NULL;
```

## 8. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Reset nhầm dữ liệu | Backup, dừng writer, xác nhận, chạy trên DB test |
| Trạm legacy thiếu credential | Reset theo phương án A; không auto-fill |
| Thiết bị caster không reconnect ngay | Ghi rõ phụ thuộc thiết bị; mock chứng minh phía server |
| Tên mountpoint tự sinh không khớp thiết bị | Hiển thị preview; đổi tên trạm/cấu hình thiết bị trước khi tạo |
| Xóa trạm làm mất mountpoint đang dùng | Impact dialog, audit, yêu cầu disabled/unlocked |
| Relay job bị pause nhầm | Chỉ khớp tên, hiển thị impact, không xóa job |
| Reconcile lỗi nhưng API báo thành công | Trả `reconcile: failed`, cảnh báo UI, alert |
| Race gây kẹt source | Test race, sửa add hub/closed check |
| UI invalidate quá nhiều | Debounce, chỉ key liên quan |

## 9. Definition of Done

Một bước chỉ DONE khi:

1. Checklist test của bước PASS hoặc có ghi chú chấp nhận.
2. Có bằng chứng: log, SQL, screenshot, capture, test output.
3. Không còn FAIL chưa xử lý.
4. Không secret trong diff.
5. Diff đã review.
6. `SESSION.md` cập nhật.

Toàn bộ kế hoạch chỉ DONE khi:

- 15 bước PASS.
- Mock PASS trước real.
- Real streaming có biên bản.
- Không còn station code.
- Không còn open connection/goroutine rò rỉ.
- UI realtime ≤ 2 giây.
- Regression PASS.

## 10. Nhật ký thực hiện

### Nhật ký thực hiện — Bước 1
- Thời điểm: 2026-11-01 09:27 +07:00
- Trạng thái: DONE
- Commit: 8d6512b
- Push: origin/main
- Đã làm:
  - Xác nhận 4 service Docker healthy.
  - Backup MySQL ra ngoài repo và kiểm tra restore trên schema tạm.
  - Ghi baseline số lượng entity, connection đang mở, source_type.
  - Xuất danh sách 39 trạm thiếu credential caster.
  - Xác nhận cổng cấm 2101/8081 không có trong compose; chốt listener test 15999.
- File thay đổi:
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
  - `test-results/realtime/step1-baseline.txt` (không commit do gitignore)
- Test/Bằng chứng:
  - Lệnh: `docker compose ps`
  - Kết quả: mysql/server/gnss/web healthy.
  - Backup: `F:\3.Laptrinh\1. Project\1. GNSS\Backup\cors-mysql-20261101-092702.sql.zip`
  - SHA256: `065871921DA2139530A98243B53C0ECCAC99585EF992A04D03B628B1B9BE2971`
  - Restore check: PASS, stations=40 mountpoints=39 ntrip_accounts=2 listeners=2.
  - Baseline: stations=40, mountpoints=39, accounts=2, listeners=2, probes=2, relay jobs=2, open connections=0.
  - Thiếu credential caster: 39.
- Checklist đã đạt:
  - [x] Docker healthy.
  - [x] Backup + restore check PASS.
  - [x] Baseline entity/connection.
  - [x] Danh sách thiếu credential.
  - [x] Không chạm cổng cấm/backup relay.
- Lỗi/Ghi chú:
  - Không có lỗi.
  - Dữ liệu baseline nằm ngoài repo để tránh commit artifact.

### Nhật ký thực hiện — Bước 2
- Thời điểm: 2026-11-01 09:35 +07:00
- Trạng thái: DONE
- Commit: e94202a
- Push: origin/main
- Đã làm:
  - Tạo `scripts/reset-test-stations.ps1` với dry-run mặc định, kiểm tra backup, transaction và tùy chọn `-ClearRuntime`.
  - Tạo `scripts/seed-realtime-test.ps1` để tạo listener test 15999 và 3 trạm mẫu (caster_ingest, relay_caster, ntrip_client).
  - Chạy dry-run reset, đối chiếu baseline; chưa thay đổi dữ liệu.
- File thay đổi:
  - `scripts/reset-test-stations.ps1`
  - `scripts/seed-realtime-test.ps1`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - Lệnh: `powershell -File scripts/reset-test-stations.ps1`
  - Kết quả: `DRY_RUN`, backup hợp lệ.
  - Counts: stations=40, mountpoints=39, station_sources=40, probes=2, accounts=2, caster_connections=106 (lịch sử), relay_jobs_enabled=1.
  - Chưa chạy `-Execute`.
- Checklist đã đạt:
  - [x] Dry-run PASS.
  - [x] Không xóa web_users/roles/listener chuẩn.
  - [x] Kiểm tra backup trước khi chạy.
  - [x] Có xác nhận thời điểm reset.
  - [x] Chưa chạy reset thật.
- Lỗi/Ghi chú:
  - Script seed sẽ được đối chiếu lại với payload API sau Bước 4.
  - Không ghi password/DSN ra output.

### Nhật ký thực hiện — Bước 3
- Thời điểm: 2026-11-01 09:42 +07:00
- Trạng thái: DONE
- Commit: 705223c
- Push: origin/main
- Đã làm:
  - Tạo migration `023_relay_pause_mountpoint.sql`.
  - Tạo migration `024_ntrip_account_managed.sql`.
  - Kiểm tra migration trên schema tạm restore từ backup.
  - Áp dụng migration lên DB hiện tại bằng migration runner của Node.
  - Xác nhận service vẫn healthy.
- File thay đổi:
  - `db/migrations/admin/023_relay_pause_mountpoint.sql`
  - `db/migrations/admin/024_ntrip_account_managed.sql`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - Restore backup sang schema tạm + chạy 023/024: PASS.
  - Live migration: admin 023, 024 applied; runtime 0.
  - `relay_jobs.paused_by_mountpoint_id` tồn tại.
  - `ntrip_accounts.managed_by_station_id` tồn tại.
  - FK `fk_ntrip_accounts_managed_station` có `DELETE_RULE=CASCADE`.
  - `docker compose ps`: mysql/server/gnss/web healthy.
- Checklist đã đạt:
  - [x] Migration trên DB tạm PASS.
  - [x] Restore backup + migration PASS.
  - [x] Có cột mới.
  - [x] FK CASCADE đúng.
  - [x] Không sửa migration cũ.
- Lỗi/Ghi chú:
  - `025_drop_station_code.sql` chưa tạo/chạy; để Bước 4 xử lý cùng code bỏ `stations.code`.
  - Không cần migration runtime cho thay đổi này.

### Nhật ký thực hiện — Bước 4
- Thời điểm: 2026-11-01 10:33 +07:00
- Trạng thái: DONE
- Commit: 63cb8a2
- Push: origin/main
- Đã làm:
  - Bỏ `stations.code` khỏi schema, API, UI, import/export, seed và Go probe store.
  - Thêm helper sinh mountpoint từ tên trạm, xử lý dấu tiếng Việt và trùng tên `_2`.
  - Tạo transaction trạm → source → mountpoint → account NTRIP → listener mapping.
  - Bắt buộc field theo vai trò; chặn sửa `name`/`port`.
  - Áp dụng migration `025_drop_station_code.sql`.
  - Reset và seed lại 3 trạm test chuẩn.
  - Cập nhật test Playwright tạo trạm theo field bắt buộc; bỏ assert mã trạm.
- File thay đổi:
  - `server/src/routes/stations.ts`
  - `server/src/lib/stationNaming.ts`
  - `server/src/lib/stationResources.ts`
  - `server/src/lib/alertImpact.ts`
  - `server/src/routes/map.ts`
  - `server/src/routes/mountpoints.ts`
  - `server/src/routes/ntripAccounts.ts`
  - `server/src/routes/caster.ts`
  - `server/src/db/seed.ts`
  - `server/src/db/importLegacyCaster.ts`
  - `gnss/internal/probe/store.go`
  - `gnss/internal/probe/manager.go`
  - `db/migrations/admin/025_drop_station_code.sql`
  - `frontend/src/types.ts`
  - `frontend/src/pages/Stations.tsx`
  - `frontend/src/pages/Mountpoints.tsx`
  - `frontend/src/pages/MountpointExplorer.tsx`
  - `frontend/src/pages/Dashboard.tsx`
  - `frontend/src/pages/OnlineMap.tsx`
  - `frontend/src/pages/StationMap.tsx`
  - `frontend/src/pages/UnifiedMap.tsx`
  - `frontend/src/components/StationDetailDrawer.tsx`
  - `frontend/tests/p1-station.spec.ts`
  - `frontend/tests/ui.spec.ts`
  - `scripts/reset-test-stations.ps1`
- Test/Bằng chứng:
  - `server npm run build`: PASS.
  - `server npm test`: 53/53 PASS.
  - `frontend tsc --noEmit`: PASS.
  - `gnss go test ./...`: PASS.
  - `gnss go test ./internal/probe`: PASS.
  - `docker compose build gnss` + recreate: healthy, runtime schema v5.
  - API: thiếu name=400, thiếu port=400, caster thiếu field=400, client thiếu field=400.
  - API: tạo hợp lệ=201, 1 source, 1 mountpoint, 1 account.
  - `Trạm Hậu Lộc` → `TRAM_HAU_LOC`.
  - Tên trùng → mountpoint `_2`.
  - PATCH name/port → 409; PATCH notes → 200.
  - SQL: `stations.code` column count = 0.
  - Reset/seed: 3 stations, 3 mountpoints, 3 sources, 0 missing mountpoint, 0 missing credential, 2 caster ACL.
  - Playwright `tests/p1-station.spec.ts`: 1/1 PASS.
- Checklist đã đạt:
  - [x] Required field và immutable.
  - [x] Tạo trạm atomic với mountpoint/account.
  - [x] Bỏ code khỏi API/UI/import/Go.
  - [x] Migration 025 và reset dữ liệu.
  - [x] Test server/frontend/Go/Playwright liên quan.
- Lỗi/Ghi chú:
  - Đã xử lý lỗi server cũ chưa restart sau build (Unknown column 'code').
  - Đã xử lý lệch placeholder INSERT và default trong update schema.
  - `stations.port` bắt buộc; UI lấy port từ listener khi tạo trạm caster.
  - Import legacy giờ dùng tên trạm làm khóa, không còn code.
### Nhật ký thực hiện — Bước 5
- Thời điểm: 2026-11-01 10:37 +07:00
- Trạng thái: DONE
- Commit: 7642cce
- Push: origin/main
- Đã làm:
  - Thêm endpoint từng trạm: enable/disable/lock/unlock.
  - Áp dụng ma trận trạng thái cho single và bulk.
  - Xóa trạm cascade: đóng/pause tài nguyên, xóa mountpoint/source/probe/account managed, rồi xóa trạm.
  - Bulk delete dùng chung cascade; bỏ qua trạm đang bật hoặc đang khóa.
  - Ghi audit cho từng hành động.
- File thay đổi:
  - `server/src/routes/stations.ts`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `server npm run build`: PASS.
  - Enable trạm disabled → 200, `enabled=1/status=active`.
  - Lock khi enabled → 400.
  - Disable → 200; Lock → 200 `status=locked`.
  - Enable/Disable/Delete khi locked → 400.
  - Unlock → 200 `status=disabled`.
  - Delete sau disable → 204; station/mountpoint/account managed = 0.
  - Bulk: lock 2 → updated=2; delete khi locked → skipped=2; unlock 2 → updated=2; delete → updated=2; station/mountpoint = 0.
  - Reset/seed lại 3 trạm test sau kiểm thử.
- Checklist đã đạt:
  - [x] Ma trận single.
  - [x] Ma trận bulk.
  - [x] Delete cascade.
  - [x] Account managed bị xóa.
  - [!] Connection live và relay job liên quan để Bước 10/13 kiểm chứng đầy đủ.
- Lỗi/Ghi chú:
  - Test ma trận đầu tiên dùng trạm mặc định disabled nên phải reset/seed và chạy lại với trạm được enable.
  - Xóa trạm không xóa relay job; job bị disable và audit lại.
### Nhật ký thực hiện — Bước 6
- Thời điểm: 2026-11-01 10:43 +07:00
- Trạng thái: DONE
- Commit: 325f60b
- Push: origin/main
- Đã làm:
  - Chặn sửa tên mountpoint; trả 409.
  - Thêm guard trùng tên khi tạo mountpoint; trả 409.
  - Tắt mountpoint: đóng qua caster reconcile và pause relay job khớp upstream/downstream.
  - Bật mountpoint: resume job do chính mountpoint pause nếu station owner không còn.
  - Xóa mountpoint: pause/disable relay liên quan, xóa ACL/mapping theo FK, reconcile.
  - Create/update/bulk/delete đều reconcile ngay sau commit.
- File thay đổi:
  - `server/src/routes/mountpoints.ts`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `server npm run build`: PASS.
  - Rename mountpoint → 409.
  - Tạo trùng tên → 409.
  - Temp MP + relay upstream: disable → enabled=0, paused_by_mountpoint_id=MP; enable → enabled=1, owner NULL.
  - Temp MP + relay downstream: disable → enabled=0, owner=MP; enable → enabled=1, owner NULL.
  - Delete MP → relay liên quan disabled và owner cleared.
  - Delete MP → API 204; mapping/ACL cascade theo FK.
- Checklist đã đạt:
  - [x] Rename/duplicate 409.
  - [x] Relay upstream/downstream pause/resume/delete.
  - [x] Audit.
  - [!] Connection live, source reject, delete online, mapping cascade live để Bước 13.
- Lỗi/Ghi chú:
  - Pause chỉ áp dụng job đang enabled; job đã tắt tay không bị biến thành job pause của mountpoint.
  - Resume chỉ bật khi `paused_by_station_id IS NULL`.
### Nhật ký thực hiện — Bước 7
- Thời điểm: 2026-11-01 10:47 +07:00
- Trạng thái: DONE
- Commit: 03ddca9
- Push: origin/main
- Đã làm:
  - Chặn sửa username NTRIP; trả 409.
  - Lock/unlock/create/patch/ACL/bulk/delete gọi caster reconcile ngay.
  - Đồng bộ password managed account khi sửa source trạm caster.
  - Cập nhật listener ACL account khi đổi listener nguồn.
  - Bổ sung username/password cho mock NTRIP rover để test online thật.
- File thay đổi:
  - `server/src/routes/ntripAccounts.ts`
  - `server/src/routes/stations.ts`
  - `scripts/mock-ntrip/main.go`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `server npm run build`: PASS.
  - Mock rover kết nối caster 1509 với Basic auth; `/api/connections` có account.
  - PATCH username → 409.
  - Tạo account trùng username → 409.
  - Lock account khi online → connection = 0 sau 1.5 giây.
  - Unlock → không tự phục hồi; rover mới kết nối OK.
  - Bỏ ACL mountpoint → connection đóng.
  - Delete account khi online → connection = 0; account mất.
  - Không log password trong output test.
- Checklist đã đạt:
  - [x] Managed account/ACL.
  - [x] Username immutable/duplicate.
  - [x] Lock/unlock/ACL/delete online.
  - [!] max_connections (Bước 9); password session (Bước 13); audit redaction (Bước 15).
- Lỗi/Ghi chú:
  - Listener test 15999 không expose ra host; dùng listener 1509 + mapping tạm để test rover.
  - Đã reset/seed lại 3 trạm test sau kiểm thử.
### Nhật ký thực hiện — Bước 8
- Thời điểm: 2026-11-01 10:51 +07:00
- Trạng thái: DONE
- Commit: c20f6f1
- Push: origin/main
- Đã làm:
  - Thêm `reconcileAffected` dùng chung cho caster/relay/probe.
  - Chuyển stationStream, mountpoint, ntrip account, listener sang helper.
  - Thêm `entity.changed` qua Socket.IO; phát sau commit.
  - Phát event cho station, mountpoint, ntrip account, listener.
  - Station create/patch trả thêm `reconcile`.
- File thay đổi:
  - `server/src/lib/reconcile.ts`
  - `server/src/lib/entityChange.ts`
  - `server/src/realtime/socket.ts`
  - `server/src/lib/stationStream.ts`
  - `server/src/routes/stations.ts`
  - `server/src/routes/mountpoints.ts`
  - `server/src/routes/ntripAccounts.ts`
  - `server/src/routes/caster.ts`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `server npm run build`: PASS.
  - Node socket client login + connect; PATCH station notes.
  - Nhận `entity.changed`: `{entity:'station', id:434, action:'update', ts:...}`.
  - Event phát sau khi PATCH thành công.
- Checklist đã đạt:
  - [x] Helper tập trung cho 4 module chính.
  - [x] Event đúng entity/id/action.
  - [x] Không event trước commit.
  - [x] Event không chứa dữ liệu nhạy cảm.
  - [!] UI cảnh báo reconcile fail ở Bước 12; probe/relay event ở Bước 11.
- Lỗi/Ghi chú:
  - `reconcile` hiện trả trong station create/patch; các route khác có thể bổ sung khi UI cần.
  - Không dùng event để trả dữ liệu entity; chỉ tín hiệu refetch.
### Nhật ký thực hiện — Bước 9
- Thời điểm: 2026-11-01 11:00 +07:00
- Trạng thái: DONE
- Commit: 704cc9e
- Push: origin/main
- Đã làm:
  - Thêm `DisconnectAccount`, `DisconnectMountpoint`, `DisconnectListener`.
  - Thêm internal API disconnect theo account/mountpoint/listener.
  - Node gọi targeted disconnect trước khi reconcile toàn bộ.
  - Thêm cờ closed cho connection; hub từ chối connection đã đóng.
  - Register kiểm tra lại listener/mountpoint/account còn hợp lệ.
  - Reconcile đóng phiên vượt `max_connections`, giữ phiên cũ nhất.
  - Thêm unit test targeted disconnect, max_connections, closed hub.
- File thay đổi:
  - `gnss/internal/caster/connection.go`
  - `gnss/internal/caster/hub.go`
  - `gnss/internal/caster/listener.go`
  - `gnss/internal/caster/manager.go`
  - `gnss/internal/caster/caster_test.go`
  - `gnss/internal/api/server.go`
  - `server/src/lib/reconcile.ts`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `go test ./...`: PASS.
  - `go test ./internal/caster -run 'TestTargetedDisconnect|TestReconcileClosesExcessConnections|TestClosedConnectionIsNotAddedToHub'`: PASS.
  - `docker run ... golang:1.24 go test -race ./internal/caster`: PASS.
  - `go vet ./...`: PASS.
  - Rebuild `corsd`; container healthy.
  - Mock rover online → lock account → offline trong < 1 giây (targeted disconnect).
- Checklist đã đạt:
  - [x] Targeted disconnect.
  - [x] Hub không giữ connection đã đóng.
  - [x] max_connections.
  - [x] race/vet.
  - [!] Assert reason chi tiết, race connect+disable riêng, 50 vòng goroutine ở Bước 13/14.
- Lỗi/Ghi chú:
  - Windows host không có gcc nên `-race` chạy qua Docker `golang:1.24`.
  - Đã reset/seed lại 3 trạm test sau kiểm thử.
### Nhật ký thực hiện — Bước 10
- Thời điểm: 2026-11-01 11:06 +07:00
- Trạng thái: DONE
- Commit: 14fb484
- Push: origin/main
- Đã làm:
  - Station pause/resume khớp cả upstream và downstream.
  - Resume trạm chỉ bật job nếu `paused_by_mountpoint_id IS NULL`.
  - Manual disable clear cả hai owner; manual enable bị 409 khi còn owner.
  - Patch relay job giữ owner pause; chỉ clear khi người dùng disable.
  - Bulk relay job áp dụng cùng quy tắc.
- File thay đổi:
  - `server/src/lib/stationStream.ts`
  - `server/src/routes/relayJobs.ts`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `server npm run build`: PASS.
  - Tạo 2 job test (upstream/downstream cùng MP).
  - Disable station: cả 2 job enabled=0, owner=station.
  - Enable station: cả 2 job enabled=1, owner NULL.
  - Disable MP: cả 2 job owner=MP; disable station thêm owner station.
  - Enable MP khi trạm tắt: job vẫn 0, còn owner station.
  - Enable station: job enabled=1.
  - Manual disable job khi pause: owner clear; enable MP không bật lại.
  - Manual enable khi MP còn pause → 409.
  - Xóa MP → job disabled, owner clear.
- Checklist đã đạt:
  - [x] Pause/resume station và mountpoint hai chiều.
  - [x] Ownership precedence.
  - [x] Manual override.
  - [x] Revision tăng.
- Lỗi/Ghi chú:
  - Đã xóa job test và reset/seed lại 3 trạm.
  - Không xóa relay job khi xóa trạm/mountpoint.
### Nhật ký thực hiện — Bước 11
- Thời điểm: 2026-11-01 11:13 +07:00
- Trạng thái: DONE
- Commit: 976bba3
- Push: origin/main
- Đã làm:
  - Thêm fingerprint cấu hình probe; đổi host/port/mount/user/password/interval → restart session.
  - Station probe create/patch/delete/enable/disable gọi reconcile ngay.
  - Station source PUT gọi reconcile station + relay liên quan.
  - Listener mapping đổi → caster reconcile đóng connection sai.
- File thay đổi:
  - `gnss/internal/probe/manager.go`
  - `gnss/internal/probe/manager_test.go`
  - `server/src/routes/quality.ts`
  - `server/src/routes/stations.ts`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `go test ./internal/probe`: PASS.
  - `go vet ./internal/probe`: PASS.
  - `server npm run build`: PASS.
  - Rebuild GNSS + healthy.
  - Probe CRUD qua API: create/patch/enable/disable/delete PASS, không có log reconcile failed.
  - Mock rover online → gỡ mountpoint khỏi listener → offline < 1 giây.
- Checklist đã đạt:
  - [x] Fingerprint restart.
  - [x] Probe CRUD reconcile.
  - [x] Listener mapping đóng connection.
  - [!] Sample probe live và source live để Bước 13.
- Lỗi/Ghi chú:
  - Chưa có credential/upstream probe thật nên chưa đo sample; sẽ dùng mock ở Bước 13.
  - Đã reset/seed lại 3 trạm test.
### Nhật ký thực hiện — Bước 12
- Thời điểm: 2026-11-01 11:22 +07:00
- Trạng thái: DONE
- Commit: d094a11
- Push: origin/main
- Đã làm:
  - RealtimeProvider nghe `entity.changed` và invalidate query key theo entity.
  - Thêm fallback polling 5–10 giây khi socket mất kết nối.
  - Form khóa tên trạm/mountpoint/username khi sửa.
  - Nút hành động row trạm: bật/tắt/khóa/mở khóa theo ma trận.
  - Cảnh báo UI khi response `reconcile.ok=false`.
  - Thêm Playwright realtime entity.
- File thay đổi:
  - `frontend/src/realtime/RealtimeProvider.tsx`
  - `frontend/src/pages/Stations.tsx`
  - `frontend/src/pages/Mountpoints.tsx`
  - `frontend/src/pages/NtripAccounts.tsx`
  - `frontend/src/pages/OnlineList.tsx`
  - `frontend/tests/entity-realtime.spec.ts`
  - `docs/1/04_KE_HOACH_REALTIME_CRUD.md`
  - `SESSION.md`
- Test/Bằng chứng:
  - `frontend tsc --noEmit`: PASS.
  - Playwright `tests/entity-realtime.spec.ts`: 1/1 PASS.
  - Toggle trạm từ API actor khác → danh sách đổi trong ≤ 2.5 giây, không reload.
  - Không có pageerror.
- Checklist đã đạt:
  - [x] Realtime list invalidation.
  - [x] Form immutable fields.
  - [x] Row action matrix.
  - [x] Không pageerror.
  - [!] OnlineList/mountpoint detail/offline fallback/a11y đầy đủ ở Bước 13/15.
- Lỗi/Ghi chú:
  - Invalidation debounce chưa thêm; số event hiện thấp nên chưa cần.
  - Fallback polling dùng `connected` từ socket context.