# Kế hoạch 18 — Sửa 5 yêu cầu vận hành: chọn trạm, port, listener công ty, ACL “Tất cả” động, auto-map mountpoint

- Ngày lập: 2026-11-07
- Trạng thái: READY — chờ bắt đầu triển khai (chưa sửa code)
- Phạm vi: relay chọn trạm, form port, RBAC listener, tài khoản NTRIP
  (listener/mountpoint ACL động), gán mountpoint vào listener, migration admin,
  Go caster/relay, UI React.
- Nguyên tắc: mock-first; không chạy relay thật; không chạm
  `relayrtcm/backup`; không chiếm `8081`/`2101` của relay cũ; không commit
  secret; test trước khi tuyên bố PASS.
- Thay thế: mục 2.1 của `docs/1/12_KE_HOACH_RELAY_CHON_TRAM.md`
  (nhánh `ntrip_client` dùng endpoint ngoài) bị thay thế bởi YC0 trong kế
  hoạch này.

## 1. Mục tiêu

1. **YC0 (ưu tiên cao nhất)** — Khi người dùng chọn “Chọn trạm”, relay phải
   lấy dữ liệu của trạm **trên hệ thống hiện tại**, không mở kết nối NTRIP
   client tới hệ thống ngoài.
2. **YC1** — Không tự điền sẵn port trong bất kỳ form nào.
3. **YC2** — Công ty (role `admin`) được xem và sửa listener; không được xóa,
   không được đổi port, không được đổi công ty. `user` chỉ xem.
4. **YC3** — Form tạo tài khoản NTRIP có đủ 2 trường **Listener** và
   **Mountpoint**, đều là multiselect có tìm kiếm, bắt buộc ít nhất 1 lựa chọn,
   mặc định chọn “Tất cả” (động).
5. **YC4** — Mountpoint tạo bằng bất kỳ đường nào đều tự động gán vào các
   listener hiện có của công ty tương ứng.

## 2. Quyết định đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| D18-1 | Station source chết → relay **báo lỗi**, không fallback ra hệ thống ngoài | Không tự mở kết nối NTRIP client khác |
| D18-2 | Chỉ `admin` công ty được sửa listener; `user` chỉ xem | `caster.edit=tenant` cho `admin`, `none` cho `user` |
| D18-3 | Công ty không được đổi `port` và `company_id` của listener | Chặn ở server, không chỉ ẩn UI |
| D18-4 | Công ty được đổi tên, vai trò, mô tả, mountpoint, bật/tắt listener | `role`, `name`, `description`, `enabled`, `mountpointIds` |
| D18-5 | Chỉ `admin` công ty được gắn mountpoint của người khác trong cùng công ty vào listener | `user` không được |
| D18-6 | Listener và Mountpoint trong tài khoản NTRIP là **multiselect bắt buộc**, ít nhất 1 lựa chọn | Không cho rỗng |
| D18-7 | Mặc định cả 2 trường là “Tất cả” động | Đúng nghĩa: mọi listener/mountpoint hiện có, tự cập nhật khi thêm/bớt |
| D18-8 | “Xem” diễn ra qua **sourcetable công khai** | Chỉ ACL **kết nối** mới phân biệt tài khoản |
| D18-9 | Không backfill mountpoint cho listener tạo mới | Listener mới rỗng; super admin gắn tay hoặc chọn mountpoint khi tạo |
| D18-10 | Mountpoint có `company_id = NULL` (toàn cục) **có** auto-map | Gắn vào toàn bộ listener hiện có |
| D18-11 | “Chọn trạm” ở phía nguồn **bỏ qua khái niệm mountpoint** | Lấy nguồn gốc của trạm: station source (ntrip_client) hoặc source đang publish vào caster (ntrip_caster) |
| D18-12 | Phía đích vẫn cần mountpoint đích | Hệ thống tự chọn nếu trạm chỉ có 1 mountpoint; nhiều mountpoint thì yêu cầu chọn |

## 3. Hiện trạng và nguyên nhân gốc

### 3.1 YC0 — Relay đang lấy dữ liệu từ hệ thống ngoài

Chuỗi lỗi đã xác minh:

1. `server/src/lib/relayStation.ts`
   - `isClientSource()` (L156) nhận diện trạm `ntrip_client`.
   - `clientEndpoint()` (L141) trả `client_host/client_port/client_mount`.
   - `resolveStationEndpoint()` (L213) tại L246 đặt
     `fromClientSource = direction === 'source' && isClientSource(row)`.
   - L248–257 chọn endpoint ngoài; L317 trả `mountpointId: null`.
2. `gnss/internal/relay/store.go` L172–174:
   `UpstreamDirect = stationID > 0 && mountpointID > 0 && role == "ntrip_caster"`.
   Vì `mountpointId = null`, Go không dùng tap mà mở NTRIP client ra ngoài.
3. `gnss/internal/relay/station_source.go`
   - Query L116–129 chọn `MIN(m.id)` — chỉ một mountpoint nhận byte.
   - Feed L345–357 chỉ đẩy vào quality analyzer, không vào caster hub.
