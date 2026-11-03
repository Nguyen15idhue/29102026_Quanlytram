# BỘ PROMPT THỰC HIỆN KẾ HOẠCH SỬA LỖI TRƯỚC DEPLOY

- **Kế hoạch nguồn:** `docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md` (commit nền `5f349fe`)
- **Quy tắc bắt buộc:** `AGENTS.md`
- **Số mục:** 34 (16 `FIX-xx` + 18 `SEC-Fxx`), chia 5 đợt theo §4 của kế hoạch
- **Commit:** 14 lô (C1–C14), gộp các sửa nhỏ cùng vùng; chỉ migration/auth/crypto/hạ tầng mới tách riêng
- **Bảng tiến độ bền (nguồn sự thật khi treo phiên):** `docs/2/THUC_HIEN_FIX_LOI.md`
- **Nhật ký:** `SESSION.md`; **checklist phase:** `TASKS.md`

---

## 0. Cách dùng

| Bước | Việc làm |
|---|---|
| 1 | Dán **P0** vào phiên mới. Agent tự chạy hết 5 đợt, không cần can thiệp. |
| 2 | Nếu phiên bị ngắt (hết context, mất mạng): dán **P7** để khôi phục, agent đọc bảng tiến độ và chạy tiếp từ mục đầu tiên chưa `DONE`. |
| 3 | Nếu muốn chạy từng đợt: dán **P0** rồi lần lượt **P1 → P5**; cuối cùng **P6**. |
| 4 | Các prompt phụ (§6) chỉ dán khi cần siết một khía cạnh (graphify, PowerShell, commit...). Không cần dán nếu đã dùng P0 vì P0 đã nhúng sẵn. |

**Nguyên tắc bất di bất dịch:** mỗi mục đi đúng 7 bước
`check tài liệu → code → test/fix → cập nhật tài liệu → cập nhật todos → commit → push`,
rồi mới sang mục kế tiếp. Commit gộp theo lô (34 mục → 14 commit, §10.5):
mục nhỏ cùng vùng chờ chung một commit, chỉ mục trọng yếu mới tách riêng.

---

## 1. Bảng tiến độ đích (todo tổng — 34 mục)

Thứ tự dưới đây là thứ tự thực thi, không được đảo (phụ thuộc kỹ thuật và mức ưu tiên).
Mỗi dòng là **một todo độc lập**, không gộp.

### Đợt 1 — Blocker vận hành (6)

| # | ID | Lô | Nội dung ngắn | Test trọng tâm |
|---|---|---|---|---|
| 1 | FIX-01 | C1 | COUNT mountpoint thiếu JOIN `stations` → 500 khi `q` | vitest route + Playwright `mountpoint-explorer` |
| 2 | FIX-02 | C2 | Caster source không có idle timeout | `go test ./internal/caster` với `net.Pipe` |
| 3 | FIX-03 | C2 | Station source idle 30s cứng → reconnect liên tục | Go test cadence 60s/1s/im lặng |
| 4 | FIX-04 | C3 | Đổi config relay chỉ chờ 2s → 2 session song song | Go test mock downstream từ chối thứ 2 |
| 5 | FIX-05 | C3 | Trần 50 kết nối/IP chặn fan-in 100 trạm | Go test 150 source cùng IP |
| 6 | FIX-06 | C3 | Rover `ReadString` không giới hạn → OOM | Go test 10MB không newline, RSS ổn định |

### Đợt 2 — Bảo mật tài khoản (4)

| # | ID | Lô | Nội dung ngắn | Test trọng tâm |
|---|---|---|---|---|
| 7 | SEC-F02 | C4 | Seed ghi đè `status`/role/company | vitest seed + lock user rồi seed lại |
| 8 | SEC-F04 | C4 | Tái dùng credential trạm cho host khác | vitest + SSRF `169.254.169.254` |
| 9 | SEC-F07 | C4 | Import user bỏ qua `assertCanTarget` | vitest leo cấp + subtree |
| 10 | SEC-F01 | C5 | `123456` không buộc đổi lần đầu | migration admin 36 + vitest + Playwright auth |

### Đợt 3 — Production hardening (6)

| # | ID | Lô | Nội dung ngắn | Test trọng tâm |
|---|---|---|---|---|
| 11 | SEC-F10 | C6 | Cookie production + fail-fast | vitest config/Set-Cookie |
| 12 | SEC-F13 | C6 | Audit nuốt lỗi + thiếu audit login | vitest audit/login |
| 13 | SEC-F09 | C6 | `trust proxy` vô điều kiện | vitest XFF giả |
| 14 | SEC-F18 | C6 | Login lộ trạng thái tài khoản (timing) | vitest dummy Argon2, đo thời gian |
| 15 | SEC-F06 | C7 | Thiếu throttle xác thực sai ở caster | Go test 20 lần sai / 150 hợp lệ |
| 16 | SEC-F03 | C7 | Caster plaintext + publish 0.0.0.0 | test TLS/bind + `docker compose config` |

### Đợt 4 — Trung bình (8)

