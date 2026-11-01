# 06 — KẾ HOẠCH NÂNG CẤP TRANG BẢN ĐỒ

> Ngày lập: 2026-11-01
> Trạng thái: **KẾ HOẠCH — chưa sửa code**
> Phạm vi: trang `/map`, cấu hình nền bản đồ, tile proxy, dữ liệu toạ độ,
> marker, tìm kiếm, lọc và test.
> Không thay đổi kiến trúc RBAC/company hiện tại.
> Chuẩn phân quyền tham chiếu bắt buộc: `docs/2/PHAN_QUYEN.md`.

## 1. Kết luận rà soát hiện trạng

### 1.1. Hiện trạng

- Trang bản đồ chính: `frontend/src/pages/UnifiedMap.tsx`.
- Hai trang cũ `StationMap.tsx`, `OnlineMap.tsx` không còn route sử dụng
  (`/stations/map`, `/online/map` đã redirect về `/map`).
- API dữ liệu: `GET /api/map/overview` trong `server/src/routes/map.ts`.
- Tile nền hard-code OSM:

  ```ts
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
  ```

- Không có bảng/cấu hình `map_configs`, không có tile proxy, không có provider
  catalog, không có marker cluster.
- API chỉ lấy toạ độ từ mẫu RTCM 1005 (`quality_samples`), **không dùng**
  `stations.lat` / `stations.lon`.

### 1.2. Bằng chứng bản đồ trắng / thiếu marker

Trong môi trường test hiện tại:

- `GET /api/map/overview?layer=stations` trả `total = 4`,
  `missing_1005 = 3`; chỉ 1 trạm có `lat/lon` (trạm có 1005).
- Request tile trực tiếp tới `https://a.tile.openstreetmap.org/5/24/15.png`
  thất bại (`Unable to connect to the remote server`).
- Vì vậy có 2 nguyên nhân độc lập:
  1. Tile nền không tải được → nền trắng.
  2. API bỏ qua toạ độ nhập tay của trạm → gần như không có marker.

### 1.3. Đối chiếu mã nguồn tham chiếu

Mã nguồn tham chiếu có kiến trúc 3 tầng Provider → Renderer → Mode/Layer,
`map_configs`, 12 provider, tile proxy allowlist, marker cluster, MapLibre,
3D/PMTiles, icon/badge phức tạp.

Dự án này **không cần** sao chép toàn bộ. Chỉ nên lấy các ý tưởng cốt lõi:

- Cấu hình provider/tile thay vì hard-code.
- Tile proxy + allowlist + fallback khi lỗi.
- Marker rõ ràng, dùng zoom/filter khi mật độ cao (không cluster).
- Nhiều chế độ nền cơ bản.
- Bộ lọc/tìm kiếm đầy đủ, URL state, fit view.
- Geoapify cho tìm địa chỉ/tọa độ.

Không làm ở kế hoạch này:

- MapLibre/vector tile/3D/terrain DEM/PMTiles.
- 12 provider, 76 icon, badge trạng thái phức tạp.
- Marker cluster/`leaflet.markercluster`.
- Workflow đề xuất trạm/quy hoạch.
- Geocode admin panel phức tạp.
- Thêm Redis/Kafka/RabbitMQ/K8s hoặc dịch vụ ngoài stack.

## 2. Mục tiêu và tiêu chí thành công

### 2.1. Mục tiêu

1. Bản đồ hiển thị nền thật hoặc báo lỗi rõ ràng, không còn nền trắng câm.
2. Mọi trạm có toạ độ (1005 hoặc nhập tay) đều có marker.
3. Xem, lọc, tìm kiếm trạm ngay trên bản đồ; URL lưu trạng thái.
4. Có cấu hình nền bản đồ tối giản cho super admin, không lộ secret.
5. Giữ Leaflet, không tăng độ phức tạp không cần thiết.
6. Bổ sung nhập toạ độ dự phòng (lat/lon) trong form trạm.
7. Tìm địa chỉ bằng Geoapify (forward) và dùng Geoapify reverse cho toạ độ.

### 2.2. Tiêu chí thành công

- `/map` hiển thị tile nền (hoặc banner lỗi có nút thử lại).
- Số marker = số trạm có toạ độ từ API.
- Search theo tên/ID/vùng/địa chỉ/owner hoạt động.
- Tìm địa chỉ Geoapify trả kết quả và bay tới đúng vị trí.
- Form trạm nhập được vĩ độ/kinh độ dự phòng; map dùng khi không có 1005.
- Lọc layer/trạng thái/vùng/owner/có-toạ-độ hoạt động, counts đúng.
- Click marker/list mở đúng popup/detail; fit kết quả đúng.
- Responsive 1440/768/390 không tràn; dark mode dùng được.
- Test API/tile/Playwright PASS; không lộ API key.

## 3. Quyết định mặc định