4. `gnss/internal/caster/manager.go`
   - `Reconcile` L205–217 tạo hub **toàn cục theo mountpointID**.
   - `OpenStationTap(mountpointID)` L810–823 chỉ đọc hub của mountpoint.
5. `gnss/internal/caster/hub.go`
   - `publishFrom` L172–209 chỉ nhận byte khi `h.source == source`; feed
     monitor + quality rồi fan-out rover/tap.
6. `gnss/cmd/corsd/main.go` L122–134: `options.StationTap =
   casterManager.OpenStationTap`; station source manager chưa nối vào hub.

Hệ quả prod đã ghi nhận: relay 518 đọc `rtktk.online:1511/CTO_OMON` thay vì
dùng luồng trạm `CTO_OMon` id 709 đang có dữ liệu trong hệ thống.

### 3.2 YC1 — Port đang được điền sẵn

| Tầng | Vị trí | Giá trị |
|---|---|---|
| FE | `frontend/src/pages/RelayJobs.tsx` L58, L70 | `1509` |
| FE | `frontend/src/pages/Stations.tsx` L48, L57 | `1509` |
| FE | `frontend/src/pages/Caster.tsx` L49 | `2101` |
| BE | `server/src/routes/stations.ts` L129, L2561 | `.default(1509)` |
| BE | `server/src/routes/stations.ts` L981, L2582 | fallback `1509` |
| BE | `server/src/routes/relayJobs.ts` L58 | `.default(1509)` |
| DB | `db/migrations/admin/007_port_defaults.sql` | `stations.port`, `relay_jobs.upstream_port/downstream_port` |
| DB | `db/migrations/admin/001_init.sql` L84, `004_caster.sql` L33 | port mặc định |

### 3.3 YC2 — Công ty chưa được sửa listener

- `db/migrations/admin/031_rbac_company_scope.sql` L25: `caster.%` của
  `admin` = `none`.
- `db/migrations/admin/041_caster_view_company.sql`: chỉ nâng
  `caster.view` = `tenant` cho `admin`/`user`.
- `server/src/routes/caster.ts` L324 (`caster.edit`), L493 (`caster.delete`).
- `writableMountpointIds()` L178–192 dùng scope cá nhân: `own` chỉ cho
  mountpoint do chính user tạo → công ty không gắn được mountpoint của
  người khác.
- Go: `needsRestart` (`listener.go` L246–250) và `isInvalidLocked`
  (`manager.go` L328–350) đóng connection khi đổi port/role/tắt listener hoặc
  gỡ mountpoint khỏi listener.

### 3.4 YC3 — Thiếu trường và thiếu mô hình “Tất cả” động

- `server/src/routes/ntripAccounts.ts` L50–51 đã nhận `listenerIds`,
  `mountpointIds`; nhưng `effectiveMountpoints()` L97–120 chỉ giao ACL tĩnh,
  không có “all”.
- `frontend/src/pages/NtripAccounts.tsx` form tạo/sửa chưa có 2 trường;
  ACL chỉ sửa trong drawer chi tiết.
- `SearchableMultiSelect` (`frontend/src/components/ui.tsx` L357) là list
  checkbox inline, chưa phải combobox có ô tìm kiếm bên trong.
- Go `authorize()` (`gnss/internal/caster/listener.go` L309–335):
  - L329 `!account.ACL[mountpoint.ID]` → 403.
  - L332 `ListenerACL` rỗng = mọi listener (chỉ còn chặn company ở L324).
  - Chưa có khái niệm “all mountpoints”.
- Sourcetable công khai (`listener.go` L82, L287–306): trả mọi mountpoint
  `enabled` của listener, không lọc theo tài khoản.

### 3.5 YC4 — Nhiều đường tạo mountpoint không gán listener

| Đường | File | Hiện tại |
|---|---|---|
| Tạo trạm sinh mountpoint | `server/src/lib/stationResources.ts` L57–73, L75–114 | Chỉ map khi `ntrip_caster` + listener được chọn; `ntrip_client` không map |
| Tạo mountpoint trực tiếp | `server/src/routes/mountpoints.ts` L630–648 | Không insert `caster_listener_mountpoints` |
| Import V2 | `server/src/db/importLegacyV2.ts` L487–515 | Chỉ map theo port import |
| Import caster cũ | `server/src/db/importLegacyCaster.ts` L266–274 | Chỉ map theo `caster_ports` |
| Tạo listener | `server/src/routes/caster.ts` L277–300 | Map mountpoint được chọn (đúng, không backfill) |
| Sửa source trạm | `server/src/routes/stations.ts` L2622–2733 | Đổi `caster_listener_id` nhưng không map lại mountpoint |
| Đổi company mountpoint | `server/src/routes/mountpoints.ts` PATCH | Chưa remap listener |

## 4. Kiến trúc đích cho YC0

### 4.1 Luồng dữ liệu

```text
ntrip_client station
  StationSourceManager (1 kết nối upstream/trạm)
    ├── quality analyzer (ingest)                 [giữ nguyên]
    ├── station-level tap ──► relay (chọn trạm)   [mới]
    └── caster hub external publish ──► rover/tap [mới, để mountpoint không chết]

ntrip_caster station
  caster hub (source do thiết bị publish)
    └── station-level tap ──► relay (chọn trạm)   [mở rộng từ mountpoint tap]
```