| # | ID | Lô | Nội dung ngắn | Test trọng tâm |
|---|---|---|---|---|
| 17 | FIX-07 | C8 | Cờ pause bị ghi đè, treo `paused_by_*` | vitest đua pause/resume |
| 18 | FIX-08 | C8 | Alert không resolve khi xoá trạm/relay | vitest + đếm alert |
| 19 | FIX-09 | C8 | Realtime mất relay khi Go timeout | vitest fallback `stale` |
| 20 | FIX-10 | C8 | History relay trộn chiều | vitest `direction` |
| 21 | FIX-11 | C9 | Source ngắt đóng rover ngay | Go test grace |
| 22 | FIX-12 | C9 | Reconcile trước `Run` → panic | Go test + recover handler |
| 23 | FIX-13 | C9 | 1 credential lỗi hỏng cả `LoadAll` | Go test 1 hỏng + 5 tốt |
| 24 | FIX-14 | C9 | 2 job cùng downstream | Go + API 409 `DOWNSTREAM_BUSY` |

### Đợt 5 — Low/hardening (10)

| # | ID | Lô | Nội dung ngắn | Test trọng tâm |
|---|---|---|---|---|
| 25 | FIX-15 | C10 | Monitor/backoff/lastSessionId sai | Go + vitest socket |
| 26 | FIX-16 | C10 | Bucket timeline nhìn trước, uptime sai mẫu số | vitest timeline/uptime |
| 27 | SEC-F08 | C11 | `mapConfig` thiếu CSRF | vitest 403 |
| 28 | SEC-F15 | C11 | `/api/map/tiles` thiếu quyền | vitest 403/429 |
| 29 | SEC-F19 | C11 | `/health` lộ `err.message` | vitest payload |
| 30 | SEC-F21 | C11 | Audit scope `own` dùng subtree | vitest |
| 31 | SEC-F14 | C12 | Go HTTP thiếu timeout | Go test slowloris |
| 32 | SEC-F12 | C12 | MySQL TLS khi DB ngoài host | config test |
| 33 | SEC-F05 | C13 | AES-GCM thiếu AAD/rotation | Go + Node round-trip |
| 34 | SEC-F11 | C14 | Compose chạy Vite dev | `curl -I` header + non-root |

---

## 2. P0 — PROMPT GỐC (dán một lần, chạy toàn bộ)