| Mã | Quyết định | Đề xuất |
|---|---|---|
| D06-1 | Renderer | Giữ **Leaflet**; không thêm MapLibre |
| D06-2 | Tile mode | Ưu tiên **proxy** qua Node; nếu P06-0 xác định Node không ra internet thì dùng `direct` có kiểm soát hoặc tile nội bộ |
| D06-3 | Lưu cấu hình | Dùng `settings` key `map.config`; không tạo bảng mới |
| D06-4 | Toạ độ marker | Ưu tiên 1005; fallback `stations.lat/lon`; hết cả hai → không marker |
| D06-5 | Cluster | **Bỏ cluster**. Không thêm `leaflet.markercluster`; marker hiển thị trực tiếp, dùng zoom/filter khi dày |
| D06-6 | Trang map | Một trang `/map`; **xoá ngay** `StationMap`/`OnlineMap` khi làm P06 |
| D06-7 | Nền bản đồ | 3 mode raster: streets / satellite / terrain; không hybrid/vector |
| D06-8 | Tìm kiếm | Server-side trên tên, ID, vùng, địa chỉ, owner, company |
| D06-9 | Lỗi tile | Luôn có banner + fallback + retry; không im lặng |
| D06-10 | Geocode | Dùng **Geoapify** cho forward + reverse; key `GEOAPIFY_API_KEY` chỉ ở `.env.local` |
| D06-11 | Secret | API key chỉ server-side; response config đã sanitize |
| D06-12 | RBAC dữ liệu map | `stations.view` + scope hiện tại (all/tenant/own/subtree); owner/region filter không được vượt scope |
| D06-13 | RBAC field-level | Chỉ trả quality/relay/online-account khi actor có `quality.view` / `relay.view` / `connections.view` |
| D06-14 | RBAC cấu hình map | `GET /api/map/config` cho user đã đăng nhập (đã sanitize); `PUT`/`test` cần `settings.edit` (mặc định super) |
| D06-15 | RBAC tile proxy | `requireAuth`; tile là asset hạ tầng, không chứa dữ liệu tenant; không public |
| D06-16 | UI cấu hình map | Menu/trang cấu hình chỉ hiện khi `can('settings','edit')`; không hard-code role trong component |
| D06-17 | Công ty | Map API dùng scope company hiện tại; `companyId` filter chỉ super; company disabled → 401 qua `requireAuth` |
| D06-18 | Provider mặc định | Streets: `tile.openstreetmap.de` hoặc `a.tile.openstreetmap.fr/osmfr`; Satellite: Esri World Imagery; Terrain: OpenTopoMap. **Không dùng `tile.openstreetmap.org`** vì môi trường hiện tại không kết nối được |
| D06-19 | Toạ độ dự phòng | Dùng 2 cột hiện có `stations.lat/lon` làm toạ độ dự phòng; bổ sung input nhập tay trong form trạm (không cần migration) |
| D06-20 | Geocode provider | Geoapify search/autocomplete; key đã có trong `.env.local`; không ghi key vào repo/docs |
| D06-21 | Xoá code cũ | Xoá `StationMap.tsx`, `OnlineMap.tsx` và route redirect liên quan trong P06; không giữ bản hard-code OSM |

### 3.1. Quyết định đã chốt / cần xác minh

Đã chốt từ chủ dự án:

1. Tile provider khả dụng trong môi trường:
   - `tile.openstreetmap.de` — 200 image/png.
   - `a.tile.openstreetmap.fr/osmfr` — 200 image/png.
   - `server.arcgisonline.com` (Esri imagery/basemap) — 200 image/jpeg.
   - `a.tile.opentopomap.org` — 200 image/png.
   - `tiles.openfreemap.org/styles/liberty` — 200 (vector, không dùng).
   - `tile.openstreetmap.org` — FAIL, không dùng.
2. Tile proxy yêu cầu đăng nhập.
3. Không dùng cluster/`leaflet.markercluster`.
4. Cấu hình lưu `settings` JSON + panel super.
5. Nền: streets + satellite + terrain.
6. Toạ độ: 1005 trước, fallback `stations.lat/lon`; bổ sung nhập tay.
7. Geoapify dùng cho cả suy ra toạ độ (reverse) và tìm kiếm địa chỉ (forward).
8. Được tạo/sửa trạm test.
9. Xoá ngay `StationMap`/`OnlineMap`.

Cần xác minh trong P06-0:

1. Node server container có truy cập được các host tile ở trên không.
   - Nếu có → dùng tile proxy.
   - Nếu không → chọn `direct` hoặc URL tile nội bộ; ghi rõ trade-off bảo mật.
2. Provider phụ (subdomain, retina) và giới hạn zoom thực tế của từng nền.
3. Geoapify key hoạt động với cả reverse + forward; nếu key đã lộ ngoài
   `.env.local`, nên rotate trước production.

### 3.2. Chuẩn phân quyền cho bản đồ (bắt buộc)

Map phải dùng đúng mô hình phân quyền hiện hành trong
`docs/2/PHAN_QUYEN.md`. Không tạo bảng quyền riêng cho map.

#### 3.2.1. Quyền vào trang và API

| Thành phần | Quyền | Super | Admin | User | Ghi chú |
|---|---|---|---|---|---|
| Menu `/map` | `stations.view` | Có | Có | Có | User/admin thấy company |
| Menu `/online` | `connections.view` | Có | Có | Không | Map online là layer riêng |
| `GET /api/map/overview` | `stations.view` | All | Tenant | Tenant | Scope hiện tại |
| `GET /api/map/config` | Đăng nhập | Có | Có | Có | Chỉ config sanitized |
| `PUT /api/map/config` | `settings.edit` | Có | Không | Không | Mặc định super |
| `POST /api/map/config/test` | `settings.edit` | Có | Không | Không | Mặc định super |
| `GET /api/map/tiles/:z/:x/:y` | Đăng nhập | Có | Có | Có | Asset hạ tầng, không public |

Lý do `GET /api/map/config` không dùng `settings.view`:
- Mọi user có `stations.view` cần biết tile URL/attribution để render map.
- Response chỉ chứa provider/tile công khai, không có API key/secret.
- Nếu sau này config chứa thông tin nhạy cảm, phải tách response theo quyền.

#### 3.2.2. Phạm vi dữ liệu

`GET /api/map/overview` giữ nguyên scope engine:

| Vai trò | Scope mặc định | Dữ liệu map |
|---|---|---|
| Super | `all` | Toàn bộ trạm; có thể lọc `companyId` |
| Admin | `tenant` | Trạm có `company_id` của admin |
| User | `tenant` | Trạm toàn company |
| Custom role | Theo `role_permissions` | `all/tenant/subtree/own/none` |

Quy tắc bắt buộc:

1. `scope.sql` luôn đứng trước filter.
2. `region`, `owner`, `q` chỉ thu hẹp thêm, **không được mở rộng** scope.
3. `companyId` chỉ áp dụng khi actor super; admin/user gửi `companyId` bị bỏ qua.
4. `regions`, `owners` trả về phải được tính từ tập đã scope; không lộ owner
   hoặc vùng của company khác.
5. `http 404` cho detail ngoài scope; list trả rỗng/total đã lọc.
6. Company bị disable: `requireAuth` trả 401; map không tải.

#### 3.2.3. Field-level permission

Không phải user nào có `stations.view` cũng được thấy mọi field vận hành.
API map phải gate từng nhóm field:

