# TIẾN ĐỘ THỰC HIỆN FIX LỖI TRƯỚC DEPLOY

- Kế hoạch: `docs/2/KE_HOACH_FIX_LOI_TRUOC_DEPLOY.md`
- Prompt thi hành: `docs/2/PROMPT_THUC_HIEN_KE_HOACH_FIX_LOI.md`
- Bắt đầu: 2026-11-03 17:05 +07
- Quy ước: TODO | ĐANG LÀM | DONE | BLOCKED | NOTE
- Commit: gộp theo lô C1–C14; cột Commit ghi hash chung, nhiều ID cùng hash hợp lệ.

| # | Đợt | Lô | ID | Trạng thái | Commit | Bằng chứng test | Ghi chú |
|---|---|---|---|---|---|---|---|
| 1 | 1 | C1 | FIX-01 | DONE | C1 | vitest 22 file/130 PASS; live q=DOCS 200/total=4, không q total=8 | — |
| 2 | 1 | C2 | FIX-02 | DONE | C2 | `go test ./internal/caster` PASS; 2 test idle/active | — |
| 3 | 1 | C2 | FIX-03 | DONE | C2 | relay/config PASS; cadence 60ms/150ms; mặc định 120s | — |
| 4 | 1 | C3 | FIX-04 | DONE | C3 | `TestWaitJobDone*` PASS; StopTimeout 15s | — |
| 5 | 1 | C3 | FIX-05 | DONE | C3 | per-IP 200/trần 500; test PASS | — |
| 6 | 1 | C3 | FIX-06 | DONE | C3 | rover 1KB + idle 5m + recover; 2 test PASS | — |
| 7 | 2 | C4 | SEC-F02 | ĐANG LÀM | — | — | — |
| 8 | 2 | C4 | SEC-F04 | TODO | — | — | — |
| 9 | 2 | C4 | SEC-F07 | TODO | — | — | — |
| 10 | 2 | C5 | SEC-F01 | TODO | — | — | — |
| 11 | 3 | C6 | SEC-F10 | TODO | — | — | — |
| 12 | 3 | C6 | SEC-F13 | TODO | — | — | — |
| 13 | 3 | C6 | SEC-F09 | TODO | — | — | — |
| 14 | 3 | C6 | SEC-F18 | TODO | — | — | — |
| 15 | 3 | C7 | SEC-F06 | TODO | — | — | — |
| 16 | 3 | C7 | SEC-F03 | TODO | — | — | — |
| 17 | 4 | C8 | FIX-07 | TODO | — | — | — |
| 18 | 4 | C8 | FIX-08 | TODO | — | — | — |
| 19 | 4 | C8 | FIX-09 | TODO | — | — | — |
| 20 | 4 | C8 | FIX-10 | TODO | — | — | — |
| 21 | 4 | C9 | FIX-11 | TODO | — | — | — |
| 22 | 4 | C9 | FIX-12 | TODO | — | — | — |
| 23 | 4 | C9 | FIX-13 | TODO | — | — | — |
| 24 | 4 | C9 | FIX-14 | TODO | — | — | — |
| 25 | 5 | C10 | FIX-15 | TODO | — | — | — |
| 26 | 5 | C10 | FIX-16 | TODO | — | — | — |
| 27 | 5 | C11 | SEC-F08 | TODO | — | — | — |
| 28 | 5 | C11 | SEC-F15 | TODO | — | — | — |
| 29 | 5 | C11 | SEC-F19 | TODO | — | — | — |
| 30 | 5 | C11 | SEC-F21 | TODO | — | — | — |
| 31 | 5 | C12 | SEC-F14 | TODO | — | — | — |
| 32 | 5 | C12 | SEC-F12 | TODO | — | — | — |
| 33 | 5 | C13 | SEC-F05 | TODO | — | — | — |
| 34 | 5 | C14 | SEC-F11 | TODO | — | — | — |

## Nhật ký quyết định

- 2026-11-03 17:03 +07: Baseline PASS — server build + vitest 21 file/128 test;
  Go build/vet/test PASS; frontend build PASS.
- 2026-11-03 17:05 +07: Bắt đầu Đợt 1, mục FIX-01 (lô C1).
- 2026-11-03 17:08 +07: FIX-01 DONE (C1). Tiếp theo: FIX-02 (C2).
- 2026-11-03 17:11 +07: FIX-02, FIX-03 DONE (C2). Tiếp theo: FIX-04 (C3).
- 2026-11-03 17:14 +07: FIX-04..06 DONE (C3). Đợt 1 xong; sang Đợt 2 — SEC-F02 (C4).
- 2026-11-03 17:16 +07: Gate Đợt 1: server 130 PASS, FE build PASS,
  Playwright mountpoint-explorer PASS; station-source FAIL do fixture thiếu
  trạm "THA Hậu Lộc" (pre-existing, đã ghi SESSION).

## Việc phát sinh

- (chưa có)