```text
BẠN LÀ KỸ SƯ TRIỂN KHAI CHÍNH của dự án CORS/NTRIP/RTCM tại
F:\3.Laptrinh\1. Project\1. GNSS\29102026_Quanlytram.

NHIỆM VỤ
Thực thi trọn vẹn kế hoạch docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md: 34 mục
(16 FIX-xx + 18 SEC-Fxx) theo đúng 5 đợt ở §4, đến khi tất cả PASS.
Không dừng giữa chừng, không xin xác nhận cho quyết định kỹ thuật thông
thường, không báo cáo giữa các mục. Chỉ dừng khi gặp đúng một trong các
điều kiện ở mục "ĐIỀU KIỆN DỪNG" bên dưới.

NGUỒN SỰ THẬT (thứ tự ưu tiên khi mâu thuẫn)
1. AGENTS.md (bất biến, bảo mật, stack, thời gian).
2. docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md (phạm vi + nghiệm thu từng mục).
3. docs/2/BAO_MAT_MA_NGUON.md (gốc F-xx) và docs/2/PHAN_QUYEN.md (RBAC).
4. docs/0/*.md và docs/1/*.md liên quan trực tiếp mục đang làm.
5. Mã nguồn hiện tại.

THIẾT LẬP PHIÊN (làm một lần, gộp tool call độc lập trong cùng lượt)
- Dùng graphify trước khi grep: `graphify query "<câu hỏi hẹp>" --budget 3000`
  (Ambiguous → dùng `path::symbol`).
  Chỉ đọc GRAPH_REPORT.md khi cần kiến trúc tổng thể; không đọc toàn repo.
- Đọc: AGENTS.md (đã có trong context thì bỏ qua), kế hoạch, TASKS.md §1,
  60 dòng cuối SESSION.md, `git status`, `git log -5`.
- Kiểm tra `docs/2/THUC_HIEN_FIX_LOI.md`:
  • Chưa có → tạo mới từ mẫu §10.4 (đủ 34 dòng, trạng thái TODO).
  • Đã có → đọc bảng, coi đó là tiến độ thật.
- Tạo todo phiên (nếu harness hỗ trợ): 5 todo lớn theo 5 đợt. Khi vào một
  đợt thì mở chi tiết từng ID của đợt đó. Todo phiên chỉ là bản phản chiếu;
  bảng trong THUC_HIEN_FIX_LOI.md mới là bản bền.
- Chạy baseline một lần để biết điểm xuất phát (được phép FAIL nếu lỗi có sẵn,
  ghi lại): `cd server; npm run build; npm test` ; `cd gnss; go build ./...;
  go vet ./...; go test ./...` ; `cd frontend; npm run build`.

VÒNG LẶP BẮT BUỘC CHO TỪNG MỤC (đúng thứ tự, không gộp bước)
B1. CHECK TÀI LIỆU
    - Đọc đúng mục trong kế hoạch (§2 hoặc §3) + mục F-xx gốc trong
      BAO_MAT_MA_NGUON.md (nếu là SEC) + tài liệu thiết kế liên quan.
    - graphify: query/explain quanh symbol sẽ sửa; đọc mã chỉ với
      offset/limit hoặc grep, không đọc cả file lớn.
    - Ghi vào todo/bảng: file sẽ chạm, cách sửa, lệnh test, rủi ro.
      Nếu phát hiện cách sửa trong kế hoạch không khả thi, chọn phương án
      tương đương tốt hơn và ghi lý do; không mở rộng phạm vi.
B2. THỰC HIỆN
    - Diff nhỏ nhất, theo pattern sẵn có, không thêm dependency/dịch vụ,
      không đổi stack, không refactor ngoài phạm vi.
    - Tuân thủ AGENTS.md: UTC khi lưu, +07 khi hiển thị/log; không log
      secret/DSN/Authorization; RBAC kiểm ở server; migration chỉ do Node.
    - Không chạm relayrtcm/backup, không chạy relay.exe, không chiếm
      8081/2101; NTRIP/RTCM phải mock-first.
B3. TEST THEO CHECKLIST + FIX
    - Chạy đúng "Test"/"Nghiệm thu" của mục, cộng gate tối thiểu:
      server: `npm run build && npm test`
      gnss:   `go build ./... && go vet ./... && go test ./...`
      frontend: `npm run build`
    - Có hành vi mới → thêm unit/integration test tương ứng, không sửa
      test cũ để né lỗi.
    - FAIL → sửa ngay trong mục, tối đa 3 vòng. Vẫn FAIL → vào ĐIỀU KIỆN DỪNG.
    - Log dài: ghi ra file tạm, chỉ in ≤40 dòng cuối hoặc đúng phần FAIL.
B4. CẬP NHẬT TÀI LIỆU TƯƠNG ỨNG
    - KE_HOACH: bảng §1.1/§1.2 đổi trạng thái "Còn" → "Đã sửa (commit <hash>)";
      thêm khối "Trạng thái thực hiện" ngay dưới mục với: ngày, commit,
      file đã sửa, bằng chứng test (lệnh + kết quả), khác biệt so với kế hoạch.
    - SESSION.md: thêm bullet ngắn "FIX-xx DONE: ... cách chạy ...".
    - TASKS.md: chỉ cập nhật checklist liên quan (nếu mục thuộc phase 12/P0).
    - Không viết lại báo cáo gốc BAO_MAT_MA_NGUON.md; chỉ ghi chú trạng thái
      nếu cần, giữ nguyên nội dung lịch sử.
B5. CẬP NHẬT TODOS (bắt buộc, không được bỏ)
    - Đánh dấu DONE cho đúng ID trong todo phiên VÀ trong
      docs/2/THUC_HIEN_FIX_LOI.md (hash lô Cx hoặc "chờ lô", bằng chứng,
      thời điểm +07).
    - Thêm dòng "Tiếp theo: <ID kế tiếp>". Nếu có mục phát sinh, thêm vào
      bảng với trạng thái BLOCKED/NOTE, không đổi thứ tự 34 mục gốc.
    - Không chuyển mục khi bước này chưa xong.
B6. COMMIT + PUSH (theo lô, không commit lẻ từng mục)
    - Áp dụng kế hoạch lô ở §10.5: 34 mục → 14 commit. Mục nhỏ cùng vùng
      gộp chung một commit; chỉ mục có migration, auth/RBAC/crypto, hạ tầng
      triển khai hoặc diff lớn mới tách commit riêng.
    - Kết thúc một mục: nếu là mục cuối của lô → chạy test gate của lô rồi
      commit + push ngay. Nếu chưa → ghi "chờ lô Cx" vào bảng, cập nhật todo,
      sang mục kế tiếp; TUYỆT ĐỐI không commit lẻ.
    - `git add` chỉ file thuộc lô (kể cả tài liệu vừa cập nhật); không add
      .env.local, graphify-out, file tạm.
    - Message: `<type>(<scope>): <mô tả tiếng Việt> (<ID1>, <ID2>, ...)`
      type ∈ fix|feat|perf|refactor|test|docs|chore|security.
      Ví dụ: `fix(gnss): idle timeout và giới hạn đọc caster/station source
      (FIX-02, FIX-03, FIX-06)`
    - Body: 2–6 dòng: nguyên nhân chung, các mục trong lô, lệnh test + kết quả,
      rủi ro/rollback.
    - Push ngay sau mỗi commit. Lỗi mạng/auth: thử lại 3 lần; vẫn lỗi thì ghi
      NOTE vào bảng, tiếp tục và báo ở báo cáo cuối. Xung đột merge/rebase
      cần người quyết → ĐIỀU KIỆN DỪNG.
    - Lô còn mục FAIL thì chưa commit; sửa cho PASS rồi mới commit. Nếu buộc
      phải tách lô để gỡ rối, tách tối đa 1 lần và ghi lý do vào bảng.
B7. SANG MỤC n+1 (quay lại B1).

GATE CUỐI MỖI ĐỢT (bắt buộc, trước khi đánh dấu đợt DONE)
1. `cd server; npm run build; npm test`
2. `cd gnss; go build ./...; go vet ./...; go test ./...`
3. `cd frontend; npm run build`
4. Playwright các spec liên quan nếu stack đang chạy:
   `cd frontend; npx playwright test tests/<spec>.spec.ts`
   (tối thiểu: relay-state, station-detail, timeline, mountpoint-explorer,
   p1-rbac, station-source, quality, auth-password-only — chọn theo đợt)
5. `docker compose config --quiet` nếu có sửa compose/env.
6. Không secret trong diff: `git diff --cached | Select-String -Pattern
   'password|secret|token|Authorization'` (đọc kết quả, không in giá trị).
FAIL gate → sửa ngay trong đợt, không sang đợt sau.

QUY TẮC TIẾT KIỆM TOKEN
- graphify trước, grep sau, đọc theo dải dòng; không đọc lại file đã đọc.
- Gộp tool call độc lập trong một lượt; không in toàn bộ log/diff.
- Không dán code dài vào chat; ghi thẳng vào file.
- Không chạy `graphify update .` cho từng mục; chỉ chạy khi thay đổi cấu trúc
  lớn (cuối đợt 4 và cuối đợt 5), hoặc khi graph lệch rõ ràng.
- Quyết định và lý do ghi vào bảng tiến độ, không giữ trong đầu.

QUY TẮC UI (khi mục có chạm frontend)
- Dialog/Drawer cho CRUD, AlertDialog cho xoá, không `window.confirm`.
- Bảng phân trang server-side; filter/page lưu URL; icon lucide 16–20px.
- Dark mode dùng token, không hardcode màu; a11y: focus trap, Esc, aria,
  contrast AA; kiểm 1440/768/390 nếu có thay đổi bố cục.

QUY TẮC SCRIPT POWERSHELL (nếu phải tạo/sửa .ps1)
- UTF-8 CÓ BOM, comment-based help tiếng Việt đủ dấu, không mojibake.
- `#Requires -Version 5.1`, `Set-StrictMode -Version Latest`,
  `$ErrorActionPreference = 'Stop'`.
