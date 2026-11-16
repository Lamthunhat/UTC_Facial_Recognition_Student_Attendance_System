# CLAUDE.md

## Trạng thái & quy ước

*Cập nhật 2026-11-17 (sau US2 lượt 1, trước lượt 2). Đọc file này trước khi làm tiếp; kiểm lại repo/PR nếu nghi ngờ thông tin đã cũ. "(người dùng báo)" = sự thật do người dùng kiểm, không kiểm được từ repo.*

### 1. Dự án
- Hệ thống điểm danh sinh viên Trường ĐH Giao thông Vận tải (UTC) bằng khuôn mặt + GPS; giao diện tiếng Việt.
- Spec Kit: `specs/001-attendance-core/` — `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` (`api.md`, `ai-filter-spec.schema.json`), `quickstart.md`, `tasks.md`.
- Constitution: `.specify/memory/constitution.md` **v2.5.1**, nguyên tắc I–IX (I server là nguồn sự thật · II chống điểm danh hộ · III con người quyết định cuối · IV bảo vệ sinh trắc · V RBAC mọi endpoint · VI test logic quyết định · VII đơn giản · VIII AI chỉ đọc · IX bảo mật chiều sâu).

### 2. Kiến trúc & hạ tầng
- Monorepo pnpm 10, Node 22. Phụ thuộc một chiều: `apps/web` → `packages/backend` → `packages/database` → `packages/shared`.
  - `apps/web`: Next.js 15 App Router. Route `src/app/api/**/route.ts` chỉ một dòng `export { … } from "@utc/backend/api/…"` (authz-matrix kiểm tự động). Test client: `apps/web/tests/unit` (vitest); e2e `apps/web/tests/e2e` (Playwright, Chromium đã cài trên máy này) — `csp-wasm.spec.ts` PHẢI chạy với bản build production (`pnpm build` → `ALLOW_LOCAL_PGLITE=1 next start -p 3100` → `E2E_BASE_URL=http://localhost:3100 playwright test csp-wasm`; dev có `'unsafe-eval'` nên không phân biệt được). CI chưa chạy e2e.
  - `packages/backend`: nghiệp vụ + handler `src/api/**` tạo bằng `route({ roles, body })`.
  - `packages/database`: Drizzle schema, migration SQL (0000–0005), `getDb()`; `DATABASE_URL=pglite:./.pglite` → PGlite cho dev; test dùng `@utc/database/testing`.
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
| 4 US6 thẻ SV | 12/12 | Trên `main` (PR #1, PR #2); production đã deploy bản US6 (người dùng báo) |
| 5 US2 check-in | 15/20 | Lượt 1 (test + backend) ở PR #3, chưa merge; còn T068 e2e, T078–T080 UI, T083 phần client |
| 6 US3 trùng mặt | 2/4 | T085 (test trong `checkin.test.ts`), T086 xong; còn T087 cảnh báo GV, T088 UI duyệt |
| 8 US4 check-out/đột xuất | 3/6 | T097, T099, T100 (backend) xong; còn T098 (cần trạng thái buổi US5), T101–T102 UI |
| 7, 9–11 (US5, US9, US8, US7) | 0 | |
| 12 Polish | 0/15 | T144 (Turnstile), T145 (tối ưu thời gian đăng ký thẻ) |
- Test (lần chạy gần nhất, `001-us2-checkin` lượt 1): backend **692**, database **52**, shared **48**, web **111** — tổng 903 (+ e2e `csp-wasm` 2 + `debug-page` 2, chạy với bản build production), đều pass; `typecheck`, `lint`, `build`, `check:traces` pass. Bộ test backend đã chạy lặp 6+ lần liên tiếp không chập chờn (sau khi sửa fontconfig).

### 4. Quyết định đã chốt
- Body request ≤ **4 MB**: danh sách lớp 4 MB, ảnh thẻ 1 MB, mỗi khung mặt 1 MB (FR-090, FR-100, R14).
- `writeAudit(..., tx)` ghi **trong cùng transaction** với thay đổi (Constitution III).
- Đăng nhập SV: mọi lý do thất bại → **401 `LOGIN_FAILED`** (FR-083). Rate limit IP chỉ đếm thất bại 50/5 phút + trần tổng 300/5 phút; theo mã 5 thất bại/5 phút; API đã đăng nhập khoá theo tài khoản (R14). `security_events` lưu HMAC mã SV bằng `LOG_HMAC_SECRET` (bắt buộc ≥ 32 ký tự, độc lập `JWT_SECRET`).
- Biến môi trường kiểm **lúc khởi động** (`instrumentation.ts` → `checkEnvOnStartup`): sai → log `env_invalid` (chỉ tên biến), mọi request 500. `SUPABASE_URL` phải là **origin thuần** `https://<ref>.supabase.co` (không path, không `/` cuối; http chỉ localhost). `VERCEL=1` + `pglite:` luôn chặn; `next start` cục bộ + pglite cần `ALLOW_LOCAL_PGLITE=1`.
- Đăng ký thẻ (FR-045…049, FR-045a): mã vạch, OCR dự phòng (zxing `tryRotate` + `tryInvert`; **OCR xoay 90°/270° chỉ khi mã vạch hỏng**; OCR lỗi + có mã vạch → vẫn đăng ký, GV thấy `nameUnverified`; không mã vạch → 503 `OCR_UNAVAILABLE`) + mặt trực tiếp 3 khung theo thử thách quay đầu. **6 lượt/giờ**, **hoàn lượt** khi 503 đã phân loại (`STORAGE_BUCKET_MISSING`, `STORAGE_UNAVAILABLE`, `OCR_UNAVAILABLE`; không hoàn 500 không phân loại) + **trần tổng 20 lượt/giờ** (kể cả lượt hoàn); `remainingAttempts` = min(6 − lượt, 20 − tổng).
- **Ngưỡng ảnh thẻ** (cạnh dài vùng cắt, px gốc): < 500 **chặn**; 500–999 **cảnh báo** + "Vẫn dùng ảnh này"; ≥ 1000 ổn. Thẻ UTC là **thẻ DỌC** (khung CR80 54:85,6 cao 80 % vùng xem).
- **Yaw** — công thức chung `@utc/shared/face-yaw`: kẹp(5 × (mũi.x − tâm 2 mắt.x) / **bề rộng bbox**, −1, 1) (công thức cũ chia khoảng cách 2 mắt → -41 và đổi dấu khi quay mạnh). Ngưỡng ở **một chỗ** `@utc/shared/face-yaw-thresholds` (client + server + yaw-debug import từ đó; test bất biến biên `YAW_MARGINS`: client.turnMin − server.turnMin ≥ 0,15 · server.centerMax − client.centerMax ≥ 0,05 · server.turnMax − client.turnMax ≥ 0,10 · server thẳng < quay). **server** thẳng ≤ 0,18 · quay **0,22**–0,80 (nới từ 0,30 ngày 2026-11-17 theo số đo iPhone: trái C 0,501/S 0,552 · thẳng C −0,088/S −0,093 · phải C −0,410/S −0,321 → server có thể thấp hơn client ~0,09; chi tiết research R2) · > 0,80 quá mạnh (không hợp lệ → `LIVENESS_FAILED`); **client** thẳng ≤ 0,12 · quay 0,40–0,65 · > 0,65 "Quay vừa phải". Đã kiểm trên iPhone (người dùng báo: 4 lượt "Thử liveness" đều qua, |S − C| ≤ 0,09); **T011 vẫn mở** — thiếu Android, mới 1 người / 1 máy. Client chỉ hướng dẫn + tự chụp (ổn định ~300 ms; quá 10 s nhắc lại + nút đếm ngược; model lỗi/ > 15 s → đếm ngược) — **server quyết định**.
- **CSP** `'wasm-unsafe-eval'` **cho toàn khu SV `/sv/*`** (`needsWasm` / `WASM_AREA_PREFIX` trong `packages/backend/src/security/headers.ts`, `4f12c35`). `/sv` (đăng nhập SV), `/gv`, `/admin`, `/login`, `/api` giữ CSP chặt. Trong khu SV dùng `next/link`/`router` bình thường (đã xoá `AppLink`/`useAppNavigate`/`csp-navigation`); chỉ **đăng nhập SV** và **đăng xuất** tải document mới (`window.location.replace`). Route SV mới (check-in) tự có wasm.
- Ngưỡng thời gian (T012): **đăng ký thẻ p95 ≤ 10 s** (một lần, có màn tiến trình) · **điểm danh p95 ≤ 5 s**.
- Ngưỡng nhận diện chờ T011: `DUPLICATE_ABOVE` 0,45 · `CARD_ACCEPT_ABOVE` 0,5 · chân dung ≥ 40 px, độ nét 0,02.
- Ảnh thẻ + chân dung **chỉ upload sau khi qua hết kiểm tra**; upload lỗi → dọn file, không dòng DB/audit; khung mặt trực tiếp không bao giờ lưu (FR-051). Trùng mặt / mặt lệch thẻ / tên lệch → `pending_review`, SV không biết lý do; SV chỉ thấy `active`/`pending_review`/`rejected`/`reset`.
- Lỗi Supabase Storage: log `storage_request_failed` (op, bucket, host, status, body lỗi — không key); "Bucket not found" → 503 `STORAGE_BUCKET_MISSING`.
- Đóng gói Vercel: không `require.resolve` gói lúc chạy; include mọi `tesseract-core*.wasm` (tesseract.js 7 Node luôn nạp core không-lstm); `pnpm check:traces` (CI + `buildCommand`) kiểm file + chạy thử đọc thẻ giả trong thư mục mô phỏng output đã trace.
- Migration runner chung (`packages/database/src/migrator.ts`, tự baseline). Script ghi DB: `db:seed:demo` chỉ cục bộ; `db:migrate`/`admin:create` lên remote cần `CONFIRM_REMOTE_DB=true`. Kho ảnh dev: pglite + không Supabase → `.local-storage/`.
- CodeQL: repo private → `upload: never` + `.github/scripts/codeql-gate.mjs`.
- **Check-in (US2, research R17)** — `attendance/decide.ts` (thuần) + `attendance/checkin.ts` (DB/ảnh) + `attendance/windows.ts` (GV):
  - Thứ tự: nonce (đúng SV + khung) → rate limit **theo SV** (`checkinSubmit` 12/10 phút; nonce 6/phút) → toạ độ (422) → khung/ghi danh/đã check-in/lượt → GPS (`retry` sai số > 100 m, `rejected` ngoài bán kính — **không xử lý ảnh**) → liveness 3 khung (`card/live.ts`, `SERVER_YAW`) → thẻ 2 ngưỡng (`CARD_REJECT_BELOW` 0,35 từ chối / `CARD_ACCEPT_ABOVE` 0,5) → check-out/đột xuất so lượt check-in (`CHECKIN_MATCH_ABOVE` 0,55) → đóng dấu + upload → transaction **khoá `attendance_windows … for update`**: trùng mặt mã khác (`DUPLICATE_ABOVE`) → cả hai `suspect`.
  - **GPS chỉ gắn cờ, không tự từ chối**: accuracy < 1 m hoặc tốc độ > 50 m/s giữa 2 lượt → `suspect/gps_anomaly` (migration 0005). Server không chứng minh được toạ độ; lớp chống điểm danh hộ chính là mặt + thẻ + trùng mặt. Sai số > 100 m → `retry/low_accuracy`: không xử lý ảnh, không tính lượt bị từ chối (đã có, test "chuỗi B" trong `checkin.test.ts`).
  - **So mặt** (chờ T011): với thẻ theo FR-035a < 0,35 từ chối / 0,35–0,5 nghi vấn / ≥ 0,5 đạt; `CHECKIN_MATCH_ABOVE` 0,55 CHỈ cho check-out/đột xuất ↔ lượt check-in; trùng mặt `DUPLICATE_ABOVE` 0,45.
  - **Trùng mặt**: cả hai lượt thành nghi vấn, không tự từ chối. **SV không thấy lý do nghi vấn** (`reason: null`). Thẻ `pending_review` → 412 `CARD_PENDING_REVIEW`.
  - **Goong không bắt buộc**: thiếu `GOONG_API_KEY` / lỗi / quá 1,5 s → ảnh bằng chứng in toạ độ.
  - Mỗi buổi chỉ một khung check-in (`CHECKIN_EXISTS`) — **chưa mở lại được sau khi đóng sớm** (việc A bên dưới).
  - Mọi lượt có kết luận ghi `attendance_events` + `attendance-record.v1` (`records/`); 409 `ALREADY_DONE` không tạo lượt. Ảnh + vector chỉ lưu với valid/suspect; ảnh `evidence/{session}/{window}/{event}.jpg` xoá sau 7 ngày; hồ sơ tới hết lớp + 30 ngày. Tối đa 3 lượt bị từ chối/khung.
  - Đồng hồ: nghiệp vụ buổi/khung dùng `clock.ts` `now()` (test: `setNowForTest`). Check-out tạo sẵn khi mở check-in, "đang mở" tính theo giờ — không cron.
- **Đóng dấu ảnh**: sharp `text` + `fontfile` Be Vietnam Pro; `evidence/fontconfig.ts` tự ghi `fonts.conf` **không cachedir** + đặt `FONTCONFIG_FILE` (đa tiến trình dựng cache fontconfig → crash 0xC0000374, đã tái hiện trên Windows). Vitest backend đặt biến trước khi tạo worker.
- **Trang `/sv/the-sinh-vien/debug` và `POST /api/student/liveness-probe(/nonce)`** chỉ preview/dev, production 404 (`yawDebugEnabled()` fail closed): trang = server component gọi `notFound()` (`359bcf7`; unit test + e2e `debug-page` trên bản build production), API có test tích hợp `liveness-probe.test.ts`.

### 5. Đang dở
- **PR #3** (`001-us2-checkin` → `main`, US2 lượt 1 test + backend): **CHƯA merge**, commit cuối `467680c`, CI xanh (`check`, `codeql`, Vercel Preview).
- **Migration `0005_checkin_gps_anomaly`**: ĐÃ chạy trên Supabase PREVIEW (người dùng báo). **PROD CHƯA chạy — BẮT BUỘC chạy ngay trước khi merge PR #3** (`db:migrate`, `CONFIRM_REMOTE_DB=true`), nếu không lượt bị cờ `gps_anomaly` sẽ lỗi khi ghi.
- **Chưa kiểm chứng trên Vercel/điện thoại**: thời gian check-in (`checkin_timing`, mục tiêu p95 ≤ 5 s; liveness của đăng ký thẻ đã 4,97 s/1 mẫu), đóng dấu ảnh + fontconfig trên Linux, Goong. Test check-in dùng nhận diện giả.
- **(người dùng báo)** iPhone thật (iOS 18.4 Safari, 4G, thẻ UTC thật): đăng ký thẻ thành công; Vercel 201 = 6,84 s, 422 = 4,97 s; MediaPipe tải 4,17 MB, khởi tạo ~4,5–6,7 s lần đầu. Android chưa thử (cả "Thử liveness" lẫn đăng ký thẻ); bộ nhớ function chưa đo.
- Công cụ preview/dev đã dùng được trên Preview + iPhone (người dùng báo): "Thử liveness (không tốn lượt)" (`card/liveness-probe.ts`, bộ đếm riêng 30/giờ/SV; nonce purpose `card` + challenge bọc `{kind:'liveness_probe'}` → không dùng chéo) và bảng so sánh yaw client ↔ server (`face/yaw-debug.ts`). Check-in cũng trả `yawDebug` ở preview/dev.
- Token `gh` thiếu quyền `workflow` → push sửa `.github/workflows/*` qua Git Credential Manager (`git -c credential.helper= -c credential.helper=manager push`); push thường dùng `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push` (GCM hay treo).

### 6. Việc tiếp theo (theo thứ tự)
A. **Sửa nhanh backend** (trên PR #3 hoặc nhánh tiếp): GV **mở lại check-in đã đóng sớm** — "muộn" vẫn tính từ lần mở ĐẦU, tâm GPS giữ nguyên trừ khi GV gửi vị trí mới, ghi audit. (Sai số GPS SV > 100 m → thử lại, không xử lý ảnh, không tính lượt: ĐÃ có.)
B. **US2 lượt 2 — UI**: trang điểm danh SV (T079 lớp đang mở, T080 camera + `FaceChallenge` + lớp phủ giờ/địa chỉ qua `/api/geo/reverse`, T083 client báo lỗi) + trang buổi học / giám sát của GV (T078 mở điểm danh, lấy GPS, cảnh báo > 50 m); e2e T068: GV mở → SV điểm danh → GV duyệt.
C. Thử trên điện thoại (máy khác làm GV, iPhone làm SV), đo thời gian thật (p95 ≤ 5 s), **chạy migration 0005 trên PROD**, rồi người dùng merge PR #3.
D. Android: "Thử liveness" + đăng ký thẻ; T011 thêm người/máy.
E. T145 tối ưu thời gian đăng ký thẻ; T009 đo thêm mẫu + bộ nhớ. Polish: T144 Turnstile; nâng action Node 20; cron dọn ảnh/vector hết hạn (`purge_after`); cảnh báo `jose` (Edge) ở middleware.

### 7. Quy ước làm việc
- **Viết test trước**, chạy thấy FAIL rồi mới cài đặt.
- Kiểm **exit code từng lệnh** `pnpm test` / `typecheck` / `lint` / `build` / `check:traces`; **≠ 0 thì không commit** (không nối commit sau `grep`/pipe).
- Mỗi nhóm việc **một commit riêng**, message tiếng Việt, kết bằng dòng `Co-Authored-By` theo hướng dẫn phiên; mỗi commit phải build được. Đánh dấu `[x]` trong `tasks.md` khi xong.
- **Không merge PR, không push thẳng lên `main`.** Làm trên nhánh tính năng rồi mở PR.
- **KHÔNG BAO GIỜ** in hay commit secret, file `.env*`, ảnh thẻ/mặt người thật, thư mục `models/`. Với DB chỉ in **host**, không in URL. Ảnh thử dùng ảnh tự sinh.
- PGlite chỉ một tiến trình: không mở `apps/web/.pglite` khi `pnpm dev` đang chạy — thử trên bản sao.
- Báo cáo cuối mỗi lượt: đã làm gì · quyết định cần người review · cái chưa kiểm chứng · số test.