| Field / nhóm | Điều kiện | Nếu không có quyền |
|---|---|---|
| `id`, `name`, `lat`, `lon`, `hasCoords`, `coordSource`, `region`, `address`, `owner/company` | `stations.view` | Không có item |
| `enabled`, `status`, `sourceType`, `mountpointCount` | `stations.view` | Không có item |
| `has1005`, `quality`, `score`, `transport` | `quality.view` | `has1005=false`, `quality='unknown'`, `score=null`, `transport` từ station status hoặc `unknown` |
| `relayJobCount` | `relay.view` | `null` hoặc `0`, popup ẩn mục relay |
| `onlineAccounts`, layer `online_accounts`, counts online accounts | `connections.view` | `0`, ẩn layer/filter/count |
| `issues` count/layer | Theo transport đã gate | Chỉ tính trên field actor được thấy |

Ghi chú:
- Toạ độ 1005 dùng cho marker vẫn được phép khi có `stations.view`; đây là
  toạ độ trạm, không phải dữ liệu chất lượng chi tiết.
- UI không được hiện mục “Chất lượng”, “Relay”, “Tài khoản online” nếu thiếu
  permission tương ứng; server vẫn phải trả `null`/`0` an toàn.

#### 3.2.4. Cấu hình map và audit

- `PUT /api/map/config` và `POST /api/map/config/test`:
  - `requireAuth` + `requirePermission('settings', 'edit')`.
  - Kiểm tra thêm super admin nếu muốn khóa cứng theo hiện trạng.
  - Ghi audit `update map_config`, redact secret.
- `settings.view` không được dùng để trả API key.
- UI trang cấu hình map:
  - Chỉ hiện menu/route khi `can('settings', 'edit')`.
  - Admin/user không thấy menu, gọi API trực tiếp → 403.
- Không hard-code `role === 'super_admin'` rải rác trong component; dùng
  `can('settings','edit')` hoặc quyền tương ứng.

#### 3.2.5. Tile proxy và bảo mật

- `GET /api/map/tiles/:z/:x/:y` yêu cầu đăng nhập.
- Không public tile proxy để tránh bị dùng làm proxy mở.
- Không chứa dữ liệu tenant; không cần scope row-level.
- Allowlist host; chặn SSRF; không trả API key.
- Nếu cần giới hạn thêm, có thể yêu cầu `stations.view`, nhưng phải thống nhất
  với yêu cầu preview cấu hình của super.

#### 3.2.6. RBAC UI map

| Thành phần UI | Super | Admin | User |
|---|---|---|---|
| Trang `/map` | Có | Có | Có |
| Layer stations/online/issues | Có | Có | Có theo dữ liệu được thấy |
| Layer online accounts | Có | Có | Không |
| Filter owner | Tất cả owner | Owner company | Owner company |
| Filter company | Có | Không | Không |
| Trang cấu hình map | Có | Không | Không |
| Nút test kết nối tile | Có | Không | Không |

## 4. Kiến trúc đích (đơn giản)

```text
settings['map.config'] (JSON)
        │
        ├── GET /api/map/config (sanitized)
        │
        ▼
useMapConfig()
        │
        ├── tileUrl / attribution / maxZoom / modes
        ▼
/api/map/tiles/:z/:x/:y (proxy allowlist)
        │
        ▼
provider tile thật

UnifiedMap
  ├── MapFilterPanel
  ├── SearchBox (trạm + địa chỉ Geoapify)
  ├── MapLegend
  ├── MapCanvas (Leaflet)
  │     ├── tile layer
  │     ├── marker trực tiếp (không cluster)
  │     ├── selected marker/popup
  │     └── fit bounds / flyTo
  └── TileErrorBanner

GET /api/map/overview?q&layer&region&owner&transport&status&hasCoords
  └── coordSource: 1005 | station | none

GET /api/geo/search?q=...   (Geoapify forward)
GET /api/geo/reverse?lat=&lon= (Geoapify reverse)
```

### 4.1. Cấu hình `map.config`

```json
{
  "version": 1,
  "provider": "osm-de",
  "tileMode": "proxy",
  "tileUrl": "/api/map/tiles/{z}/{x}/{y}",
  "attribution": "© OpenStreetMap contributors",
  "subdomains": [],
  "maxZoom": 19,
  "maxNativeZoom": 19,
  "retina": false,
  "center": { "lat": 16.0, "lng": 106.0 },
  "zoom": 6,
  "modes": {
    "streets": {
      "tileUrl": "/api/map/tiles/{z}/{x}/{y}?mode=streets",
      "attribution": "© OpenStreetMap contributors",
      "maxZoom": 19
    },
    "satellite": {
      "tileUrl": "/api/map/tiles/{z}/{x}/{y}?mode=satellite",
      "attribution": "© Esri",
      "maxZoom": 19
    },
    "terrain": {
      "tileUrl": "/api/map/tiles/{z}/{x}/{y}?mode=terrain",
      "attribution": "© OpenTopoMap",
      "maxZoom": 17
    }
  }
}
```

- API key không nằm trong response; nếu có, chỉ server giữ và dùng qua proxy.
- Nếu `tileMode = direct`, `tileUrl` phải là URL template an toàn, không chứa
  secret; không khuyến khích cho production.
- `settings` key `map.config` không có row → dùng default/env fallback.

### 4.2. Provider mặc định

| Mode | Provider | URL gốc | Attribution | Ghi chú |
|---|---|---|---|---|
| streets | OSM DE | `https://tile.openstreetmap.de/{z}/{x}/{y}.png` | © OpenStreetMap contributors | Đã test 200 |
| streets (fallback) | OSM FR | `https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png` | © OpenStreetMap contributors | Đã test 200 |
| satellite | Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | © Esri | Đã test 200 |
| terrain | OpenTopoMap | `https://a.tile.opentopomap.org/{z}/{x}/{y}.png` | © OpenTopoMap | Đã test 200, max zoom thấp hơn |

Không dùng `tile.openstreetmap.org` (FAIL trong môi trường hiện tại).
Provider phải qua allowlist; nếu dùng proxy thì URL gốc nằm server-side.

### 4.3. Toạ độ dự phòng và geocode

