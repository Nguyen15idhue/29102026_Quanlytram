# API Contract (Phase 1–2)

Base URL: `/api`
Auth: session cookie `cors_sid` (HttpOnly, SameSite=Lax).
CSRF: mọi request ghi (`POST/PATCH/PUT/DELETE`) phải gửi header `X-CSRF-Token` lấy từ `POST /api/auth/login` hoặc `GET /api/auth/me`.
Timezone: lưu UTC; hiển thị/log `Asia/Ho_Chi_Minh` (+07:00).

## 1. Error format

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Không có quyền thực hiện",
    "details": []
  }
}
```

Mã thường gặp: `UNAUTHENTICATED`, `SESSION_EXPIRED`, `CSRF_INVALID`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`.

## 2. Auth

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập; trả user + csrfToken + permissions |
| GET | `/api/auth/me` | Phiên hiện tại; trả user + csrfToken + permissions |
| POST | `/api/auth/logout` | Đăng xuất; cần CSRF; trả 204 |

## 3. Stations

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/stations?q=&page=&pageSize=` | `stations.view` |
| GET | `/api/stations/:id` | `stations.view` |
| POST | `/api/stations` | `stations.add` |
| PATCH | `/api/stations/:id` | `stations.edit` |
| DELETE | `/api/stations/:id` | `stations.delete` |

Body tạo/sửa: `code`, `name`, `host`, `port`, `connection_type`, `lat`, `lon`, `notes`, `owner_web_user_id`.

## 4. Mountpoints

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/mountpoints?q=&page=&pageSize=` | `mountpoints.view` |
| GET | `/api/mountpoints/:id` | `mountpoints.view` |
| POST | `/api/mountpoints` | `mountpoints.add` |
| PATCH | `/api/mountpoints/:id` | `mountpoints.edit` |
| DELETE | `/api/mountpoints/:id` | `mountpoints.delete` |

Body: `name`, `station_id`, `enabled`, `requires_auth`, `owner_web_user_id`.

## 5. Web users

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/web-users?q=&page=&pageSize=` | `web_users.view` |
| GET | `/api/web-users/:id` | `web_users.view` |
| POST | `/api/web-users` | `web_users.add` |
| PATCH | `/api/web-users/:id` | `web_users.edit` |
| DELETE | `/api/web-users/:id` | `web_users.delete` |
| POST | `/api/web-users/:id/lock` | `web_users.edit` |
| POST | `/api/web-users/:id/unlock` | `web_users.edit` |

Tạo: `username`, `password`, `display_name`, `email`, `role_id`, `parent_user_id`.
Tự sửa (user): chỉ `display_name`, `email`, `password`.
Không quản lý `super_admin`; không tạo/sửa user level >= mình; không xóa chính mình.

## 6. Roles & permissions

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/roles` | `roles.view` |
| POST | `/api/roles` | `roles.add` |
| PATCH | `/api/roles/:id` | `roles.edit` |
| DELETE | `/api/roles/:id` | `roles.delete` |
| GET | `/api/roles/:id/permissions` | `roles.view` |
| PUT | `/api/roles/:id/permissions` | `roles.edit` |
| GET | `/api/permissions` | `roles.view` |

`PUT /api/roles/:id/permissions` body:

```json
{
  "permissions": [
    { "code": "stations.view", "scope": "subtree" },
    { "code": "relay.view", "scope": "own" }
  ]
}
```

Scope: `all | subtree | own | none`.

Role hệ thống (`super_admin`, `admin`, `user`) không sửa/xóa qua API Phase 1.
Role custom: level 1–99; không xóa nếu đang được gán.