### 4.2 Nguyên tắc “Chọn trạm”

- Mode `Chọn trạm` ở phía **nguồn**:
  - Không dùng `client_host/client_mount` để mở kết nối mới.
  - Không phụ thuộc mountpoint người dùng chọn; server chỉ lưu
    `upstream_station_id`.
  - `ntrip_client`: tap trực tiếp session `StationSourceManager` theo
    `stationID`.
  - `ntrip_caster`: tap source đang publish của trạm; nếu trạm có nhiều
    mountpoint có source, chọn mountpoint ID nhỏ nhất đang có source và ghi
    log cảnh báo; nếu không có source → lỗi `station_source_offline`.
- Mode `Nhập thủ công`: giữ nguyên hành vi hiện tại.
- Phía **đích** `Chọn trạm`: vẫn cần mountpoint đích; nếu trạm chỉ có 1
  mountpoint enabled thì tự chọn, nếu nhiều thì yêu cầu chọn (D18-12).

## 5. Thiết kế chi tiết theo yêu cầu

### 5.1 YC0 — Relay dùng nguồn nội bộ

#### 5.1.1 Go — station-level tap

- Thêm interface trong relay options:
  `StationTap(stationID int64) (io.ReadCloser, error)`.
  Giữ `MountpointTap` cũ nếu còn dùng cho trường hợp khác.
- `StationSourceManager`:
  - Quản lý danh sách tap theo `stationID` (nhiều relay job cùng trạm).
  - Mỗi tap có queue giới hạn; đầy thì đóng tap (`slow_tap`), không chặn
    session chính.
  - Khi session station source kết thúc: đóng toàn bộ tap của trạm → relay
    nhận EOF và báo lỗi (D18-1).
  - Khi session reconnect: relay job tự mở tap lại theo cơ chế reconnect
    hiện có.
- `caster.Manager`:
  - Thêm `OpenStationSourceTap(stationID int64) (io.ReadCloser, error)`:
    duyệt các hub của trạm, chọn hub đang có source, theo thứ tự mountpoint
    ID tăng dần.
  - Không đổi `OpenStationTap(mountpointID)` để tương thích.
- `relay/store.go`:
  - `UpstreamDirect = upstreamStationID > 0` (bỏ điều kiện mountpoint và
    role).
  - `upstream_mountpoint_id` được phép NULL với mode chọn trạm.
- `relay/manager.go`: khi `UpstreamDirect`, gọi `options.StationTap(
  job.UpstreamStationID)` thay vì mở NTRIP client.
- `cmd/corsd/main.go`: nối thêm sink station source → caster hub
  (`casterManager.PublishStationSource` hoặc tương đương).

#### 5.1.2 Go — bridge station source vào caster hub

- Thêm API external publish trên hub:
  - Đăng ký token nguồn theo `stationID`.
  - Chỉ byte của token hiện hành được publish (single-writer).
  - Khi session dừng: hub chuyển “no source”, đóng tap, rover nhận mất nguồn.
- Publish vào **tất cả mountpoint enabled của trạm** để rover ở bất kỳ
  listener nào cũng nhận dữ liệu.
- **Không feed quality/monitor lần hai** trong nhánh external publish:
  `StationSourceManager` tiếp tục là nơi duy nhất feed quality ingest.
- Backpressure: dùng queue giới hạn; rover chậm bị đóng (`slow_client`),
  không block station source.

#### 5.1.3 Node — resolve endpoint

- `resolveStationEndpoint(scope, stationId, mountpointId, 'source')`:
  - Bỏ nhánh `fromClientSource`.
  - Trả `{ stationId, mountpointId: null, direct: true }`.
  - Endpoint host/port chỉ để hiển thị; không dùng để kết nối.
- `station-options`:
  - Với phía nguồn, không bắt buộc mountpoint.
  - Với phía đích, vẫn trả danh sách mountpoint.
- `createSchema`/`updateSchema` relay:
  - `upstreamMountpointId` bị bỏ qua (hoặc từ chối) khi
    `upstreamMode = 'station'`.
  - `downstreamMountpointId` vẫn cần khi `downstreamMode = 'station'`.

#### 5.1.4 Trạng thái và lỗi

- `station_offline`: trạm tắt/locked/không có `station_sources`.
- `station_source_offline`: session station source không chạy.
- `station_source_idle`: idle timeout.
- `station_source_ambiguous`: trạm `ntrip_caster` có nhiều source và không
  xác định được (nếu chọn chế độ báo lỗi thay vì chọn ID nhỏ nhất).
- `tap_closed` / `slow_tap`: tap bị đóng do backpressure.
- Không auto-disable job/probe.

#### 5.1.5 Edge cases

- Trạm `ntrip_client` có nhiều mountpoint: station source publish vào tất cả
  mountpoint enabled (5.1.2); relay vẫn tap theo station, không theo
  mountpoint.
- Nhiều relay job cùng một trạm: dùng chung 1 session upstream, nhiều tap.
- Station source reconnect: tap cũ đóng, relay reconnect; không fallback.
- Trạm bị tắt trong lúc relay chạy: đóng tap, job báo lỗi.
- Loop guard và chặn chọn trạm cả 2 phía giữ nguyên như Kế hoạch 12.