- `stations.lat` / `stations.lon` hiện đã có trong DB nhưng UI chỉ hiển thị
  1005 read-only. Bổ sung 2 input nhập tay:
  - “Vĩ độ dự phòng (WGS84)”
  - “Kinh độ dự phòng (WGS84)”
- Validate `-90..90`, `-180..180`; cho phép null.
- Mặc định dùng 2 cột hiện có, **không cần migration**.
- Nếu muốn tách thành 2 cột riêng `backup_lat`/`backup_lon`, phải tạo
  migration mới và cập nhật API/type; chưa làm trong phạm vi 06.
- Ưu tiên marker:
  1. 1005 hợp lệ.
  2. `stations.lat/lon`.
  3. Không marker.
- Geoapify:
  - `GEOAPIFY_API_KEY` trong `.env.local`; không ghi vào repo/docs.
  - Reverse: đã có `GET /api/geo/reverse`.
  - Forward: thêm `GET /api/geo/search?q=&limit=` trả `label`, `lat`, `lon`.
  - Chỉ gọi khi `q` >= 3 ký tự, debounce 300–500ms.
  - Cache ngắn, timeout 3–5s, lỗi → chỉ hiện kết quả trạm.
  - Key đã xuất hiện ngoài `.env.local` (chat) → nên rotate trước production.

## 5. Thay đổi dữ liệu / API

### 5.1. `GET /api/map/overview`

Giữ endpoint hiện tại, mở rộng:

Query:

```text
q, layer, region, owner, transport, status, hasCoords, companyId
```

- `q`: tìm theo `stations.id`, `name`, `region`, `address`, `owner_name`,
  `company_name`.
- `transport`: `online|stale|offline|error|unknown` (hỗ trợ comma).
- `status`: `active|disabled|locked`.
- `hasCoords`: `1|0`.
- `companyId`: chỉ áp dụng cho super (giữ nguyên quy tắc RBAC).

Response bổ sung:

- `hasCoords`
- `coordSource`: `1005 | station | none`
- `companyId`, `companyName`
- `counts.withCoords`, `counts.missingCoords`
- `counts.filtered`

Quy tắc toạ độ:

```text
if 1005 hợp lệ (reported_station_id + arp_x/y/z trong range)
  -> dùng ecefToGeodetic, coordSource = '1005'
else if stations.lat/lon hợp lệ (-90..90, -180..180)
  -> dùng trực tiếp, coordSource = 'station'
else
  -> lat/lon = null, coordSource = 'none'
```

Không phá API cũ: vẫn giữ `has1005`, `missing_1005`.

#### 5.1.1. Luật RBAC bắt buộc cho `map/overview`

1. `requireAuth` + `requirePermission('stations', 'view')`.
2. `scope.sql` lấy từ `listScope` với `s.company_id`; không tự viết lại scope.
3. Filter `region`, `owner`, `q` phải nối bằng `AND` sau scope.
4. `companyId` chỉ áp dụng khi `req.auth.roleCode === 'super_admin'`.
5. Owner filter không được dùng để dò owner company khác:
   - Admin/user truyền owner ngoài company → kết quả rỗng, không 404 owner.
6. Field-level gating:
   - `quality`, `score`, `transport`, `has1005`: cần `quality.view`;
     nếu không → `unknown`/`null`/`false`, trừ `transport` suy ra từ trạng thái
     trạm (enabled/disabled/locked).
   - `relayJobCount`: cần `relay.view`; nếu không → `null`.
   - `onlineAccounts` và layer `online_accounts`: cần `connections.view`;
     nếu không → `0` và không trả layer/count trong `layersAvailable`.
   - `issues`, `online` counts chỉ tính trên item đã qua field-level gating.
7. Trả thêm `layersAvailable` để UI ẩn layer không có quyền:

```json
{
  "layersAvailable": ["stations", "online", "issues", "missing_coords"],
  "counts": { "all": 4, "online": 1, "issues": 3, "withCoords": 2, "missingCoords": 2 }
}
```

### 5.2. `GET /api/map/config`

- Yêu cầu đăng nhập (`requireAuth`).
- Trả config sanitized.
- Không trả `apiKey`, `password`, token, header Authorization.
- Nếu chưa có config → default an toàn.

### 5.3. `PUT /api/map/config`

- `requireAuth` + `requirePermission('settings', 'edit')`.
- Kiểm tra thêm `isSuperAdmin(req)` để khóa cứng theo hiện trạng (admin/user
  mặc định đã không có `settings.edit`).
- Allowlist field:
  `provider`, `tileMode`, `tileUrl`, `attribution`, `subdomains`,
  `maxZoom`, `maxNativeZoom`, `retina`, `center`, `zoom`, `modes`.
- Validate URL chỉ `http/https`; không cho URL ngoài allowlist nếu proxy.
- Ghi audit `update`, `map_config`; redact secret.
- Không cập nhật `company_id` (audit fallback actor company; super null).

### 5.4. `POST /api/map/config/test`

- `requireAuth` + `requirePermission('settings', 'edit')` + super admin.
- Kiểm tra:
  - URL template hợp lệ.
  - Host nằm trong allowlist.
  - Fetch thử 1 tile z/x/y đại diện; trả status/thời gian/lỗi.
- Không log URL có key.

### 5.5. `GET /api/map/tiles/:z/:x/:y`

- `requireAuth` (cookie same-origin), không public.
- Không cần row-level scope vì tile không chứa dữ liệu tenant; đây là asset
  hạ tầng. Nếu chốt yêu cầu thêm `stations.view`, phải ghi rõ trong test.
- Validate `0 ≤ z ≤ 22`; `0 ≤ x,y < 2^z`.
- Chỉ hoạt động khi `tileMode = proxy`.
- Allowlist host; chặn private IP/localhost trừ khi cấu hình self-hosted rõ.
- Timeout ngắn (5–10s), cache in-memory giới hạn (LRU 256 tile, TTL 1–24h).
- Lỗi:
  - Trả PNG 1×1 trong suốt.
  - Header `X-Tile-Proxy-Status: fallback`.
  - HTTP 502.
- Cache-Control dài cho tile thành công.
- Không redirect vô hạn; giới hạn 3.