## 7. Health

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/health` | Node health + DB + schema version |
| GET | `:7080/health` | Go health + runtime schema version (internal) |

## 8. RBAC mặc định

- `super_admin`: toàn quyền, scope `all`.
- `admin`: subtree cho nghiệp vụ; `roles.view` all; không quản lý `super_admin`.
- `user`: chỉ tài khoản của mình; chỉ `view`/`edit` own.

## 9. Quy ước

- Không dùng lẫn `/api/relay-jobs` và `/api/relay/jobs`; Phase 2 dùng `/api/relay-jobs`.
- Không trả `password_hash` trong bất kỳ response nào.
- Mọi thay đổi quyền/người dùng/trạm/mountpoint/relay job ghi audit đã redact.

## 10. Relay jobs (Phase 2)

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/relay-jobs?q=&page=&pageSize=` | `relay.view` |
| GET | `/api/relay-jobs/:id` | `relay.view` |
| POST | `/api/relay-jobs` | `relay.add` |
| PATCH | `/api/relay-jobs/:id` | `relay.edit` |
| DELETE | `/api/relay-jobs/:id` | `relay.delete` |
| POST | `/api/relay-jobs/:id/enable` | `relay.edit` |
| POST | `/api/relay-jobs/:id/disable` | `relay.edit` |
| POST | `/api/relay-jobs/:id/restart` | `relay.edit` |
| POST | `/api/relay-jobs/:id/test` | `relay.edit` |

Body tạo job:

```json
{
  "externalKey": "optional-unique-key",
  "name": "Relay HN -> HCM",
  "enabled": false,
  "upstream": {
    "host": "caster.example",
    "port": 2101,
    "mount": "UPSTREAM",
    "proxy": "",
    "ssl": false,
    "ntripVersion": "v2"
  },
  "downstream": {
    "host": "caster2.example",
    "port": 2101,
    "mount": "DOWNSTREAM",
    "proxy": "",
    "ssl": false,
    "ntripVersion": "v2"
  },
  "upstreamCredential": { "username": "user", "password": "secret" },
  "downstreamCredential": null,
  "downstreamMode": "auto",
  "lat": 21.0285,
  "lon": 105.8542,
  "uaPrefix": "CORS-MVP",
  "nmeaIntervalSec": 0,
  "origin": "manual",
  "originRef": "",
  "tags": null,
  "ownerWebUserId": null
}
```

- `downstreamMode`: `auto` (POST rồi fallback SOURCE), `post`, `source`.
- Credential: `password` bắt buộc khi tạo mới; khi PATCH, bỏ `password` để giữ secret cũ,
  gửi `null` để gỡ credential.
- Response chỉ trả `credential: { id, username, hasSecret }`; không bao giờ trả
  `password_enc`/`password`.
- `DELETE` là soft-delete (`deleted_at`), job biến mất khỏi list/detail.
- Unique: `externalKey` và cặp `(upstream_key, downstream_key)`;
  `endpointKey = scheme://host:port/mount` đã chuẩn hóa.
- Mọi thao tác ghi tăng `desiredRevision`; Go reconcile và ghi `appliedRevision`.
- Loop guard chỉ phát hiện self-loop và cycle nội bộ theo endpoint key;
  không phát hiện vòng đi qua hệ thống ngoài.

`item.state` (từ `cors_runtime.relay_job_state`):

```json
{
  "runtimeState": "streaming",
  "appliedRevision": 3,
  "lastError": null,
  "lastAppliedAt": "2026-10-30T03:00:00.000Z",
  "updatedAt": "2026-10-30T03:00:01.000Z"
}
```

`runtimeState`: `disabled | pending | connecting | streaming | backoff | error | stopped`.

Lỗi nghiệp vụ: `SELF_LOOP` (409), `LOOP_DETECTED` (409), `DUPLICATE_ENDPOINT` (409),
`CREDENTIAL_PASSWORD_REQUIRED` (400), `INVALID_OWNER` (400), `RELAY_TEST_FAILED` (502).

`POST /:id/test` gọi Go kiểm tra handshake upstream rồi downstream, trả
`{ result: { ok, stage, upstream, downstream, latencyMs, error } }`.

## 11. Internal API Go (không public)

Node gọi Go qua `GO_INTERNAL_URL` (mặc định `http://gnss:7080`). Mọi request ký HMAC:

- `X-Timestamp` (epoch ms), `X-Nonce`, `X-Body-SHA256`, `X-Signature`.
- `signature = HMAC-SHA256(INTERNAL_HMAC_SECRET, method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + bodyHash)`.
- Cửa sổ ±60 giây; nonce chống replay 2 phút.

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/internal/reconcile` | Body `{ jobIds?: number[] }`; reconcile theo revision |
| POST | `/internal/test` | Body `{ jobId }`; handshake test |
| GET | `/internal/snapshot` | Metrics RAM: bytes, frames, CRC errors, state, last data |