- Thông báo chuẩn: `[BƯỚC]`, `[ĐẠT]`, `[LỖI]`, `[BỎ QUA]`, `[CẢNH BÁO]`.
- Mặc định `-DryRun` cho thao tác ghi/xoá; không in secret; exit code 0/1.
- Tự kiểm tra sau khi ghi: BOM đúng, không còn ký tự `�`, chạy thử `-DryRun`.

ĐIỀU KIỆN DỪNG (chỉ 4 trường hợp, ngoài ra tự quyết và đi tiếp)
D1. Một mục FAIL quá 3 vòng sửa mà không tìm ra nguyên nhân gốc.
D2. Cần quyền đặc biệt: endpoint NTRIP thật ngoài allowlist, chứng chỉ/TLS
    production, thao tác phá huỷ DB, mở cổng 2101/8081, chạm relay backup.
D3. Git: xung đột merge/rebase, force-push, mất commit, remote từ chối quyền.
D4. Rò rỉ secret hoặc sự cố bảo mật trong lúc làm.
Khi dừng: nêu rõ ID, lỗi, đã thử gì, 2–3 phương án, đề xuất; cập nhật bảng
trạng thái BLOCKED trước khi hỏi.

BÁO CÁO CUỐI (chỉ sau khi cả 34 mục xong hoặc gặp ĐIỀU KIỆN DỪNG)
- Bảng 34 dòng: ID | lô | trạng thái | commit | test PASS/FAIL | ghi chú.
- Kết quả 4 gate + Playwright + compose config.
- Việc phát sinh, khác biệt so với kế hoạch, rủi ro còn lại, việc cần CI Linux
  (`go test -race`).
- Xác nhận: không secret trong diff, SESSION.md + TASKS.md đã cập nhật,
  bảng tiến độ khớp commit cuối.
Bắt đầu ngay từ mục 1 (FIX-01). Không hỏi lại nếu không thuộc D1–D4.
```

---

## 3. P1 — Đợt 1: Blocker vận hành (FIX-01 → FIX-06)

```text
Tiếp tục kế hoạch theo P0. Thực hiện Đợt 1, đúng thứ tự:
FIX-01 → FIX-02 → FIX-03 → FIX-04 → FIX-05 → FIX-06.

Siết nghiệm thu đợt này:
- FIX-01: tái hiện `GET /api/mountpoints?q=DOCS` trước khi sửa (500), sau sửa
  200 và `total` khớp; rà thêm mọi route phân trang có alias `s.` trong WHERE.
- FIX-02: source im lặng bị đóng đúng `CASTER_SOURCE_IDLE_TIMEOUT_SEC`
  (mặc định 60s), slot giải phóng, source mới vào được; log không lộ secret.
- FIX-03: `STATION_SOURCE_IDLE_TIMEOUT_SEC` mặc định 90–120s, clamp ≥30s;
  test cadence 60s không ngắt, cadence 1s không ngắt, im lặng thì timeout.
- FIX-04: chờ `job.done` có kiểm soát; quá hạn thì không start job mới;
  test 10 lần đổi config không có 2 session chồng thời gian, không 409.
- FIX-05: bỏ/nâng trần per-IP cho kết nối hợp lệ, giữ trần tổng 500;
  test 150 source cùng IP PASS; chừa chỗ cho SEC-F06 (throttle lỗi xác thực).