### 5.6. `GET /api/geo/search` (Geoapify forward)

- `requireAuth` + `requirePermission('stations', 'view')`.
- Query: `q` (>= 3 ký tự), `limit` (mặc định 5, tối đa 10).
- Gọi Geoapify Geocoding API server-side với `GEOAPIFY_API_KEY`.
- Trả:

```json
{
  "items": [
    { "label": "Hà Nội, Việt Nam", "lat": 21.0278, "lon": 105.8342 }
  ]
}
```

- Không trả API key.
- Timeout 3–5s; cache ngắn; lỗi/không có key → `items: []`,
  `warning` nếu cần.
- Không log full URL có key.

## 6. Thay đổi frontend

### 6.1. Components mới

| File | Vai trò |
|---|---|
| `frontend/src/lib/useMapConfig.ts` | Fetch config, cache, refresh event |
| `frontend/src/lib/mapTile.ts` | Build tile URL/proxy/direct, validate config |
| `frontend/src/components/map/MapCanvas.tsx` | Leaflet duy nhất; tile + marker + fit + popup |
| `frontend/src/components/map/MapFilterPanel.tsx` | Search + filter chips/select + reset |
| `frontend/src/components/map/MapLegend.tsx` | Legend màu trạng thái |
| `frontend/src/components/map/TileErrorBanner.tsx` | Báo lỗi tile + retry |
| `frontend/src/components/map/AddressSearch.tsx` | Geoapify forward search + chọn kết quả |

### 6.2. Sửa trang chính

`frontend/src/pages/UnifiedMap.tsx`:

- Không import Leaflet trực tiếp; dùng `MapCanvas`.
- Dùng `useMapConfig`.
- Search/filter lưu URL:
  `q`, `layer`, `region`, `owner`, `transport`, `status`, `hasCoords`,
  `station`, `mode`.
- Ô tìm địa chỉ riêng (Geoapify):
  - debounce 300–500ms, chỉ gọi khi >= 3 ký tự.
  - Hiện danh sách gợi ý `label`; chọn → flyTo + marker tạm.
  - Lỗi/không có key → chỉ tìm trạm, không chặn map.
- Nút:
  - “Fit kết quả”
  - “Xoá lọc”
  - “Về mặc định”
- List và marker đồng bộ selection.
- Popup có link “Mở chi tiết trạm”.
- Empty state phân biệt:
  - Không có trạm phù hợp.
  - Có trạm nhưng chưa có toạ độ.
  - Tile lỗi.
- Mobile: filter mở dạng drawer; map `invalidateSize()` khi mở/đóng.
- **RBAC UI:**
  - Dùng `useAuth().can(...)` để ẩn/hiện theo quyền, không hard-code role.
  - Layer `online_accounts` và filter owner-chỉ-online chỉ hiện khi
    `can('connections','view')`.
  - Popup ẩn dòng quality nếu `!can('quality','view')`, ẩn relay nếu
    `!can('relay','view')`, ẩn online accounts nếu
    `!can('connections','view')`.
  - Filter company chỉ hiện/có tác dụng với super (hoặc dùng
    `can('companies','view')`).
  - Nút/trang cấu hình map chỉ hiện khi `can('settings','edit')`.
  - Server vẫn là nguồn kiểm tra cuối; UI chỉ hỗ trợ trải nghiệm.

### 6.3. Marker

- Màu:
  - online: xanh
  - stale: vàng
  - offline/error: đỏ
  - unknown/disabled: xám
- Kích thước marker selected lớn hơn.
- Tooltip ngắn, popup đầy đủ.
- Popup chỉ render field actor có quyền:
  - Quality/score: `quality.view`.
  - Relay count: `relay.view`.
  - Online accounts: `connections.view`.
- **Không dùng cluster** theo yêu cầu. Marker hiển thị trực tiếp.
  - Khi mật độ cao: dùng zoom/filter để giảm số marker.
  - Không thêm `leaflet.markercluster`/dependency mới.

### 6.4. Nền bản đồ

- 3 mode: `streets`, `satellite`, `terrain`.
- Streets: OSM DE, fallback OSM FR.
- Satellite: Esri World Imagery.
- Terrain: OpenTopoMap.
- Mode lưu URL `?mode=`.
- Đổi mode không reset filter/selection.
- Attribution luôn hiển thị.
- Dark mode không hard-code màu marker/legend theo light.

### 6.5. Dọn code cũ

- `StationMap.tsx`, `OnlineMap.tsx`: **xoá ngay trong P06**.
- Bỏ route/redirect không cần thiết; giữ `/stations/map`, `/online/map`
  redirect về `/map` nếu muốn tương thích bookmark.
- Không giữ 2 bản hard-code OSM.
- Cập nhật `App.tsx`.

## 7. Kế hoạch theo bước

### P06-0 — Chuẩn bị và xác minh provider

- [x] Kiểm tra connectivity từ **server container** tới:
      `tile.openstreetmap.de`, `a.tile.openstreetmap.fr/osmfr`,
      `server.arcgisonline.com`, `a.tile.opentopomap.org`.
- [x] Xác nhận browser hiển thị được các host trên.
- [x] Chốt `tileMode`:
      - Node ra internet → proxy (ưu tiên).
      - Node không ra internet → direct hoặc tile nội bộ; ghi rõ trade-off.
- [x] Xác nhận `GEOAPIFY_API_KEY` trong `.env.local` hoạt động với
      reverse + forward; không ghi key vào repo/docs.
- [x] Không thêm `leaflet.markercluster` (đã chốt bỏ cluster).
- [x] Tạo fixture trạm có:
  - 1 trạm có 1005
  - 1 trạm chỉ có `stations.lat/lon`
  - 1 trạm không có toạ độ
- [x] Backup DB trước khi đổi dữ liệu test.

**Nghiệm thu:** có provider tile trả ảnh thật; có fixture 3 loại toạ độ;
Geoapify forward/reverse trả kết quả.