### 5.2 YC1 — Bỏ prefill port

#### 5.2.1 Frontend

- `RelayJobs.tsx`: `upstreamPort`, `downstreamPort` khởi tạo `''`.
- `Stations.tsx`: `port`, `client_port` khởi tạo `''`.
- `Caster.tsx`: `port` khởi tạo `''`.
- Khi mode `Chọn trạm`: hiển thị port dẫn xuất read-only (không phải prefill).
- Khi mode `Nhập thủ công`: port bắt buộc, placeholder “Nhập port”, validate
  1–65535.

#### 5.2.2 Backend

- Bỏ `.default(1509)` ở `stations.ts` L129/L2561 và `relayJobs.ts` L58.
- Schema yêu cầu `port` khi mode thủ công; với mode chọn trạm, cho phép
  `port = 0` (sentinel nội bộ) hoặc port dẫn xuất.
- Giữ fallback `?? 1509` ở các chỗ **đọc dữ liệu cũ** (import/public) để
  tương thích, nhưng không dùng cho form.

#### 5.2.3 DB

- Migration mới: bỏ `DEFAULT 1509` của `stations.port`,
  `relay_jobs.upstream_port`, `relay_jobs.downstream_port`.
- Cột đang `NOT NULL`: giữ `NOT NULL`, yêu cầu application luôn gửi giá trị.
- Không đổi dữ liệu cũ.

### 5.3 YC2 — Công ty được sửa listener

#### 5.3.1 RBAC

| Role | `caster.view` | `caster.add` | `caster.edit` | `caster.delete` |
|---|---|---|---|---|
| `super_admin` | all | all | all | all |
| `admin` | tenant | none | **tenant** | none |
| `user` | tenant | none | **none** | none |

Migration mới:
- `admin`: `caster.edit = 'tenant'`.
- `user`: giữ `caster.view = 'tenant'`, `caster.edit = 'none'`,
  `caster.delete = 'none'`.
- `caster.add = 'none'` cho cả `admin`/`user`.

#### 5.3.2 Server — bất biến

`PATCH /api/caster/listeners/:id`:
- Non-super:
  - `port` khác port hiện tại → `400 IMMUTABLE_FIELD`.
  - `company_id` khác company hiện tại → `400 COMPANY_IMMUTABLE`
    (kể cả trường hợp `company_id = null`).
- Được phép: `name`, `role`, `description`, `enabled`, `mountpointIds`.
- `assertRecordScope` giữ nguyên; company luôn lấy từ listener hiện tại.

`PUT /api/caster/listeners/:id/mountpoints`:
- Chỉ `admin` công ty (qua `caster.edit = tenant`).
- Mountpoint phải cùng company với listener (`assertMountpointsSameCompany`).
- Với non-super, dùng **company scope của listener**, không dùng
  `writableMountpointIds()` cá nhân (D18-5).
- `user` không có quyền gọi route này.

`DELETE /api/caster/listeners/:id`:
- `admin`/`user` không có `caster.delete` → 403; giữ nguyên.

#### 5.3.3 UI

- `/caster`:
  - `admin`: hiện nút Sửa; ẩn nút Tạo/Xóa.
  - Dialog sửa: `port` và `company` read-only; cho sửa tên/role/mô tả/
    mountpoint/bật-tắt.
  - Tắt listener: dialog xác nhận cảnh báo sẽ ngắt client đang kết nối.
- `user`: chỉ xem.

#### 5.3.4 Audit

- Ghi audit `update` và `update_mountpoints` như hiện tại.
- Ghi audit khi từ chối đổi port/company (tối thiểu log server).

### 5.4 YC3 — Listener/Mountpoint “Tất cả” động

#### 5.4.1 Mô hình dữ liệu

Thêm vào `ntrip_accounts`:

```sql
listener_all   TINYINT(1) NOT NULL DEFAULT 0
mountpoint_all TINYINT(1) NOT NULL DEFAULT 0
```

Quy ước:
- `listener_all = 1`: tài khoản áp dụng cho **mọi listener hiện có của công
  ty** tại thời điểm xác thực; bỏ qua `account_listener_acl`.
- `listener_all = 0`: chỉ các listener trong `account_listener_acl`; bắt buộc
  có ít nhất 1 dòng.
- `mountpoint_all = 1`: được kết nối mọi mountpoint hiện thuộc listener được
  phép; bỏ qua `account_mountpoint_acl`.
- `mountpoint_all = 0`: chỉ các mountpoint trong `account_mountpoint_acl`;
  bắt buộc có ít nhất 1 dòng.

Bảng ngữ nghĩa:

| `listener_all` | `mountpoint_all` | Quyền kết nối |
|---|---|---|
| 1 | 1 | Mọi mountpoint của mọi listener công ty, động |
| 1 | 0 | Các mountpoint trong ACL tĩnh (thuộc công ty) |
| 0 | 1 | Mọi mountpoint hiện thuộc các listener đã chọn, động |
| 0 | 0 | Giao ACL tĩnh ∩ listener đã chọn |

