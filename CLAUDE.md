# CLAUDE.md

## Trạng thái & quy ước

*Cập nhật 2026-11-08. Đọc file này trước khi làm tiếp; kiểm lại repo nếu nghi ngờ thông tin đã cũ.*

### 1. Dự án
- Hệ thống điểm danh sinh viên Trường ĐH Giao thông Vận tải (UTC) bằng khuôn mặt + GPS; giao diện tiếng Việt.
- Spec Kit: `specs/001-attendance-core/` — `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` (`api.md`, `ai-filter-spec.schema.json`), `quickstart.md`, `tasks.md`.
- Constitution: `.specify/memory/constitution.md` **v2.5.1**, nguyên tắc I–IX (I server là nguồn sự thật · II chống điểm danh hộ · III con người quyết định cuối · IV bảo vệ sinh trắc · V RBAC mọi endpoint · VI test logic quyết định · VII đơn giản · VIII AI chỉ đọc · IX bảo mật chiều sâu).

### 2. Kiến trúc
- Monorepo pnpm 10, Node 22. Phụ thuộc một chiều: `apps/web` → `packages/backend` → `packages/database` → `packages/shared`.
  - `apps/web`: Next.js 15 App Router. Route `src/app/api/**/route.ts` chỉ một dòng `export { … } from "@utc/backend/api/…"` (authz-matrix kiểm tự động).
  - `packages/backend`: nghiệp vụ + handler `src/api/**` tạo bằng `route({ roles, body })`.
  - `packages/database`: Drizzle schema, migration SQL, `getDb()`; `DATABASE_URL=pglite:./.pglite` → Postgres nhúng (PGlite) cho dev; test dùng `@utc/database/testing`.
  - `packages/shared`: tiết/ca/giờ VN, xử lý tiếng Việt (`namesMatch`), văn bản đồng ý (`consent.ts`).
- Khuôn mặt: `onnxruntime-node` + InsightFace `buffalo_s` (SCRFD-500M + MobileFaceNet) — **giấy phép phi thương mại**; model ở `apps/web/models/` (gitignore, tải bằng `pnpm models:download`, kiểm SHA-256).
- Thẻ SV: `zxing-wasm` (mã vạch) + `tesseract.js` với `@tesseract.js-data/vie` (bản `4.0.0_best_int`), chạy cục bộ ở server.
- Deploy: Vercel (Root Directory `apps/web`, region `sin1`, `apps/web/vercel.json`) + Supabase (Postgres + Storage private). Hướng dẫn: `docs/deploy.md`.

### 3. Tiến độ (`tasks.md`)
| Phase | Xong / tổng | Ghi chú |
|---|---|---|
| 1 Setup | 8/8 | |
| 1b Spike | 0/4 | T009 còn đo trên Vercel; T010 mới 1/5 thẻ thật (Code128 = mã SV); T011 hiệu chỉnh ngưỡng; T012 Go/No-Go |
| 2 Foundational | 27/27 | |
| 3 US1 lớp + danh sách | 13/13 | Đã trên `main` |
| 4 US6 thẻ SV | 10/12 | Backend xong (T053–T061, T064); **UI T062, T063 chưa làm** |
| 5–11 (US2, US3, US5, US4, US9, US8, US7) | 0 | |
| 12 Polish | 0/14 | Có T144 (Turnstile) |
- Test (lần chạy gần nhất): backend **386**, database **49**, shared **22** — tổng 457, đều pass. `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm check:traces` pass.

### 4. Quyết định đã chốt
- Body request ≤ **4 MB** (giới hạn 4,5 MB của Vercel): danh sách lớp 4 MB, ảnh thẻ 1 MB, mỗi khung mặt 1 MB (FR-090, FR-100, research R14).
- `writeAudit(..., tx)` ghi **trong cùng transaction** với thay đổi; audit lỗi → thay đổi bị huỷ (Constitution III).
- Đăng nhập SV bằng mã: mọi lý do thất bại → cùng **401 `LOGIN_FAILED`** (FR-083). Rate limit: theo IP **chỉ đếm thất bại 50/5 phút** + trần tổng 300/5 phút (đầy thì chặn mọi lượt từ IP trước khi tra cứu); theo mã chỉ đếm thất bại 5/5 phút; **API đã đăng nhập khoá theo tài khoản**, không theo IP (FR-081, R14). `security_events` lưu HMAC mã SV bằng khoá riêng **`LOG_HMAC_SECRET`** (bắt buộc, ≥ 32 ký tự; `src/security/log-hmac.ts`), độc lập `JWT_SECRET`.
- Đăng ký thẻ (FR-045…049, FR-045a): mã vạch, OCR dự phòng; họ tên OCR so bằng `namesMatch` (bắt buộc khớp chỉ khi mã đọc bằng OCR) + **mặt trực tiếp 3 khung có thử thách quay đầu**; **6 lượt/giờ**, lỗi kèm `remainingAttempts`.
- Ngưỡng mặc định **chờ hiệu chỉnh T011**: `DUPLICATE_ABOVE` 0,45 · `CARD_ACCEPT_ABOVE` 0,5 (mặt trực tiếp ↔ thẻ) · chân dung tối thiểu 40 px, độ nét 0,02 (R1, R3).
- Ảnh thẻ + chân dung **chỉ upload sau khi qua hết kiểm tra**; thẻ bị từ chối không lưu file/DB; khung mặt trực tiếp không bao giờ lưu (FR-051).
- Trùng mặt SV chung lớp / mặt trực tiếp lệch thẻ / tên lệch → **`pending_review` cho giảng viên, không từ chối tự động** (Constitution III); SV không được biết lý do.
- CSV danh sách lớp: phân biệt Windows-1258 / 1252; họ tên chứa `?` → `LOST_CHARACTERS` + cảnh báo `ENCODING_LOSS` (quickstart Q3, Q3b).
- Migration: runner chung `packages/database/src/migrator.ts` cho pglite và Postgres — mỗi file một transaction, bảng theo dõi của Drizzle, **tự baseline** DB kiểu cũ; thêm migration không cần xoá `.pglite`.
- Script ghi DB (`packages/database/src/db-target.ts`): `db:seed:demo` **chỉ DB cục bộ** (cấm production/Supabase/remote); `db:migrate`, `admin:create` lên remote cần `CONFIRM_REMOTE_DB=true`.
- Đóng gói Vercel: `next.config.ts` phân giải đường dẫn thật của wasm/dữ liệu OCR; `pnpm check:traces` chạy trong CI và trong `buildCommand`.
- CodeQL: repo private → `upload: never` + `.github/scripts/codeql-gate.mjs` chặn theo SARIF.