**Kết quả P06-0 (2026-11-01):**

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Server → tile hosts | PASS | `osm-de` 200 image/png 14.685B; `osm-fr` 200 image/png 16.303B; `esri` 200 image/jpeg 12.295B; `opentopo` 200 image/png 30.195B |
| Browser → tile hosts | PASS | Playwright Chromium tải và render cả 4 tile |
| `tileMode` | **proxy** | Node container ra internet; dùng tile proxy có đăng nhập |
| Geoapify reverse + forward | PASS | server container: `forward=200:1 reverse=200:1`; key không in ra log |
| `leaflet.markercluster` | Không có | không có trong `frontend/package.json`, `server/package.json` |
| Fixture 1005 | PASS | trạm `480 TestHauLoc` có `quality_samples` 1005 (`reported_station_id=483`, `arp_x/y/z`) |
| Fixture toạ độ dự phòng | PASS | trạm `481 Trạm test Hà Nội 01` `lat=21.0285`, `lon=105.8542` |
| Fixture không toạ độ | PASS | trạm `482 Trạm test Hà Nội 02` không 1005, `lat/lon = NULL` |
| Backup DB | PASS | `F:\3.Laptrinh\1. Project\1. GNSS\Backup\cors-mysql-20261101-190927.sql.zip` (SHA256 F0619C84…D40CF4D10) |

### P06-1 — Sửa nền tảng: tile + toạ độ

- [x] Thêm `server/src/lib/mapConfig*` (default, sanitize, validate).
- [x] Thêm `GET /api/map/config`.
- [x] Thêm `GET /api/map/tiles/:z/:x/:y` proxy.
- [x] Cấu hình allowlist + cache + fallback.
- [x] Sửa `GET /api/map/overview`:
  - fallback toạ độ 1005 → station
  - `coordSource`, `hasCoords`, `missingCoords`
  - filter `transport/status/hasCoords`
  - search mở rộng
  - **giữ scope `stations.view` + company/owner hiện tại**
  - **field-level gate quality/relay/online-account**
  - trả `layersAvailable`
- [x] Frontend `useMapConfig` + `MapCanvas` bước đầu.
- [x] `UnifiedMap` dùng config thay OSM hard-code.
- [x] Thêm banner lỗi tile + retry.
- [x] **Form trạm:** thêm input nhập tay “Vĩ độ dự phòng” / “Kinh độ dự phòng”
      dùng `stations.lat/lon`; validation WGS84.
- [x] Test nhanh RBAC: user không thấy owner/company khác; layer online
      accounts ẩn nếu thiếu `connections.view`.

**Nghiệm thu:**
- `/map` có tile nền hoặc banner lỗi rõ.
- Marker = số trạm có toạ độ.
- Trạm chỉ có `stations.lat/lon` hiện marker; nhập được trong form trạm.
- Không còn hard-code OSM trong page.

**Kết quả P06-1 (2026-11-01):**

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Server tsc/build | PASS | `npx tsc --noEmit`, `npm run build` |
| Server Vitest | PASS | 71/71 (thêm `tests/map.test.ts` 10 test) |
| Frontend tsc/build | PASS | `npx tsc --noEmit`, `npm run build` |
| Tile proxy | PASS | `/api/map/tiles/5/24/15` 200 image/png 14.685B, `X-Tile-Proxy-Status: ok`, `Cache-Control: public, max-age=86400` |
| Tile satellite/terrain | PASS | satellite 200 image/jpeg 12.295B; terrain 200 image/png 30.195B |
| Tile lỗi/z-x-y/mode | PASS | z=5,x=999 → 400 `INVALID_TILE`; mode sai → 400 `INVALID_MODE`; chưa login → 401 |
| Toạ độ marker | PASS | trạm 480 `coordSource=1005`; trạm 481 `coordSource=station`; trạm 482/483 `none`; super `withCoords=2`, `missingCoords=2` |
| Field-level gate | PASS | user role `quality.view=own`, `relay.view=tenant`; custom role chỉ `stations.view`: `relayJobCount=null`, `quality=unknown`, `onlineAccounts=0`, thiếu layer `online_accounts` |
| RBAC config | PASS | GET config: super/admin/user/custom 200, không secret; PUT/test: admin/user 403, super 200 |
| RBAC company | PASS | admin company 1 gửi `companyId=999` bị bỏ qua, vẫn thấy 3 trạm company 1 |
| Form trạm | PASS | có input “Vĩ độ dự phòng”/“Kinh độ dự phòng”, `type=number`, min/max WGS84 |
| Playwright smoke | PASS | tile proxy 200 ảnh, marker count 2, attribution OSM, chuyển satellite attribution Esri, form có 2 input; không console error |

### P06-2 — Bộ lọc, tìm kiếm, tương tác bản đồ

- [x] `MapFilterPanel`: search + layer + transport + status + region + owner +
      hasCoords + reset.
- [x] Debounce search 300ms; AbortController cho request cũ.
- [x] URL state đầy đủ.
- [x] Fit bounds; flyTo selected; marker/list sync.
- [x] Legend.
- [x] Empty/loading/error states.
- [x] Responsive + dark mode.
- [x] **Không cluster**: marker trực tiếp; hướng dẫn dùng zoom/filter khi dày.
- [x] 3 mode nền.
- [x] **AddressSearch** dùng `GET /api/geo/search` (Geoapify):
      debounce, chọn kết quả → flyTo + marker tạm; lỗi không chặn map.
- [x] **Ẩn/hiện filter/layer/popup field theo `can()`**:
  `connections.view`, `relay.view`, `quality.view`; `settings.edit` xử lý ở P06-3.

**Nghiệm thu:**
- Search trạm/địa chỉ/lọc đúng; counts đúng; fit đúng.
- Click marker/list mở đúng popup/detail.
- 390/768/1440 không tràn; dark mode dùng được.