- FIX-06: giới hạn dòng NMEA (~1KB), deadline rover, `recover()` goroutine;
  test 10MB không newline → đóng `protocol_error`, kết nối khác không ảnh hưởng.

Gate cuối đợt: server build+test, gnss build+vet+test, frontend build,
Playwright `mountpoint-explorer` + `station-source` (nếu stack chạy).
Cập nhật bảng tiến độ + SESSION.md + KE_HOACH, commit/push theo lô C1–C3.
Sau khi gate PASS: đánh dấu Đợt 1 DONE trong todo rồi làm tiếp Đợt 2, không dừng.
```

---

## 4. P2 — Đợt 2: Bảo mật tài khoản (SEC-F02, F04, F07, F01)

```text
Tiếp tục theo P0. Thực hiện Đợt 2 đúng thứ tự:
SEC-F02 → SEC-F04 → SEC-F07 → SEC-F01.

Ràng buộc riêng:
- SEC-F02: seed chỉ `ON DUPLICATE KEY UPDATE id=id` hoặc gate
  `SEED_ENABLED` + `NODE_ENV!=='production'`; audit khi tạo mới.
  Test: lock user1 → seed → vẫn locked; đổi role → seed → không đổi.
- SEC-F04: chỉ dùng credential đã lưu khi host/port/TLS trùng
  `station_sources`; khác thì bắt nhập lại. Chặn 169.254/16, 127/8, ::1,
  multicast; giữ RFC1918; resolve DNS và kiểm tra toàn bộ IP; audit + throttle.
- SEC-F07: gọi `assertCanTarget` cho từng dòng import trước UPDATE; thiếu
  quyền chỉ cho sửa display_name/email hoặc skip; audit per-row/diff.
- SEC-F01: migration admin mới (36), cột `must_change_password`; chặn API
  nghiệp vụ trừ `/profile`; banner UI; test user import đăng nhập chỉ vào
  được trang đổi mật khẩu.
Đọc docs/2/PHAN_QUYEN.md trước khi sửa RBAC.

Gate cuối đợt: server build+test, frontend build, Playwright `p1-rbac` +
`auth-password-only`; migration chạy được trên DB test (`npm run migrate`)
và idempotent. Cập nhật tài liệu + todo + commit/push theo lô C4–C5, rồi sang Đợt 3.
```

---

## 5. P3 — Đợt 3: Production hardening (SEC-F10, F13, F09, F18, F06, F03)

```text
Tiếp tục theo P0. Thực hiện Đợt 3 đúng thứ tự:
SEC-F10 → SEC-F13 → SEC-F09 → SEC-F18 → SEC-F06 → SEC-F03.

Quyết định mặc định để không phải dừng (ghi vào bảng tiến độ):
- Mô hình triển khai mặc định: nội bộ/VPN. SEC-F03 làm cả hai đường:
  (a) bind caster theo `CASTER_BIND_IP` (mặc định 127.0.0.1 trong compose
  production, không publish 0.0.0.0), (b) TLS listener tùy chọn bật bằng
  `CASTER_TLS_CERT/KEY`, plaintext bị từ chối khi bật TLS.
- SEC-F10: fail-fast khi `NODE_ENV=production` và `SESSION_COOKIE_SECURE!=='true'`;
  tiền tố `__Host-` khi HTTPS; HSTS ở nginx.
- SEC-F13: audit retry có giới hạn + log error; audit login success/fail/
  lock/logout kèm IP/UA đã redact.
- SEC-F09: chỉ bật `trust proxy` khi có `TRUST_PROXY`; mặc định tắt.
- SEC-F18: verify Argon2 giả khi không tìm thấy user; trả cùng
  `INVALID_CREDENTIALS`; audit login fail; test thời gian tương đương.
- SEC-F06: throttle theo (username, IP) + toàn cục, chỉ áp khi sai; 20 lần sai
  → backoff; 150 source hợp lệ cùng IP vẫn PASS.

Gate cuối đợt: server build+test, gnss build+vet+test, `docker compose config
--quiet`, Playwright `auth-password-only` + `system-health` nếu chạy được.
Cập nhật tài liệu + todo + commit/push theo lô C6–C7, rồi sang Đợt 4.
```

---

## 6. P4 — Đợt 4: Trung bình (FIX-07 → FIX-14)

```text
Tiếp tục theo P0. Thực hiện Đợt 4 đúng thứ tự:
FIX-07 → FIX-08 → FIX-09 → FIX-10 → FIX-11 → FIX-12 → FIX-13 → FIX-14.

Ràng buộc riêng:
- FIX-07: transaction + `SELECT ... FOR UPDATE`; chỉ xoá cờ đúng nguồn và khi
  `locked=0`; reset `paused_by_station_id` khi đổi/bỏ station_id; giữ
  `desired_revision`; test đua pause/resume và ma trận trạng thái 14 test.
- FIX-08: resolve alert khi soft-delete/hard-delete trạm & relay; thêm job dọn
  alert mồ côi; test đếm alert trước/sau.
- FIX-09: `goOk=false` → dựng snapshot từ `relay_job_state` + cấu hình, cờ
  `stale=true`, cache TTL 10s; UI banner, không xoá row/marker.
