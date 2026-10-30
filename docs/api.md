# API Contract (Phase 1–4)

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
    "port": 1509,
    "mount": "UPSTREAM",
    "proxy": "",
    "ssl": false,
    "ntripVersion": "v2"
  },
  "downstream": {
    "host": "caster2.example",
    "port": 1509,
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
- `DELETE` là soft-delete (`deleted_at`), job biến mất khỏi list/detail;
  `external_key` và cặp key endpoint của row cũ được đổi thành `#deleted:<id>`
  để giải phóng key, tạo lại job cùng cấu hình được phép ngay.
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

## 12. RTCM Quality (Phase 6 — planned, chưa triển khai)

> Kế hoạch chi tiết: `docs/0/RTCM_QUALITY_PLAN.md`.

Quyền mới: `quality.view`, `quality.ack` (scope all/subtree/own).
Quản lý station probe dùng `stations.view` / `stations.edit`.
Áp dụng cho cả **trạm thường** (`targetType=station`, `direction=ingest`) và
**trạm relay** (`targetType=relay_job`, `direction=upstream|downstream`).

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/quality/overview?targetType=&window=&owner=` | Tổng quan score/alert theo scope |
| GET | `/api/stations/:id/quality?mountpointId=&direction=ingest&window=` | Sample/score trạm thường |
| GET | `/api/stations/:id/rtcm/messages?mountpointId=&from=&to=` | Message type/rate trạm |
| GET | `/api/relay-jobs/:id/quality?direction=&window=` | Sample/score upstream/downstream |
| GET | `/api/relay-jobs/:id/rtcm/messages?from=&to=&direction=` | Message type/rate relay |
| GET | `/api/quality/alerts?targetType=&status=open&severity=` | Danh sách cảnh báo |
| POST | `/api/quality/alerts/:id/ack` | Ack cảnh báo; ghi audit |
| GET | `/api/quality/export?targetType=&format=csv&from=&to=` | Export CSV giới hạn dòng |
| GET | `/api/stations/:id/probes` | Danh sách station probe |
| POST | `/api/stations/:id/probes` | Tạo probe GET-only (mặc định disabled) |
| PATCH/DELETE | `/api/station-probes/:id` | Sửa/xóa probe |
| POST | `/api/station-probes/:id/enable` | Bật probe |
| POST | `/api/station-probes/:id/disable` | Tắt probe |

Response quality (rút gọn):

```json
{
  "item": {
    "targetType": "relay_job",
    "targetId": 12,
    "mountpointId": 0,
    "direction": "upstream",
    "ts": "2026-10-30T03:00:00.000Z",
    "score": 86,
    "state": "streaming",
    "frames": 1200,
    "crcErrors": 0,
    "parseErrors": 0,
    "msmEpochs": 120,
    "satellites": 24,
    "signals": 48,
    "cells": 96,
    "avgCnr": 42.5,
    "reportedStationId": 1001,
    "ageMs": 850,
    "gaps": 0
  }
}
```

- `targetType`: `station | relay_job`.
- `direction`: `ingest | upstream | downstream`.
- Không trả raw RTCM/payload, credential, DSN.
- Export CSV có giới hạn dòng + audit.
- Socket.IO: `quality.snapshot`, `quality.updated`, `quality.alert`,
  `quality.alert.ack`; room `station:<id>`/`relay:<id>` sau kiểm tra quyền;
  throttle ~1 s.
- Internal (HMAC): `GET /internal/rtcm/snapshot`, `GET /internal/rtcm/health`.

## 13. NTRIP accounts (Phase 3)

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/ntrip-accounts?q=&page=&pageSize=` | `ntrip_accounts.view` |
| GET | `/api/ntrip-accounts/:id` | `ntrip_accounts.view` |
| POST | `/api/ntrip-accounts` | `ntrip_accounts.add` |
| PATCH | `/api/ntrip-accounts/:id` | `ntrip_accounts.edit` |
| DELETE | `/api/ntrip-accounts/:id` | `ntrip_accounts.delete` |
| POST | `/api/ntrip-accounts/:id/lock` | `ntrip_accounts.edit` |
| POST | `/api/ntrip-accounts/:id/unlock` | `ntrip_accounts.edit` |
| GET | `/api/ntrip-accounts/:id/mountpoints` | `ntrip_accounts.view` |
| PUT | `/api/ntrip-accounts/:id/mountpoints` | `ntrip_accounts.edit` |

Body tạo/sửa: `username`, `password`, `enabled`, `max_connections`,
`owner_web_user_id`. Response không trả `password_hash`.
ACL body: `{ "mountpointIds": [1, 2] }`; placeholder cho Phase 4.

## 14. Caster listeners (Phase 4 — planned)

- Port mặc định **1509** cho source và rover; tùy chỉnh theo listener.
- Một mountpoint có thể gắn nhiều listener: A,B,C→1509; A,C→1508.
- Không dùng 2101/8081.

| Method | Endpoint | Quyền |
|---|---|---|
| GET/POST | `/api/caster/listeners` | `settings.view` / `settings.edit` |
| GET/PATCH/DELETE | `/api/caster/listeners/:id` | `settings.view` / `settings.edit` |
| POST | `/api/caster/listeners/:id/enable` | `settings.edit` |
| POST | `/api/caster/listeners/:id/disable` | `settings.edit` |
| GET/PUT | `/api/caster/listeners/:id/mountpoints` | `settings.view` / `settings.edit` |
| GET | `/api/connections` | `connections.view` |
| DELETE | `/api/connections/:id` | `connections.delete` |

Body listener: `name`, `port`, `enabled`, `role` (`both|source|rover`),
`description`. Body gắn mountpoint: `{ "mountpointIds": [1, 2] }`.

## 15. Realtime, history, alerts (Phase 5)

Socket.IO dùng chung origin, path `/socket.io`, xác thực bằng cookie session
`cors_sid` (không JWT/token URL). Room `user:<id>`; room `relay:<id>` và `caster`
chỉ join qua sự kiện `subscribe` sau khi kiểm tra quyền + scope. Payload lọc theo
`relay.view`, `connections.view`, `stations.view`, `alerts.view`.
Throttle ~1 giây; reconnect nhận `snapshot` mới.

Sự kiện: `snapshot`, `relay.updated`, `relay.session`, `connection.updated`,
`alert.created`, `auth.revoked`.

| Method | Endpoint | Quyền |
|---|---|---|
| GET | `/api/snapshot` | Đăng nhập; mỗi mục lọc theo quyền |
| GET | `/api/alerts?status=&severity=&targetType=&q=&page=&pageSize=` | `alerts.view` |
| GET | `/api/alerts/:id` | `alerts.view` |
| POST | `/api/alerts/:id/ack` | `alerts.ack`; body `{ note? }`; ghi audit |
| GET | `/api/history/sessions?jobId=&from=&to=&page=&pageSize=` | `relay.view` |
| GET | `/api/history/events?jobId=&from=&to=&type=&page=&pageSize=` | `relay.view` |
| GET | `/api/history/hourly?jobId=&from=&to=&page=&pageSize=` | `relay.view` |

- `from`/`to` dùng ISO-8601 UTC; UI quy đổi +07.
- History đọc `cors_runtime.relay_sessions/relay_events/relay_hourly`; Node không
  ghi runtime.
- Alert do polling Node tạo khi relay `backoff`/`error` hoặc Go/caster không
  phản hồi; cooldown 5 phút; ack không tự tắt job.
- Migration: `db/migrations/admin/005_alerts_settings.sql` (admin schema 5).
- Ops: xem `docs/OPS.md` (backup/restore, load test mock, log/health).

## 16. Planned API Phase 7–12 (chưa triển khai)

> Các endpoint dưới đây là hợp đồng dự kiến; chỉ đánh dấu DONE khi có code + test.

| Method | Endpoint | Quyền / ghi chú |
|---|---|---|
| POST | `/api/stations/import` | `stations.add`; `.xlsx`; preview/validate/audit |
| GET | `/api/stations/export` | `stations.view`; `.xlsx`; theo filter |
| POST | `/api/ntrip-accounts/import` | `ntrip_accounts.add`; `.xlsx`; không password |
| GET | `/api/ntrip-accounts/export` | `ntrip_accounts.view`; `.xlsx`; không password |
| POST | `/api/mountpoints/import` | `mountpoints.add`; `.xlsx` |
| GET | `/api/mountpoints/export` | `mountpoints.view`; `.xlsx` |
| POST | `/api/caster/listeners/import` | `settings.edit`; `.xlsx` |
| GET | `/api/caster/listeners/export` | `settings.view`; `.xlsx` |
| POST | `/api/relay-jobs/import` | `relay.add`; `.xlsx` |
| GET | `/api/relay-jobs/export` | `relay.view`; `.xlsx` |
| POST | `/api/roles/import` | `roles.add`; role + matrix; role hệ thống khóa |
| GET | `/api/roles/export` | `roles.view`; `.xlsx` |
| POST | `/api/web-users/import` | `web_users.add`; `.xlsx`; không cột password; mật khẩu 123456 |
| GET | `/api/web-users/export` | `web_users.view`; `.xlsx`; không password |
| GET | `/api/online/accounts` | `connections.view`; danh sách online + cờ có/không tọa độ |
| GET | `/api/online/stations` | `stations.view`; trạng thái trạm realtime cho map |
| GET | `/api/profile` | Đăng nhập; hồ sơ cá nhân |
| PATCH | `/api/profile` | Đăng nhập; allowlist display_name/email/phone/avatar |
| POST | `/api/profile/password` | Đăng nhập; mật khẩu hiện tại + mới |
| GET | `/api/profile/sessions` | Đăng nhập; phiên hiện tại |
| GET | `/api/dictionaries?code=` | Đăng nhập; dictionary cho select |
| GET | `/api/audit-logs?module=&from=&to=&q=` | `audit.view`; redaction |