Backfill:
- Tài khoản cũ có ít nhất 1 dòng `account_listener_acl` → `listener_all = 0`.
- Tài khoản cũ không có dòng nào → `listener_all = 1` (giữ hành vi caster
  hiện tại: ACL rỗng = mọi listener).
- Tất cả tài khoản cũ → `mountpoint_all = 0` (giữ hành vi deny hiện tại).

#### 5.4.2 Go caster

- `AccountConfig` thêm `ListenerAll`, `MountpointAll` (`types.go` L36–45).
- `store.go` select thêm 2 cột khi load account.
- `authorize()` (`listener.go` L309–335):
  - Company check giữ nguyên (L324).
  - `if !account.ListenerAll && !account.ListenerACL[listener.ID] → 403`.
  - `if !account.MountpointAll && !account.ACL[mountpoint.ID] → 403`.
  - `mountpoint` luôn là mountpoint thuộc `listener.Mountpoints` (đã có ở
    `manager.go` L349).
- Không cần query DB mỗi lần auth: mapping đã nằm trong config sau reconcile.

#### 5.4.3 Thu hồi/cấp quyền tức thời

- Gỡ mountpoint khỏi listener → `LoadConfig` mới → `isInvalidLocked` đóng
  connection hiện có (`manager.go` L328–350).
- Thêm mountpoint → sourcetable và authorize cập nhật sau reconcile.
- Đổi ACL tài khoản → `reconcileAffected({ accountIds })` gọi
  `/internal/caster/disconnect-account` (`reconcile.ts` L41–48).
- Độ trễ = thời gian reconcile, không phải tức thời tuyệt đối; ghi rõ trong
  test và tài liệu.

#### 5.4.4 API

- `createSchema`/`updateSchema` (`ntripAccounts.ts` L34–54) thêm:
  - `listener_all: boolean`
  - `mountpoint_all: boolean`
- Validate:
  - `listener_all = false` → `listenerIds` phải có ≥ 1.
  - `mountpoint_all = false` → `mountpointIds` phải có ≥ 1.
  - `listener_all = true` → bỏ qua/không lưu `listenerIds`.
  - `mountpoint_all = true` → bỏ qua/không lưu `mountpointIds`.
  - Không cho cả 2 trường rỗng (D18-6).
- `assertScopedIds` giữ nguyên; bổ sung kiểm tra:
  - Chỉ role có scope `ntrip_accounts` = `tenant`/`all` mới được đặt
    `listener_all = 1` hoặc `mountpoint_all = 1`.
  - `user` (scope `own`) không được đặt “Tất cả”.
- `effectiveMountpoints()`:
  - `mountpoint_all = 1` → trả toàn bộ mountpoint của các listener được phép.
  - `mountpoint_all = 0` → như hiện tại.
- `publicAccount` trả thêm 2 cờ để form sửa hiển thị đúng.

#### 5.4.5 UI

- Form tạo/sửa `NtripAccounts.tsx`:
  - Thêm `Listener` (multiselect, bắt buộc, mặc định “Tất cả”).
  - Thêm `Mountpoint` (multiselect, bắt buộc, mặc định “Tất cả”).
  - Khi Listener = “Tất cả” → mountpoint options = toàn bộ mountpoint công
    ty; khi chọn listener cụ thể → union mountpoint của các listener đó.
  - Khi Mountpoint = “Tất cả” → disable chọn lẻ.
  - Validate client-side: ít nhất 1 lựa chọn ở mỗi trường.
- Nâng `SearchableMultiSelect` (`ui.tsx` L357) thành combobox:
  - Input tìm kiếm nằm trong dropdown.
  - Chip cho item đã chọn.
  - Hỗ trợ option đặc biệt “Tất cả”.
  - Keyboard/a11y: mở/đóng, Esc, focus trap, aria.
- `user` chỉ thấy option trong scope của mình; `admin` thấy toàn công ty.

#### 5.4.6 Sourcetable

- Giữ công khai (D18-8). Không lọc theo tài khoản.
- “Thấy 10 mountpoint” là hành vi tự nhiên của sourcetable; chỉ “kết nối 1”
  mới do ACL quyết định.
- Với “Tất cả listener”, tài khoản phải kết nối từng port listener để xem
  sourcetable tương ứng; không có sourcetable hợp nhất. Ghi vào tài liệu.

### 5.5 YC4 — Auto-map mountpoint vào listener

#### 5.5.1 Helper dùng chung

```sql
-- company cụ thể
INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id)
SELECT id, ? FROM caster_listeners WHERE company_id = ?;

-- company NULL (toàn cục, D18-10)
INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id)
SELECT id, ? FROM caster_listeners;
```

Đặt tại `server/src/lib/caster.ts` (hoặc file tương đương), nhận `conn` để
chạy trong transaction.

#### 5.5.2 Điểm gọi

- `server/src/lib/stationResources.ts` sau khi insert mountpoint (L57–73):
  gọi helper cho **mọi** `source_role`.
- `server/src/routes/mountpoints.ts` POST (L630–648): bọc transaction,
  insert + helper + reconcile sau commit.