**Kết quả P06-2 (2026-11-01):**

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| `GET /api/geo/search` | PASS | `Hà Nội` → 200, 1 item `Hà Nội, Việt Nam` (21.0283, 105.8540); `q=Ha` → 400 `VALIDATION_ERROR`; chưa login → 401 |
| Geoapify forward thật | PASS | gọi server-side, không in key; timeout 4s, cache 5 phút |
| MapFilterPanel | PASS | search/layer/transport/status/region/owner/hasCoords/reset; debounce 300ms |
| URL state | PASS | `q`, `layer`, `region`, `owner`, `transport`, `status`, `hasCoords`, `station`, `mode` |
| Fit/flyTo/sync | PASS | Fit kết quả; chọn list/marker fly tới; popup + “Mở chi tiết trạm” |
| AddressSearch | PASS | gõ >=3 ký tự, chọn gợi ý → tooltip + marker tạm, URL không đổi |
| 3 mode nền | PASS | streets OSM, satellite Esri, terrain OpenTopoMap; attribution đổi theo mode |
| Không cluster | PASS | `.marker-cluster` = 0; marker trực tiếp |
| Responsive/dark | PASS | 1440/768/390 không tràn ngang; dark mode `data-theme=dark` |
| Tile error banner | PASS | abort tile → banner; Thử lại với tile 200 → banner mất |
| Xoá code cũ | PASS | xoá `StationMap.tsx`, `OnlineMap.tsx`; route `/stations/map`, `/online/map` vẫn redirect `/map` |
| Playwright | PASS | `map-upgrade.spec.ts` 2/2 |
| Frontend tsc/build | PASS | `npx tsc --noEmit`, `npm run build` |
| Server tsc/Vitest/build | PASS | 71/71 |

### P06-3 — Cấu hình map cho super admin

- [ ] `GET/PUT /api/map/config`, `POST /api/map/config/test`.
- [ ] Lưu `settings['map.config']`; audit.
- [ ] **Quyền:**
  - `GET` cho user đã đăng nhập, response sanitized.
  - `PUT`/`test`: `settings.edit` + super admin.
  - Admin/user gọi trực tiếp → 403.
- [ ] **UI:**
  - Trang `/system/map-config` hoặc panel trong Hệ thống.
  - Menu/nút chỉ hiện khi `can('settings','edit')`.
  - Không hard-code role trong component.
- [ ] Panel super admin tối giản:
  - provider/tile mode/tile URL/attribution/subdomains
  - maxZoom/maxNativeZoom/retina
  - center/zoom
  - 3 mode
  - Test kết nối
- [ ] Refresh map sau lưu.
- [ ] Chặn URL ngoài allowlist; sanitize secret.
- [ ] Cập nhật `docs/api.md`.

**Nghiệm thu:**
- Super đổi nền, lưu, map tải lại theo config.
- Admin/user không đổi được.
- Không lộ key.

### P06-4 — Test & rollout

- [ ] Unit test helper toạ độ/config/tile URL.
- [ ] API test search/filter/coordSource/RBAC.
- [ ] API test Geoapify forward search (mock/không key).
- [ ] Tile proxy test allowlist/fallback/cache.
- [ ] Test provider thật: osm-de, osm-fr, Esri, OpenTopoMap.
- [ ] Test form trạm nhập toạ độ dự phòng.
- [ ] Playwright map:
  - tile stub/local (không phụ thuộc OSM)
  - marker count
  - search trạm + địa chỉ
  - filter/reset/fit
  - popup/detail
  - tile error banner
  - responsive/dark
- [ ] Cập nhật test cũ `unified-map.spec.ts`, `map.spec.ts`.
- [ ] Regression navigation/station/RBAC; không có cluster.
- [ ] Graphify update sau khi đổi cấu trúc.
- [ ] Cập nhật `SESSION.md`, `TASKS.md`, `docs/2` nếu cần.

## 8. Test matrix bắt buộc

| ID | Nội dung | Kỳ vọng |
|---|---|---|
| 06-T1 | Tile proxy tile hợp lệ | 200, content-type ảnh, cache header |
| 06-T2 | z/x/y sai hoặc host ngoài allowlist | 400/403, không SSRF |
| 06-T3 | Provider lỗi/timeout | PNG fallback + `X-Tile-Proxy-Status` + 502 |
| 06-T4 | GET config | Không có apiKey/token/secret |
| 06-T5 | PUT config super/admin/user | Super 200; admin/user 403 |
| 06-T6 | Trạm có 1005 | `coordSource = 1005`, marker đúng |
| 06-T7 | Trạm không 1005, có `stations.lat/lon` | `coordSource = station`, marker đúng |
| 06-T8 | Trạm không có toạ độ | `coordSource = none`, không marker, có trong list |
| 06-T9 | Search tên/ID/vùng/địa chỉ/owner | Đúng kết quả, debounce |
| 06-T10 | Filter layer/transport/status/region/owner/hasCoords | Đúng, kết hợp được |
| 06-T11 | Counts all/filtered/withCoords/missingCoords | Khớp dữ liệu |
| 06-T12 | Marker count = số trạm có toạ độ | Khớp API |
| 06-T13 | Nhiều marker gần nhau | Marker trực tiếp, không lỗi; không cluster theo yêu cầu |
| 06-T14 | Click marker/list | Popup/detail đúng, map fly đúng |
| 06-T15 | Fit kết quả | Bounds bao đúng marker đang lọc |
| 06-T16 | Tile lỗi | Banner + retry, không trắng câm |
| 06-T17 | Responsive 1440/768/390 | Không tràn; filter dùng được |
| 06-T18 | Dark mode | Control/legend đọc được |
| 06-T19 | RBAC map nền | Super all; admin company; user company; owner-filter không vượt scope |
| 06-T20 | Redirect `/stations/map`, `/online/map` | Về `/map` đúng layer |
| 06-T21 | Regression navigation/station/RBAC | PASS |
| 06-T22 | Không console error | PASS |
| 06-T23 | User không có `connections.view` | Không thấy layer `online_accounts`; `onlineAccounts = 0`; counts không lộ |
| 06-T24 | User không có `relay.view` (custom role) | `relayJobCount = null/0`; popup ẩn relay |
| 06-T25 | User không có `quality.view` (custom role) | `score = null`, `quality = unknown/disabled`; popup ẩn quality |
| 06-T26 | Admin/user gửi `companyId` | Bị bỏ qua; không thấy company khác |
| 06-T27 | GET `/api/map/config` | Mọi user đăng nhập nhận config sanitized; không secret |
| 06-T28 | PUT/test config admin/user | 403; super 200; audit ghi nhận |
| 06-T29 | Tile proxy chưa đăng nhập | 401; không public |
| 06-T30 | Company disabled / user locked | Map API 401; không tải dữ liệu |
| 06-T31 | Ẩn/hiện UI theo quyền | Admin không thấy menu cấu hình map; user không thấy layer online accounts |
| 06-T32 | Audit cấu hình map | Có action `map_config`, redact secret |
| 06-T33 | Form trạm nhập toạ độ dự phòng | Lưu `stations.lat/lon`, validation range |
| 06-T34 | Map dùng toạ độ dự phòng | Marker đúng khi không 1005 |
| 06-T35 | Geoapify forward search | Trả label/lat/lon; chọn kết quả flyTo |
| 06-T36 | Geoapify lỗi/không key | Chỉ tìm trạm, map vẫn hoạt động |
| 06-T37 | Provider streets/satellite/terrain | Tile đúng provider, attribution đúng |
| 06-T38 | OSM root không dùng | Config không trỏ `tile.openstreetmap.org` |
| 06-T39 | Node không ra internet | Chọn direct/tile nội bộ, có cảnh báo bảo mật |