- FIX-10: thêm `direction` (mặc định upstream) cho series history; UI 2 series
  hoặc bộ lọc; test số event "state changed" đúng.
- FIX-11: grace 5–15s (`CASTER_SOURCE_GRACE_SEC`); rover giữ session, không
  gửi byte rác; quá grace mới đóng.
- FIX-12: `rootCtx` mặc định `Background` trong Run/Reconcile + `recover()`
  ở handler internal; test reconcile trước Run không panic.
- FIX-13: bỏ qua credential lỗi, log `relay_job_id` + lý do, không log
  ciphertext; health trả `degraded`; test 1 hỏng + 5 tốt.
- FIX-14: chặn trùng `downstream_key`; API 409 `DOWNSTREAM_BUSY`; import báo
  lỗi theo dòng; UI cảnh báo trước khi lưu.

Gate cuối đợt: server build+test, gnss build+vet+test, frontend build,
Playwright `relay-state` + `station-detail` + `quality` + `timeline`.
Chạy `graphify update .` một lần sau khi xong đợt (thay đổi cấu trúc).
Cập nhật tài liệu + todo + commit/push theo lô C8–C9, rồi sang Đợt 5.
```

---

## 7. P5 — Đợt 5: Low/hardening (10 mục)

```text
Tiếp tục theo P0. Thực hiện Đợt 5 đúng thứ tự:
FIX-15 → FIX-16 → SEC-F08 → SEC-F15 → SEC-F19 → SEC-F21 →
SEC-F14 → SEC-F12 → SEC-F05 → SEC-F11.

Ràng buộc riêng:
- FIX-15: reset monitor đầu session; `backoff.Reset()` trước `Next()`;
  `lastSessionId` = max(id) của dòng đã fetch + phân trang.
- FIX-16: mẫu trong `[at-window, at)`; mẫu số là thời gian có quan sát;
  tổng bucket khớp summary; kiểm tra lệch `ts` 2 chiều.
- SEC-F08: CSRF cho `mapConfigRouter` sau `requireAuth`; test 403.
- SEC-F14: `ReadTimeout 10s`, `WriteTimeout 30s`, `IdleTimeout 60s`,
  `MaxHeaderBytes 16KB`; test slowloris.
- SEC-F15: `requirePermission('map','view')` + rate-limit theo user; 403/429.
- SEC-F19: `/health` chỉ `{status, db}`, chi tiết vào log/endpoint nội bộ.
- SEC-F21: `idsFor('own')` trả `[userId]`, không subtree.
- SEC-F05: AAD `table:column:recordId`, payload `v2:keyid:...`, hỗ trợ 2 khoá;
  test hoán ciphertext giữa 2 bản ghi → decrypt fail. Tương thích ngược dữ liệu cũ.
- SEC-F12: TLS chỉ khi DB ngoài host; giữ nguyên Docker network; không log DSN.
- SEC-F11: dùng `frontend/Dockerfile` + nginx, bỏ bind mount; CSP/XFO/HSTS;
  non-root; kiểm `curl -I` và user trong container.

Gate cuối đợt: đủ 4 gate của P0 + Playwright toàn bộ spec liên quan UI đã chạm
(`ui`, `map-config`, `metrics-health`, `system-ops`, `navigation`) + audit
`git log` 14 commit theo lô C1–C14. Chạy `graphify update .` lần cuối.
Cập nhật tài liệu + todo + commit/push theo lô C10–C14.
```

---

## 8. P6 — Prompt chốt và báo cáo cuối

```text
Đã xong 5 đợt. Thực hiện bước chốt:
1. Đối chiếu bảng tiến độ với `git log --oneline` từ commit nền 5f349fe:
   đủ 34 mục, mỗi mục ánh xạ đúng vào lô C1–C14, có bằng chứng test.
2. Chạy lại toàn bộ gate lần cuối trên trạng thái sạch:
   server build+test, gnss build+vet+test, frontend build,
   Playwright các spec liên quan, `docker compose config --quiet`.
3. Kiểm secret trong toàn bộ diff từ 5f349fe đến HEAD.
4. Cập nhật TASKS.md (checklist phase 12/P0 tương ứng), SESSION.md (tổng kết
   đợt, cách chạy, việc còn lại), bảng tiến độ (cột trạng thái cuối).
5. Báo cáo theo mẫu P0: bảng 34 dòng, gate PASS/FAIL, việc phát sinh, rủi ro,
   `go test -race` cần CI Linux, xác nhận đã push.
Không tuyên bố DONE nếu còn FAIL chưa xử lý hoặc thiếu bằng chứng.
```

---

## 9. P7 — Prompt khôi phục khi phiên bị ngắt

```text
Phiên trước bị ngắt giữa kế hoạch docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md.
Khôi phục tối thiểu token:
1. Đọc docs/2/THUC_HIEN_FIX_LOI.md, `git log --oneline -15`, `git status`.
2. Xác định mục đầu tiên chưa DONE; đối chiếu commit thực tế (nếu bảng ghi
   DONE mà chưa có commit/push thì làm lại bước commit/push, không làm lại code).