- `server/src/db/importLegacyV2.ts` sau insert mountpoint (L487–502).
- `server/src/db/importLegacyCaster.ts` sau insert mountpoint (L232+).
- `server/src/routes/mountpoints.ts` PATCH khi `company_id` thay đổi:
  xóa mapping cũ, gọi helper company mới.
- `server/src/routes/stations.ts` PUT `/:id/sources`: khi đổi
  `caster_listener_id`, map mountpoint của trạm vào listener mới (tránh
  publish vào listener chưa có mapping).
- `server/src/routes/caster.ts` tạo listener: giữ nguyên map theo
  `mountpointIds` được chọn (D18-9, không backfill).

#### 5.5.3 Quy tắc

- Chỉ map listener cùng company; company NULL → toàn bộ listener.
- Map cả listener đang tắt (để khi bật lại có sẵn).
- Dùng `INSERT IGNORE` để chống trùng.
- Sau commit gọi `reconcileAfterMountpointChange()` /
  `requestCasterReconcile()`.
- Import: chạy thêm một pass “remap toàn bộ mountpoint → listener cùng
  company” ở cuối để xử lý thứ tự listener/mountpoint.
- Không backfill khi tạo listener mới (D18-9).

## 6. Migration và dữ liệu

| Migration | Nội dung |
|---|---|
| Admin mới 1 | `ntrip_accounts.listener_all`, `ntrip_accounts.mountpoint_all`; backfill theo 5.4.1 |
| Admin mới 2 | `admin.caster.edit = tenant`; giữ `user.caster.edit = none` |
| Admin mới 3 | Bỏ default port `stations.port`, `relay_jobs.upstream_port`, `relay_jobs.downstream_port` |
| Script (không migration) | Dry-run map mountpoint `company_id IS NULL` vào toàn bộ listener; `--apply` khi được duyệt |

Yêu cầu:
- Backup trước migration.
- Migration idempotent, có `schema_migrations` version tăng.
- Không sửa dữ liệu trạm/relay hiện có ngoài default port.

## 7. API thay đổi

| Endpoint | Thay đổi |
|---|---|
| `GET /api/relay-jobs/station-options` | Nguồn: không bắt buộc mountpoint; đích: vẫn trả mountpoint |
| `POST/PATCH /api/relay-jobs` | Mode station nguồn: bỏ `upstreamMountpointId`; trả `direct/stationId` |
| `PATCH /api/caster/listeners/:id` | Non-super: chặn `port`, `company_id`; cho `name/role/description/enabled` |
| `PUT /api/caster/listeners/:id/mountpoints` | Chỉ admin công ty; dùng company scope |
| `POST/PATCH /api/ntrip-accounts` | Thêm `listener_all`, `mountpoint_all`; validate ≥ 1 |
| `GET /api/ntrip-accounts/:id` | Trả thêm 2 cờ ACL |
| `GET /api/ntrip-accounts/:id/mountpoints` | Hỗ trợ “all” động |

## 8. UI thay đổi

- `RelayJobs.tsx`: port trống; mode chọn trạm phía nguồn chỉ chọn trạm,
  không chọn mountpoint; phía đích giữ mountpoint.
- `Stations.tsx`: port/client_port trống, bắt buộc khi nhập thủ công.
- `Caster.tsx`: port trống khi tạo; admin có nút Sửa, không có Tạo/Xóa;
  port/company read-only khi sửa.
- `NtripAccounts.tsx`: thêm 2 multiselect combobox, mặc định “Tất cả”,
  validate ≥ 1.
- `components/ui.tsx`: nâng `SearchableMultiSelect` thành combobox có search
  trong dropdown.
- A11y: focus trap, Esc, aria, reduced-motion; không hardcode màu light.

## 9. Phân quyền

| Hành động | super_admin | admin công ty | user |
|---|---|---|---|
| Xem listener | all | tenant | tenant |
| Tạo listener | có | không | không |
| Sửa listener | all | tenant (trừ port/company) | không |
| Xóa listener | có | không | không |
| Gắn mountpoint vào listener | all | tenant, cùng company | không |
| Tạo tài khoản NTRIP | all | tenant | own (nếu được cấp) |
| Đặt ACL “Tất cả” | có | có | không |
| Xem sourcetable | công khai | công khai | công khai |

## 10. Test plan

### 10.1 Go

- `Store`: load `listener_all`/`mountpoint_all`.
- `authorize`:
  - all/all → mọi mountpoint công ty.
  - all/selected → chỉ ACL.
  - selected/all → mọi mountpoint của listener đã chọn.
  - selected/selected → giao.
  - khác company → 403.
  - listener bị gỡ mountpoint → 403.
- Station source tap:
  - 1 upstream, nhiều tap nhận cùng byte.
  - session chết → tap EOF.
  - tap chậm → đóng tap, không block session.
  - reconnect → tap mới nhận byte mới.
- Caster station tap theo `stationID`: chọn đúng hub đang có source.
- External publish vào hub: rover nhận byte; quality không bị đếm đôi.
- Relay direct với `ntrip_client`: không gọi `client_host`.

### 10.2 Node server

- `resolveStationEndpoint('source', ntrip_client)` trả `direct`, không trả
  credential ngoài.
