# CLAUDE.md

## Trạng thái & quy ước

*Cập nhật 2026-11-16 (trước compact). Đọc file này trước khi làm tiếp; kiểm lại repo/PR nếu nghi ngờ thông tin đã cũ. "(người dùng báo)" = sự thật do người dùng kiểm, không kiểm được từ repo.*

### 1. Dự án
- Hệ thống điểm danh sinh viên Trường ĐH Giao thông Vận tải (UTC) bằng khuôn mặt + GPS; giao diện tiếng Việt.
- Spec Kit: `specs/001-attendance-core/` — `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` (`api.md`, `ai-filter-spec.schema.json`), `quickstart.md`, `tasks.md`.
- Constitution: `.specify/memory/constitution.md` **v2.5.1**, nguyên tắc I–IX (I server là nguồn sự thật · II chống điểm danh hộ · III con người quyết định cuối · IV bảo vệ sinh trắc · V RBAC mọi endpoint · VI test logic quyết định · VII đơn giản · VIII AI chỉ đọc · IX bảo mật chiều sâu).

### 2. Kiến trúc & hạ tầng
- Monorepo pnpm 10, Node 22. Phụ thuộc một chiều: `apps/web` → `packages/backend` → `packages/database` → `packages/shared`.
  - `apps/web`: Next.js 15 App Router. Route `src/app/api/**/route.ts` chỉ một dòng `export { … } from "@utc/backend/api/…"` (authz-matrix kiểm tự động). Test client: `apps/web/tests/unit` (vitest).
  - `packages/backend`: nghiệp vụ + handler `src/api/**` tạo bằng `route({ roles, body })`.
  - `packages/database`: Drizzle schema, migration SQL (0000–0004), `getDb()`; `DATABASE_URL=pglite:./.pglite` → PGlite cho dev; test dùng `@utc/database/testing`.
  - `packages/shared`: tiết/ca/giờ VN, tiếng Việt (`namesMatch`), văn bản đồng ý (`consent.ts`), **yaw dùng chung client+server** (`face-yaw.ts`), mô hình đầu tổng hợp cho test (`head-model.ts`).