3. Dựng lại todo 5 đợt từ bảng, đánh dấu các mục DONE.
4. Chạy gate nhanh của đợt đang dở; nếu FAIL do mục trước, sửa trước.
5. Tiếp tục vòng lặp B1–B7 của P0. Không đọc lại toàn repo, không làm lại
   việc đã có commit.
```

---

## 10. Prompt phụ

### 10.1. Graphify tiết kiệm token

```text
Trước khi grep/đọc file, chạy graphify (đã có `graphify-out/graph.json`):
- `graphify query "<câu hỏi hẹp>" --budget 3000`
- Nếu báo `Ambiguous` → `graphify query "server/src/routes/mountpoints.ts::mountpointsRouter"`
  hoặc dùng đúng `id` node mà kết quả liệt kê.
- `graphify explain "<symbol>"` khi cần hàng xóm của một node.
- `graphify path "<A>" "<B>"` khi cần truy vết chuỗi gọi.
Chỉ mở file mà kết quả trả về; đọc offset/limit; không đọc GRAPH_REPORT.md
trừ câu hỏi kiến trúc tổng. Không chạy `graphify update .` mỗi mục.
Trả lời dựa trên graph + dải dòng đã đọc, không suy đoán.
```

### 10.2. Chuẩn script PowerShell tiếng Việt

```text
Mọi .ps1 mới/sửa phải:
- Lưu UTF-8 CÓ BOM (PowerShell 5.1 đọc đúng dấu). Không dùng ANSI.
- Comment-based help tiếng Việt đủ dấu; thông báo `[BƯỚC] [ĐẠT] [LỖI]
  [CẢNH BÁO] [BỎ QUA]`; không viết không dấu.
- `#Requires -Version 5.1`; `Set-StrictMode -Version Latest`;
  `$ErrorActionPreference = 'Stop'`;
  `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.
- Tham số có `-DryRun` (mặc định cho thao tác ghi/xoá); `-Apply` mới thực thi.
- Không in mật khẩu/DSN/token; che bằng `***`.
- `exit 0` khi đạt, `exit 1` khi lỗi; tóm tắt số việc đã làm.
- Tự kiểm sau khi ghi: 3 byte đầu `EF BB BF`; không còn ký tự thay thế
  U+FFFD (dấu hỏi trong ô đen); chạy `-DryRun` xem thông báo tiếng Việt
  hiển thị đúng dấu.
Mẫu ghi file giữ BOM:
  $enc = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($path, $content, $enc)
```

### 10.3. Cập nhật tài liệu sau mỗi mục

```text
Cập nhật tối thiểu, không viết lại lịch sử:
- KE_HOACH §1.1/§1.2: đổi trạng thái + commit hash.
- Ngay dưới mục tương ứng: khối "Trạng thái thực hiện" gồm ngày (+07), commit,
  file chạm, lệnh test + kết quả, khác biệt so với kế hoạch.
- SESSION.md: 1 bullet ngắn, có cách chạy lại test.
- TASKS.md: chỉ checklist liên quan.
- Bảng THUC_HIEN_FIX_LOI.md: trạng thái, commit, bằng chứng, ghi chú.
Không chèn secret/log dài vào tài liệu.
```

### 10.4. Mẫu bảng tiến độ bền `docs/2/THUC_HIEN_FIX_LOI.md`

```markdown
# TIẾN ĐỘ THỰC HIỆN FIX LỖI TRƯỚC DEPLOY

- Kế hoạch: `docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md`
- Bắt đầu: <yyyy-mm-dd HH:mm +07>
- Cập nhật gần nhất: <yyyy-mm-dd HH:mm +07>
- Quy ước: TODO | ĐANG LÀM | DONE | BLOCKED | NOTE

| # | Đợt | Lô | ID | Trạng thái | Commit | Bằng chứng test | Ghi chú |
|---|---|---|---|---|---|---|---|
| 1 | 1 | C1 | FIX-01 | TODO | — | — | — |
| ... | | | | | | | |
| 34 | 5 | C14 | SEC-F11 | TODO | — | — | — |

> Cột `Commit` ghi hash chung của lô; nhiều ID cùng một hash là hợp lệ.
> Mục đã sửa nhưng lô chưa xong: ghi `chờ lô Cx`.

## Nhật ký quyết định
- <ngày>: <quyết định> — <lý do> — <ảnh hưởng>

## Việc phát sinh
- <ID>: <mô tả> — <trạng thái>
```

### 10.5. Commit & push theo lô

```text
Chỉ tách commit riêng khi rơi vào 1 trong 4 nhóm:
1. Có migration schema mới.
2. Chạm auth/RBAC/crypto lõi.
3. Hạ tầng triển khai (compose, Dockerfile, TLS, cổng).
4. Diff > 200 dòng hoặc > 8 file, hoặc cần rollback độc lập.
Còn lại: gộp theo vùng + đợt, tối đa ~4 mục/lô, một commit cho cả lô.
Không commit file tạm, graphify-out, .env.local.
Push ngay sau mỗi commit: `git push origin main`; xác nhận `git status` sạch
và `git log origin/main -1` khớp HEAD.
Nếu một lô vượt 8 file: được tách thêm 1 commit và ghi lý do vào bảng tiến độ.
```