- `upstreamMountpointId` bị bỏ qua ở mode station.
- Auto-map:
  - trạm `ntrip_caster`/`ntrip_client` tạo mountpoint → map đủ listener công
    ty.
  - mountpoint POST → map.
  - import → map.
  - company NULL → map toàn bộ listener.
  - đổi company → remap.
- RBAC:
  - admin sửa listener OK; đổi port/company → 400.
  - user sửa listener → 403.
  - user gắn mountpoint → 403.
- NTRIP account:
  - thiếu cả 2 trường → 400.
  - `listener_all=1`/`mountpoint_all=1` lưu đúng.
  - `user` đặt all → 403.
  - `effectiveMountpoints` trả đúng động.
- Port:
  - thiếu port ở mode thủ công → 400.
  - mode station không cần port.

### 10.3 Frontend / Playwright

- Form relay: port trống; chọn trạm nguồn không hiện mountpoint.
- Form station/caster: port trống.
- `/caster` admin: sửa được, không xóa, port/company read-only.
- `/caster` user: chỉ xem.
- `/ntrip-accounts`: 2 combobox có search; mặc định “Tất cả”; không cho
  submit khi bỏ hết; chip đã chọn.
- 390/768/1440 không tràn; a11y focus/Esc.
- Sourcetable: thấy đủ mountpoint; kết nối chỉ ACL.

### 10.4 Gate

- `cd server && npm test` + `tsc`.
- `cd gnss && go test ./... && go vet ./...`.
- `cd frontend && npm run build` + Playwright.
- `npm run migrate` trên DB dev.
- `node scripts/build-guide.mjs --check` nếu có đổi tài liệu hướng dẫn.
- `graphify update .` sau khi xong.

## 11. Phân pha thực hiện

### P18-1 — YC0 + YC4 (bắt buộc đi cùng)

- Go: station-level tap, external publish vào hub, `UpstreamDirect` theo
  station, wire `main.go`.
- Node: bỏ nhánh `fromClientSource`; auto-map helper + tất cả điểm gọi.
- Test: Go tap/fan-out/EOF; Node resolve/auto-map.
- Lý do đi cùng: map mountpoint `ntrip_client` mà chưa bridge hub sẽ tạo
  mountpoint “chết” trên sourcetable.

### P18-2 — YC2

- Migration `caster.edit = tenant` cho `admin`.
- Chặn port/company; đổi quyền gắn mountpoint sang company scope.
- UI `/caster`.
- Test RBAC.

### P18-3 — YC3 backend

- Migration `listener_all`/`mountpoint_all` + backfill.
- Go `AccountConfig`/`authorize`.
- API schema + validate + `effectiveMountpoints`.
- Test Go/Node.

### P18-4 — YC3 frontend

- Combobox `SearchableMultiSelect`.
- Form NTRIP account 2 trường mặc định “Tất cả”.
- Playwright.

### P18-5 — YC1

- Bỏ prefill FE; bỏ default BE/DB; migration port.
- Test form + import cũ.

### P18-6 — Tổng kiểm tra và tài liệu

- Chạy toàn bộ gate.
- Cập nhật tài liệu, SESSION.md, TASKS.md.
- `graphify update .`.

## 12. Checklist nghiệm thu

- [ ] Chọn trạm nguồn `ntrip_client` không tạo kết nối ra hệ thống ngoài.
- [ ] Relay nhận byte từ station source nội bộ; source chết → lỗi, không
      fallback.
- [ ] Mountpoint `ntrip_client` được map listener và rover nhận dữ liệu qua
      caster hub.
- [ ] Không double-feed quality.
- [ ] Form không còn prefill 1509/2101; port bắt buộc khi nhập thủ công.
- [ ] Admin công ty sửa listener được; không đổi port/company; không xóa.
- [ ] User chỉ xem listener.
- [ ] User không gắn được mountpoint của người khác.
- [ ] Form NTRIP account có 2 multiselect bắt buộc, mặc định “Tất cả”.
- [ ] “Tất cả mountpoint” động: thêm/bớt mountpoint listener → quyền đổi ngay
      sau reconcile.
- [ ] `mountpoint_all` chỉ admin công ty đặt được.
- [ ] Mountpoint tạo từ mọi đường đều map listener cùng company.
- [ ] Mountpoint company NULL map toàn bộ listener (theo D18-10).
- [ ] Listener mới không tự backfill mountpoint (D18-9).
- [ ] Sourcetable công khai vẫn trả đủ mountpoint enabled.
- [ ] Server test, Go test/vet, frontend build, Playwright PASS.
- [ ] Không secret trong diff; không chạm `relayrtcm/backup`.

## 13. Rủi ro và rollback

- **Double-feed quality**: nếu external publish cũng feed quality, số liệu
  tăng gấp đôi. Bắt buộc chỉ một nơi feed.
- **Mountpoint chết**: YC4 map `ntrip_client` nhưng thiếu bridge hub →
  sourcetable quảng cáo nhưng không có dữ liệu. Vì vậy P18-1 gộp YC0+YC4.
- **Company NULL map toàn bộ listener**: mở rộng hiển thị/dữ liệu rất rộng.
  Chạy dry-run trước, đếm số mapping, backup.