- Khuôn mặt server: `onnxruntime-node` + InsightFace `buffalo_s` (SCRFD-500M + MobileFaceNet) — **giấy phép phi thương mại**; model ở `apps/web/models/` (gitignore, `pnpm models:download`, kiểm SHA-256).
- Khuôn mặt client: MediaPipe **Face Detector (BlazeFace short-range)**, `@mediapipe/tasks-vision` 1.2.0 tự host trong `apps/web/public/mediapipe/` (gitignore; wasm chép bởi `scripts/card-assets.mjs`, model tải bởi `models:download`; tên có phiên bản/hash, `Cache-Control: immutable`; đường dẫn ở `apps/web/src/lib/student/mediapipe-assets.ts`).
- Thẻ SV: `zxing-wasm` + `tesseract.js` (dữ liệu `vie` 4.0.0_best_int), chạy ở server; dữ liệu chạy chép + kiểm sha256 vào `apps/web/card-assets/` (gitignore).
- Deploy: Vercel (Root Directory `apps/web`, region `sin1`, `apps/web/vercel.json`) + Supabase (Postgres + Storage private). Hướng dẫn: `docs/deploy.md`.
- **(người dùng báo)** Vercel Production (`main`) ↔ Supabase **PROD**; Preview ↔ Supabase **PREVIEW** riêng (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` tách theo phạm vi môi trường). Đủ 4 bucket private (`cards`, `evidence`, `leave`, `disputes`) ở cả hai project. Preview có Deployment Protection — thử điện thoại bằng **link Share của ĐÚNG bản deploy mới nhất** (link Share gắn với 1 deployment cụ thể). Từ máy này không có `VERCEL_BYPASS` → không gọi được Preview.

### 3. Tiến độ (`tasks.md`)
| Phase | Xong / tổng | Ghi chú |
|---|---|---|
| 1 Setup | 8/8 | |
| 1b Spike | 0/4 | T009: Vercel 1 mẫu (đăng ký thẻ 201 = 6,84 s, 422 = 4,97 s), còn nhiều mẫu + bộ nhớ. T010: 2 lượt thẻ thật OK (còn ≥ 4 thẻ khác). T011 hiệu chỉnh ngưỡng. T012 Go/No-Go (ngưỡng tách: đăng ký thẻ ≤ 10 s, điểm danh ≤ 5 s) |
| 2 Foundational | 27/27 | |
| 3 US1 lớp + danh sách | 13/13 | Trên `main` |
| 4 US6 thẻ SV | 12/12 | Backend trên `main` (PR #1); UI T062/T063 + các sửa sau thử thật trên PR #2 |
| 5–11 (US2, US3, US5, US4, US9, US8, US7) | 0 | |
| 12 Polish | 0/15 | T144 (Turnstile), T145 (tối ưu thời gian đăng ký thẻ) |
- Test (lần chạy gần nhất, `aaedd7d`): backend **456**, database **51**, shared **32**, web **85** — tổng 624, đều pass; `typecheck`, `lint`, `build`, `check:traces` pass; CI (`check`, `codeql`) xanh.

### 4. Quyết định đã chốt
- Body request ≤ **4 MB**: danh sách lớp 4 MB, ảnh thẻ 1 MB, mỗi khung mặt 1 MB (FR-090, FR-100, R14).
- `writeAudit(..., tx)` ghi **trong cùng transaction** với thay đổi (Constitution III).
- Đăng nhập SV: mọi lý do thất bại → **401 `LOGIN_FAILED`** (FR-083). Rate limit IP chỉ đếm thất bại 50/5 phút + trần tổng 300/5 phút; theo mã 5 thất bại/5 phút; API đã đăng nhập khoá theo tài khoản (R14). `security_events` lưu HMAC mã SV bằng `LOG_HMAC_SECRET` (bắt buộc ≥ 32 ký tự, độc lập `JWT_SECRET`).
- Biến môi trường kiểm **lúc khởi động** (`instrumentation.ts` → `checkEnvOnStartup`): sai → log `env_invalid` (chỉ tên biến), mọi request 500. `SUPABASE_URL` phải là **origin thuần** `https://<ref>.supabase.co` (không path, không `/` cuối; http chỉ localhost). `VERCEL=1` + `pglite:` luôn chặn; `next start` cục bộ + pglite cần `ALLOW_LOCAL_PGLITE=1`.
- Đăng ký thẻ (FR-045…049, FR-045a): mã vạch, OCR dự phòng (zxing `tryRotate` + `tryInvert`; **OCR xoay 90°/270° chỉ khi mã vạch hỏng**; OCR lỗi + có mã vạch → vẫn đăng ký, GV thấy `nameUnverified`; không mã vạch → 503 `OCR_UNAVAILABLE`) + mặt trực tiếp 3 khung theo thử thách quay đầu. **6 lượt/giờ**, **hoàn lượt** khi 503 đã phân loại (`STORAGE_BUCKET_MISSING`, `STORAGE_UNAVAILABLE`, `OCR_UNAVAILABLE`; không hoàn 500 không phân loại) + **trần tổng 20 lượt/giờ** (kể cả lượt hoàn); `remainingAttempts` = min(6 − lượt, 20 − tổng).
- **Ngưỡng ảnh thẻ** (cạnh dài vùng cắt, px gốc): < 500 **chặn**; 500–999 **cảnh báo** + "Vẫn dùng ảnh này"; ≥ 1000 ổn. Thẻ UTC là **thẻ DỌC** (khung CR80 54:85,6 cao 80 % vùng xem).
- **Yaw** — công thức chung `@utc/shared/face-yaw`: kẹp(5 × (mũi.x − tâm 2 mắt.x) / **bề rộng bbox**, −1, 1) (công thức cũ chia khoảng cách 2 mắt → -41 và đổi dấu khi quay mạnh). Ngưỡng sơ bộ: **server** thẳng ≤ 0,18 · quay 0,30–0,80 · > 0,80 quá mạnh (không hợp lệ → `LIVENESS_FAILED`); **client** thẳng ≤ 0,12 · quay 0,40–0,65 · > 0,65 "Quay vừa phải". Client chỉ hướng dẫn + tự chụp (ổn định ~300 ms; quá 10 s nhắc lại + nút đếm ngược; model lỗi/ > 15 s → đếm ngược) — **server quyết định**.
- **CSP** `'wasm-unsafe-eval'` **theo route**: chỉ `/sv/the-sinh-vien*` (`needsWasm` / `WASM_PATH_PREFIXES` trong `packages/backend/src/security/headers.ts`). CSP gắn với document → điều hướng băng qua ranh giới dùng `AppLink`/`useAppNavigate` (tải document mới), không dùng `next/link`/`router.push` trực tiếp. **Đề xuất (CHƯA làm)**: chuyển sang toàn khu `/sv/*` và bỏ `AppLink`.
- Ngưỡng thời gian (T012): **đăng ký thẻ p95 ≤ 10 s** (một lần, có màn tiến trình) · **điểm danh p95 ≤ 5 s**.
- Ngưỡng nhận diện chờ T011: `DUPLICATE_ABOVE` 0,45 · `CARD_ACCEPT_ABOVE` 0,5 · chân dung ≥ 40 px, độ nét 0,02.
- Ảnh thẻ + chân dung **chỉ upload sau khi qua hết kiểm tra**; upload lỗi → dọn file, không dòng DB/audit; khung mặt trực tiếp không bao giờ lưu (FR-051). Trùng mặt / mặt lệch thẻ / tên lệch → `pending_review`, SV không biết lý do; SV chỉ thấy `active`/`pending_review`/`rejected`/`reset`.
- Lỗi Supabase Storage: log `storage_request_failed` (op, bucket, host, status, body lỗi — không key); "Bucket not found" → 503 `STORAGE_BUCKET_MISSING`.
- Đóng gói Vercel: không `require.resolve` gói lúc chạy; include mọi `tesseract-core*.wasm` (tesseract.js 7 Node luôn nạp core không-lstm); `pnpm check:traces` (CI + `buildCommand`) kiểm file + chạy thử đọc thẻ giả trong thư mục mô phỏng output đã trace.
- Migration runner chung (`packages/database/src/migrator.ts`, tự baseline). Script ghi DB: `db:seed:demo` chỉ cục bộ; `db:migrate`/`admin:create` lên remote cần `CONFIRM_REMOTE_DB=true`. Kho ảnh dev: pglite + không Supabase → `.local-storage/`.
- CodeQL: repo private → `upload: never` + `.github/scripts/codeql-gate.mjs`.

### 5. Đang dở
- PR #1 **đã merge** vào `main` (2026-11-09). **PR #2** (`001-us6-ui` → `main`, UI US6 T062/T063 + sửa sau thử thật) **đang mở, CHƯA merge**.
- **(người dùng báo) Thử iPhone thật** (iOS 18.4 Safari, 4G, thẻ UTC thật): đăng ký thẻ thành công; camera sau 1440×2560, `takePhoto` 2160×3840, vùng thẻ 1046×1658; Vercel 201 = 6,84 s, 422 = 4,97 s; MediaPipe tải 4,17 MB (gzip OK), khởi tạo ~4,5–6,7 s lần đầu; tự chụp hoạt động; header hamburger OK. Android chưa thử; bộ nhớ function chưa đo.
- **Yaw mới CHƯA kiểm trên mặt thật**: lần thử iPhone gần nhất chạy trên bản deploy CŨ (ngưỡng client 0,08/0,28, công thức chia khoảng cách mắt) — client báo "Giữ yên" + tự chụp nhưng server trả `LIVENESS_FAILED` 2 lần. Cần thử lại trên deploy mới nhất (`/sv/the-sinh-vien/debug` → "Thử bộ hướng dẫn khuôn mặt").
- **Việc tiếp theo trên PR #2**: công cụ so sánh yaw client ↔ server **chỉ ở preview/dev** — client gửi yaw metadata kèm khung, server trả yaw từng khung + lý do lỗi, UI preview hiện bảng so sánh; production không trả / không log.
- Token `gh` thiếu quyền `workflow` → push sửa `.github/workflows/*` qua Git Credential Manager (`git -c credential.helper= -c credential.helper=manager push`). CI tự chạy trên `pull_request` (sự cố không chạy 2026-11-07 đã tự hết).

### 6. Việc tiếp theo (theo thứ tự)
1. PR #2: công cụ so sánh yaw client↔server (preview/dev) → thử lại trên iPhone (+ Android) với yaw mới → hiệu chỉnh ngưỡng → (cân nhắc CSP toàn khu `/sv/*`) → người dùng merge.
2. Sau khi PR #2 merge: **Phase 5 US2 check-in** trên nhánh `001-us2-checkin`; route check-in dùng lại `@utc/shared/face-yaw` + `face/liveness.ts`, `use-camera`, `FaceChallenge`, `card-errors`, và **cần CSP wasm** (thêm vào `WASM_PATH_PREFIXES` hoặc CSP toàn khu `/sv/*`).
3. T145 tối ưu thời gian đăng ký thẻ; T009 đo thêm mẫu + bộ nhớ.
4. Polish: T144 Turnstile; nâng action Node 20; cron dọn ảnh hết hạn; cảnh báo `jose` (Edge) ở middleware.

### 7. Quy ước làm việc
- **Viết test trước**, chạy thấy FAIL rồi mới cài đặt.
- Kiểm **exit code từng lệnh** `pnpm test` / `typecheck` / `lint` / `build` / `check:traces`; **≠ 0 thì không commit** (không nối commit sau `grep`/pipe).
- Mỗi nhóm việc **một commit riêng**, message tiếng Việt, kết bằng dòng `Co-Authored-By` theo hướng dẫn phiên; mỗi commit phải build được. Đánh dấu `[x]` trong `tasks.md` khi xong.
- **Không merge PR, không push thẳng lên `main`.** Làm trên nhánh tính năng rồi mở PR.
- **KHÔNG BAO GIỜ** in hay commit secret, file `.env*`, ảnh thẻ/mặt người thật, thư mục `models/`. Với DB chỉ in **host**, không in URL. Ảnh thử dùng ảnh tự sinh.
- PGlite chỉ một tiến trình: không mở `apps/web/.pglite` khi `pnpm dev` đang chạy — thử trên bản sao.
- Báo cáo cuối mỗi lượt: đã làm gì · quyết định cần người review · cái chưa kiểm chứng · số test.