| Lô | Commit message | Mục | Vùng chính |
|---|---|---|---|
| C1 | `fix(server): JOIN stations khi đếm kết quả tìm kiếm mountpoint` | FIX-01 | `server/src/routes/mountpoints.ts` |
| C2 | `fix(gnss): idle timeout cho caster source và station source` | FIX-02, FIX-03 | `caster/connection.go`, `relay/station_source.go`, `config` |
| C3 | `fix(gnss): tuần tự restart, trần kết nối và giới hạn đọc rover` | FIX-04, FIX-05, FIX-06 | `relay/manager.go`, `caster/manager.go`, `caster/connection.go` |
| C4 | `security(auth): chặn seed/import leo cấp và gắn credential với host` | SEC-F02, SEC-F04, SEC-F07 | `db/seed.ts`, `routes/webUsers.ts`, `routes/stations.ts` |
| C5 | `security(auth): buộc đổi mật khẩu lần đầu (migration 36)` | SEC-F01 | migration admin 36, `routes/auth.ts`, UI |
| C6 | `security(session): fail-fast cookie, trust proxy, audit login, chống dò tài khoản` | SEC-F10, SEC-F13, SEC-F09, SEC-F18 | `config.ts`, `routes/auth.ts`, `lib/audit.ts`, `app.ts` |
| C7 | `security(caster): throttle xác thực sai và TLS/bind nội bộ` | SEC-F06, SEC-F03 | `caster/listener.go`, `manager.go`, `docker-compose.yml` |
| C8 | `fix(relay): đồng bộ pause, resolve alert, fallback realtime, lọc history` | FIX-07, FIX-08, FIX-09, FIX-10 | `routes/relayJobs.ts`, `mountpoints.ts`, `stations.ts`, `realtime/*` |
| C9 | `fix(gnss): grace rover, reconcile nil, credential lỗi, chặn trùng downstream` | FIX-11, FIX-12, FIX-13, FIX-14 | `caster/manager.go`, `relay/*`, `probe/manager.go` |
| C10 | `fix(metrics): reset session, backoff và mốc timeline/uptime` | FIX-15, FIX-16 | `relay/job.go`, `realtime/socket.ts`, `lib/statusTimeline.ts`, `lib/dataUptime.ts` |
| C11 | `security(server): CSRF map, quyền tile, health tối giản, audit scope own` | SEC-F08, SEC-F15, SEC-F19, SEC-F21 | `routes/mapConfig.ts`, `routes/map.ts`, `app.ts`, `routes/ops.ts` |
| C12 | `security(http): timeout HTTP Go và TLS MySQL khi DB ngoài host` | SEC-F14, SEC-F12 | `cmd/corsd/main.go`, `db/pool.ts`, `gnss/internal/db/db.go` |
| C13 | `security(crypto): AAD và rotation khoá mã hoá` | SEC-F05 | `server/src/lib/crypto.ts`, `gnss/internal/secret/aes.go` |
| C14 | `chore(infra): đóng gói web production bằng nginx, bỏ Vite dev` | SEC-F11 | `docker-compose.yml`, `frontend/Dockerfile`, `nginx.conf` |

> Tổng: **14 commit cho 34 mục**. Bảng tiến độ dùng cột `Commit` để ghi hash
> chung của lô; nhiều ID cùng một hash là hợp lệ.

### 10.6. Test gate nhanh (dán khi cần)

```powershell
# Server
Push-Location server; npm run build; if ($LASTEXITCODE) { exit 1 }; npm test; Pop-Location
# Go
Push-Location gnss; go build ./...; go vet ./...; go test ./...; Pop-Location
# Frontend
Push-Location frontend; npm run build; Pop-Location
# Compose
docker compose config --quiet
```

---

## 11. Điều kiện dừng & leo thang (tóm tắt)

| Mã | Tình huống | Hành động |
|---|---|---|
| D1 | FAIL quá 3 vòng sửa | Ghi BLOCKED + 2–3 phương án, hỏi |
| D2 | Cần quyền đặc biệt (endpoint thật, TLS prod, xoá DB, cổng 2101/8081, backup relay) | Dừng, xin quyền |
| D3 | Xung đột git/force-push/mất commit | Dừng, trình bày |
| D4 | Rò rỉ secret/sự cố bảo mật | Dừng ngay, báo cáo |

Ngoài 4 trường hợp trên: tự quyết, ghi lý do vào bảng, đi tiếp. Không hỏi
"có nên tiếp tục không", không báo cáo giữa các mục.

---

## 12. Checklist chống "tuyên bố khống"

- [ ] Đủ 34 ID ánh xạ đúng vào 14 lô commit C1–C14, mỗi lô có hash thật trong `git log`.
- [ ] Mỗi ID có ít nhất một lệnh test + kết quả PASS ghi trong tài liệu.
- [ ] 5 gate đợt đã chạy, kết quả ghi rõ ngày giờ.
- [ ] `git status` sạch, `origin/main` khớp HEAD.
- [ ] Không secret trong diff.
- [ ] SESSION.md, TASKS.md, KE_HOACH, THUC_HIEN_FIX_LOI.md khớp nhau.
- [ ] Việc chưa làm được (nếu có) ghi BLOCKED + lý do, không ghi DONE.