- **Admin công ty có “Tất cả”**: admin có thể tạo tài khoản kết nối toàn bộ
  mountpoint công ty. Đây là quyết định D18-6/D18-7; cần audit khi bật.
- **Bỏ default port**: dữ liệu cũ vẫn đọc được; form/import phải validate để
  tránh insert 0/empty.
- **Station source reconnect**: đóng tap có thể làm relay downstream ngắt.
  Cần test backoff và ghi rõ hành vi.
- **Nhiều mountpoint/trạm**: chọn hub theo ID nhỏ nhất có thể không đúng
  nguồn mong muốn; cần log và tài liệu.
- **Reconcile latency**: quyền “tức thời” phụ thuộc thời gian reconcile;
  test với dữ liệu thật.
- Rollback: revert code theo phase; restore dump trước migration; không
  rollback bằng cách sửa tay dữ liệu production.

## 14. Tài liệu cần cập nhật

- `docs/1/12_KE_HOACH_RELAY_CHON_TRAM.md`: ghi rõ nhánh `ntrip_client` bị
  thay thế bởi Kế hoạch 18.
- `docs/2/PHAN_QUYEN.md`: ma trận quyền listener mới.
- `docs/api.md`: API `listener_all`/`mountpoint_all`, relay station mode.
- `docs-site/docs/07-relay.md`: hành vi “Chọn trạm” lấy nguồn nội bộ.
- `docs-site/docs/` phần caster/NTRIP account: mô tả “Tất cả” động.
- `SESSION.md`, `TASKS.md`: cập nhật sau mỗi phase.
- `AGENTS.md`: chỉ cập nhật nếu có quy tắc mới cần bền vững.

## 15. Điểm mở cần xác nhận khi bắt đầu code

1. Trạm `ntrip_caster` có nhiều mountpoint đang có source: chọn mountpoint
   ID nhỏ nhất hay báo lỗi `station_source_ambiguous`?
2. Mountpoint company NULL: áp dụng cho dữ liệu cũ bằng script `--apply`
   ngay trong phase hay chỉ dry-run trước?
3. Phía đích mode “Chọn trạm”: giữ selector mountpoint (D18-12) hay cũng
   muốn tự động hoàn toàn?
4. Tài khoản NTRIP cũ không có listener ACL: backfill `listener_all=1`
   (giữ hành vi hiện tại) — xác nhận không thay đổi quyền ngoài ý muốn.

## 16. Kết quả thực hiện

### P18-1 — YC0 + YC4 (2026-11-07)

Đã triển khai:

- **Go relay station source tap**
  - `Options.StationSourceTap` + `StationSourceManager.OpenTap(stationID)`.
  - Tap theo trạm, queue giới hạn 256; tap chậm bị gỡ (`slow_tap`) không chặn
    phiên nguồn.
  - Session nguồn kết thúc → đóng toàn bộ tap của trạm → relay nhận EOF và
    báo lỗi, không fallback.
  - `JobConfig.UpstreamDirect = upstreamStationID > 0`; upstream key
    `station://<id>`.
- **Go caster bridge**
  - `hub.attachExternal/publishExternal/detachExternal` single-writer theo
    `stationID`.
  - `manager.PublishStationSource/DetachStationSource` bridge byte vào mọi
    mountpoint enabled của trạm; không feed quality lần hai.
  - `OpenStationSourceTap(stationID)` chọn hub đang có source theo mountpoint
    ID tăng dần (D18-11).
- **Node resolve**
  - `resolveStationEndpoint(..., 'source')` bỏ nhánh `fromClientSource`, trả
    `direct: true`, `mountpointId: null`, không trả credential ngoài.
  - `station-options` phía nguồn chỉ hiển thị tóm tắt; không phụ thuộc
    mountpoint.
  - `relayJobs` dùng key `station://<id>` cho nguồn chọn trạm.
  - UI relay: bỏ select “Mountpoint nguồn”, luôn gửi `upstreamMountpointId:
    null` khi mode chọn trạm.
- **YC4 auto-map**
  - Helper `mapMountpointToCompanyListeners` và
    `remapAllMountpointsToCompanyListeners` trong `server/src/lib/caster.ts`.
  - Gọi khi tạo trạm/mountpoint, POST mountpoint (transaction), đổi company,
    đổi listener của trạm, và cuối 2 luồng import.
  - Company NULL map toàn bộ listener (D18-10); listener mới không backfill
    (D18-9).

Bằng chứng test:

- `cd gnss && go build ./...` PASS.
- `cd gnss && go test ./internal/relay ./internal/caster` PASS.
- `cd server && npx tsc --noEmit -p tsconfig.json` PASS.
- `cd server && npm test` → 42 file / 207 test PASS.
- `cd frontend && npm run build` PASS.
- `npx playwright test tests/relay-station-mode.spec.ts` PASS.
- `npx playwright test tests/p18-1-relay-source-internal.spec.ts` → 2 PASS:
  form nguồn chọn trạm không có mountpoint + lưu `upstreamMountpointId=null`;
  mountpoint tạo mới auto-map vào listener cùng công ty.