### 5. Đang dở
- **PR #1** (`001-attendance-core` → `main`) đã mở, **chưa merge**; Vercel Preview build thành công.
- **CI không tự chạy** khi push lên `main` (4 lần, 2026-11-07) và trên PR #1. Khối `on:` của `ci.yml` (đã in nguyên văn, đúng cú pháp): `push:` → `branches: [main]`; `pull_request:` (không lọc nhánh = mọi nhánh); `workflow_dispatch:`. Không có `concurrency`, không có `if` cấp job. Push lên nhánh tính năng không chạy CI là **đúng thiết kế** (push chỉ lọc `main`). GitHub đã ghi nhận `PullRequestEvent`; nguyên nhân chưa rõ. Bước tiếp: thêm tạm `.github/workflows/ping.yml` (`on: [push, pull_request]`, một bước `echo ok`), push lên nhánh PR — ping chạy mà CI không → lỗi trong `ci.yml`; ping cũng không chạy → phía GitHub/cài đặt repo (`gh api repos/{owner}/{repo}/actions/permissions`); xong xoá `ping.yml`. Chạy tay được: `gh workflow run CI --ref <nhánh>`.
- Kiểm Preview cần `$env:VERCEL_BYPASS` (Preview có Deployment Protection, trả 302 sang SSO).
- `LOG_HMAC_SECRET` đã có trong code — **cần đặt** ở `apps/web/.env.local` và Vercel (Preview + Production).
- Đo cold/warm + bộ nhớ `POST /api/student/card` trên Preview (cục bộ: ~4,4 s / ~1,9 s, RSS ~600 MB); xác nhận đường dẫn model theo `process.cwd()` trên Vercel.
- Theo người dùng: Preview và Production đang dùng chung một Supabase — cần tách.
- Token `gh` thiếu quyền `workflow` → push sửa `ci.yml` phải qua Git Credential Manager (hoặc `gh auth refresh -s workflow`).

### 6. Việc tiếp theo (theo thứ tự)
1. Xử lý các mục §5 → merge PR #1.
2. US6 UI T062/T063: đăng nhập SV, đồng ý điều khoản, chụp thẻ (camera sau) + mặt trực tiếp (camera trước) theo thử thách, trạng thái thẻ; hàng chờ duyệt cho giảng viên `/gv/lop/[id]/the`. **Không bao giờ lộ `DUPLICATE_FACE` hay lý do chờ duyệt cho SV.**
3. Phase 5 US2 check-in.
4. Polish: T144 Turnstile khi vượt ngưỡng IP; nâng các action Node 20 (`checkout`, `setup-node`, `codeql-action`…); cron dọn ảnh hết hạn; cảnh báo `jose` (Edge runtime) ở middleware.

### 7. Quy ước làm việc
- **Viết test trước**, chạy thấy FAIL rồi mới cài đặt; sau mỗi việc chạy `pnpm test` (+ `typecheck`, `lint`, khi liên quan build thì `build` + `check:traces`).
- Mỗi nhóm việc **một commit riêng**, message tiếng Việt, kết bằng dòng `Co-Authored-By` theo hướng dẫn phiên. Đánh dấu `[x]` trong `tasks.md` khi xong.
- **Không merge PR, không push thẳng lên `main`.** Làm trên nhánh tính năng rồi mở PR.
- **KHÔNG BAO GIỜ** in hay commit secret, file `.env*`, ảnh thẻ/mặt người thật, thư mục `models/`. Với DB chỉ in **host**, không in URL. Ảnh thử dùng ảnh tự sinh.
- PGlite chỉ cho một tiến trình: không mở `apps/web/.pglite` khi `pnpm dev` đang chạy — thử trên bản sao.
- Báo cáo cuối mỗi lượt gồm: đã làm gì · quyết định thiết kế cần người review · cái chưa kiểm chứng · số test.