## 9. File/khu vực dự kiến

**Server**

- `server/src/routes/map.ts`
- `server/src/routes/mapConfig.ts` (mới)
- `server/src/routes/geo.ts` (forward search Geoapify)
- `server/src/lib/mapConfig.ts` (mới)
- `server/src/lib/tileProxy.ts` (mới)
- `server/src/app.ts`
- `.env.example` (`GEOAPIFY_API_KEY`, `MAP_*`)

**Frontend**

- `frontend/src/pages/UnifiedMap.tsx`
- `frontend/src/pages/SystemMapConfig.tsx` (mới, nếu tách trang)
- `frontend/src/pages/Stations.tsx` (input toạ độ dự phòng)
- `frontend/src/components/map/MapCanvas.tsx` (mới)
- `frontend/src/components/map/MapFilterPanel.tsx` (mới)
- `frontend/src/components/map/AddressSearch.tsx` (mới)
- `frontend/src/components/map/MapLegend.tsx` (mới)
- `frontend/src/components/map/TileErrorBanner.tsx` (mới)
- `frontend/src/lib/useMapConfig.ts` (mới)
- `frontend/src/lib/mapTile.ts` (mới)
- `frontend/src/types.ts`
- `frontend/src/styles.css`
- `frontend/src/components/Layout.tsx` (menu cấu hình map theo `settings.edit`)
- `frontend/src/App.tsx` (route cấu hình map)
- `frontend/src/pages/StationMap.tsx`, `OnlineMap.tsx` (xoá ngay)

**Database**

- Không cần migration nếu dùng `settings['map.config']`.
- Nếu chốt dùng bảng riêng: migration `db/migrations/admin/034_map_configs.sql`.

**Docs/tests**

- `docs/api.md`
- `docs/1/06_KE_HOACH_NANG_CAP_BAN_DO.md`
- `TASKS.md`, `SESSION.md`
- `frontend/tests/unified-map.spec.ts`, `map.spec.ts`
- Test mới: `frontend/tests/map-upgrade.spec.ts`
- Server test mới: `server/tests/map.test.ts` (helper thuần)

## 10. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Provider ngoài không truy cập được | Test từ server/browser trước; hỗ trợ self-hosted URL |
| API key lộ | Chỉ server-side; proxy; sanitize response; audit redaction |
| SSRF qua tile proxy | Allowlist host, chặn IP private/localhost trừ cấu hình rõ |
| 1005 sai/không hợp lệ | Validate toạ độ; fallback `stations.lat/lon`; ghi `coordSource` |
| Marker chồng khi mật độ cao | Không cluster theo yêu cầu; dùng zoom/filter; ghi nhận giới hạn |
| Test phụ thuộc mạng | Route stub tile trong Playwright; test proxy bằng mock |
| Tăng dependency | Không thêm dependency cluster; chỉ dùng leaflet hiện có |
| Geoapify key lộ/hết hạn | Key chỉ `.env.local`; nếu đã lộ ngoài repo nên rotate; fallback chỉ tìm trạm |
| Trắng map lặp lại | Banner lỗi + test 06-T16 bắt buộc |
| Ảnh hưởng RBAC | Giữ `stations.view` + company/owner scope; field-level gate; test 06-T19, T23–T31 |
| Lộ dữ liệu qua field map | Gate quality/relay/online-account theo permission; test T23–T25 |
| Lộ cấu hình/secret | `GET` sanitized; `PUT/test` `settings.edit`; test T27–T28 |
| UI hard-code role | Dùng `can()`; test T31 |

## 11. Rollback

- Không có migration schema → rollback = xoá/khôi phục `settings['map.config']`
  và deploy lại frontend/server.
- Nếu dùng env fallback: đổi env về default an toàn.
- Nếu có migration 034: không sửa migration đã chạy; rollback bằng migration
  mới hoặc restore backup.
- Backup trước khi đổi dữ liệu test.

## 12. Definition of Done

1. `/map` hiển thị tile hoặc báo lỗi rõ, không còn trắng câm.
2. Marker đủ trạm có toạ độ; fallback 1005 → `stations.lat/lon`.
3. Form trạm nhập được toạ độ dự phòng; Geoapify forward/reverse hoạt động.
4. Search trạm/địa chỉ, lọc, fit, popup, list/marker sync hoạt động.
5. Cấu hình map super admin hoạt động, không lộ secret.
6. Không dùng cluster/không thêm `leaflet.markercluster`.
7. **RBAC map đúng chuẩn `docs/2/PHAN_QUYEN.md`:**
   - `stations.view` + scope company/owner.
   - Field-level gate quality/relay/online-account.
   - `GET config` sanitized; `PUT/test` `settings.edit` (super).
   - Tile proxy yêu cầu đăng nhập.
   - UI ẩn/hiện bằng `can()`, không hard-code role.
8. Test 06-T1..T39 PASS; regression PASS.
9. Responsive 1440/768/390 + dark mode PASS.
10. Không có secret trong diff.
11. `docs/api.md`, `TASKS.md`, `SESSION.md` cập nhật.
12. `graphify update .` sau thay đổi cấu trúc.
