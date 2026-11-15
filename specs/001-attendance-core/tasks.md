---

description: "Task list — 001-attendance-core"
---

# Tasks: Điểm danh lõi (lớp học, thẻ SV, check-in/check-out khuôn mặt + GPS, bảng điểm danh, trợ lý AI, bảo mật)

**Input**: Design documents from `/specs/001-attendance-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/ai-filter-spec.schema.json, quickstart.md

**Tests**: BẮT BUỘC cho logic quyết định theo Constitution VI (viết test trước, chạy thấy FAIL rồi mới cài đặt). Các task test được đặt trước task cài đặt tương ứng trong mỗi phase.

**Organization**: Nhóm theo user story để mỗi story cài đặt và kiểm thử độc lập.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US7 theo spec.md
- Đường dẫn theo cấu trúc một app Next.js trong plan.md (`src/`, `tests/`, `scripts/`)

## Thứ tự story (theo ưu tiên + phụ thuộc)

US1 (P1) → US6 (P1, thẻ SV — cần trước khi điểm danh) → US2 (P1) → US3 (P1) → US5 (P2) → US4 (P2) → US9 (P2, hồ sơ JSON) → US8 (P2, vắng phép) → US7 (P3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Khởi tạo dự án và công cụ

> 2026-11-07: dự án chuyển sang monorepo pnpm (`apps/web`, `packages/backend`, `packages/database`, `packages/shared`) — xem plan.md › Project Structure. Đường dẫn trong các task đã được cập nhật.

- [x] T001 Khởi tạo Next.js 15 + TypeScript + App Router + pnpm tại thư mục gốc (`package.json`, `next.config.ts`, `tsconfig.json`)
- [x] T002 [P] Cấu hình ESLint + Prettier + strict TypeScript trong `eslint.config.mjs`, `.prettierrc`
- [x] T003 [P] Cài Tailwind CSS + shadcn/ui, font Be Vietnam Pro trong `apps/web/src/app/globals.css`, `apps/web/public/fonts/`
- [x] T004 [P] Cấu hình Vitest (unit + integration) trong `packages/*/vitest.config.mts` và Playwright trong `apps/web/playwright.config.ts` (camera/geolocation giả)
- [x] T005 [P] Khởi tạo Supabase CLI local và bucket private `evidence`, `cards` trong `supabase/config.toml`
- [x] T006 [P] Tạo `.env.example` với mọi biến trong quickstart.md và schema kiểm tra env bằng Zod trong `packages/backend/src/env.ts`
- [x] T007 [P] CI GitHub Actions: lint, type-check, test, `pnpm audit --prod` (fail khi High/Critical), CodeQL trong `.github/workflows/ci.yml` và Dependabot trong `.github/dependabot.yml`
- [x] T008 [P] Script tải model SCRFD-500M + MobileFaceNet w600k_mbf vào `apps/web/models/` trong `scripts/download-models.ts`; thêm `apps/web/models/` vào `.gitignore`

---

## Phase 1b: Spike kỹ thuật (BẮT BUỘC trước Phase 2 — research R1–R3)

**Purpose**: Xác nhận các giả định rủi ro nhất trước khi xây phần còn lại

- [ ] T009 Spike *(cục bộ xong 2026-11-07: ~48 ms/ảnh, bundle 105,6 MB; Vercel 2026-11-16, 1 mẫu: đăng ký thẻ 201 = 6,84 s, 422 liveness = 4,97 s — vượt 5 s; còn đo nhiều mẫu cold/warm + bộ nhớ, xem research "Kết quả thử thật")*: route thử `apps/web/src/app/api/spike/face/route.ts` chạy `onnxruntime-node` detect + embed trên 1 ảnh; deploy preview Vercel, ghi kích thước bundle, cold start, latency 1 ảnh và 3 khung vào `specs/001-attendance-core/research.md` (R1)
- [ ] T010 [P] Spike *(1/5 thẻ: mã vạch Code128 = mã SV; 2026-11-16: 1 thẻ thật đăng ký thành công trên iPhone iOS 18.4 Safari qua Vercel — còn ≥ 4 thẻ khác)*: đọc mã vạch + OCR trên ≥ 5 ảnh thẻ UTC thật bằng `zxing-wasm`/`tesseract.js` trong `packages/backend/scripts/spike-card.ts`; ghi kết quả mã vạch có chứa mã SV hay không vào research.md (R3)
- [ ] T011 [P] Spike: script hiệu chỉnh `packages/backend/scripts/calibrate.ts` tính cosine thẻ↔selfie, selfie↔selfie, người khác; chạy trên ≥ 20 tình nguyện viên, ghi ngưỡng sơ bộ `CARD_REJECT_BELOW`, `CARD_ACCEPT_ABOVE`, `DUPLICATE_ABOVE`, `CHECKIN_MATCH_ABOVE` vào research.md
- [ ] T012 Quyết định Go/No-Go — **ngưỡng tách (2026-11-16)**: **đăng ký thẻ p95 ≤ 10 s** (làm một lần cho cả khoá, có màn tiến trình) · **điểm danh p95 ≤ 5 s** (mỗi buổi, SC-002). Nếu T009 không đạt ngưỡng tương ứng → cập nhật `specs/001-attendance-core/plan.md`, `specs/001-attendance-core/research.md` và `.specify/memory/constitution.md` (VII) sang service Python riêng trước khi tiếp tục

**Checkpoint**: Pipeline khuôn mặt và đọc thẻ chạy được trên Vercel với ngưỡng sơ bộ

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB, auth, bảo mật nền, tiện ích dùng chung — MUST xong trước mọi user story

### Tests (viết trước)

- [x] T013 [P] Unit test Haversine (khoảng cách đã biết, biên 50 m) trong `packages/backend/tests/unit/geo/haversine.test.ts`
- [x] T014 [P] Unit test quy đổi tiết→giờ, ca→tiết, ngày + tiết → `starts_at/ends_at` theo Asia/Ho_Chi_Minh trong `packages/shared/tests/periods.test.ts`
- [x] T015 [P] Unit test bỏ dấu tiếng Việt (gồm đ/Đ) trong `packages/shared/tests/vn-text.test.ts`
- [x] T016 [P] Unit test JWT phát hành/xác minh/hết hạn/thu hồi `sid` trong `packages/backend/tests/unit/auth/jwt.test.ts`
- [x] T017 [P] Unit test escape công thức Excel/CSV (`= + - @ \t \r`) trong `packages/backend/tests/unit/security/formula-escape.test.ts`
- [x] T018 [P] Unit test kiểm tra upload (magic bytes, kích thước, re-encode, bỏ EXIF) trong `packages/backend/tests/unit/security/upload.test.ts`

### Implementation

- [x] T019 Drizzle schema toàn bộ bảng theo data-model.md trong `packages/database/src/schema.ts` (users, students, student_cards, periods, shifts, classes, class_schedules, enrollments, sessions, attendance_windows, attendance_events, manual_overrides, audit_logs, ai_queries, scan_nonces, rate_limits, user_sessions, security_events, login_failures, geocode_cache)
- [x] T020 Migration SQL: extensions `vector`, `unaccent`, `pg_trgm`, `pgcrypto`, hàm `f_unaccent` IMMUTABLE, cột sinh `search_text` + GIN trgm, exclusion constraint khung chồng giờ, unique partial index, RLS deny-all cho `anon`/`authenticated` trong `packages/database/migrations/0001_init.sql`
- [x] T021 Seed 16 tiết + 5 ca theo FR-010a/FR-010b trong `packages/database/src/seed/periods.ts`; seed demo (admin, giảng viên, lớp mẫu) trong `packages/database/scripts/seed-demo.ts`
- [x] T022 [P] Kết nối DB qua Supavisor transaction pooler (`prepare: false`) trong `packages/database/src/client.ts`
- [x] T023 [P] Haversine trong `packages/backend/src/geo/haversine.ts`
- [x] T024 [P] Tiện ích tiết/ca/giờ VN trong `packages/shared/src/periods.ts` và bỏ dấu trong `packages/shared/src/vn-text.ts`
- [x] T025 [P] JWT (`jose`) + cookie httpOnly/Secure/SameSite + bảng `user_sessions` trong `packages/backend/src/auth/session.ts`
- [x] T026 [P] Băm mật khẩu argon2id trong `packages/backend/src/auth/password.ts`
- [x] T027 Guards RBAC `requireRole`, `assertOwnsClass`, `assertOwnsSession`, `assertSelf` trong `packages/backend/src/auth/guards.ts`
- [x] T028 `middleware.ts`: security headers (HSTS, CSP nonce, nosniff, frame-ancestors none, Referrer-Policy, Permissions-Policy camera/geolocation self), kiểm Origin cho method ≠ GET (CSRF), chặn khu `/gv`, `/admin`, `/sv` theo vai trò trong `apps/web/src/middleware.ts`
- [x] T029 [P] *(tầng ứng dụng: bảng `rate_limits` upsert nguyên tử theo danh tính; tầng biên WAF cấu hình ở T131)* Rate limit 2 tầng: wrapper `@vercel/firewall` `checkRateLimit` + dự phòng bảng `rate_limits`, trả 429 + `Retry-After` trong `packages/backend/src/security/rate-limit.ts`
- [x] T030 [P] Ghi `security_events` + logger JSON lọc trường nhạy cảm (embedding, ảnh, mật khẩu) trong `packages/backend/src/security/events.ts`, `packages/backend/src/log.ts`
- [x] T031 [P] Kiểm tra upload (giới hạn kích thước, magic bytes, `sharp` re-encode JPEG bỏ EXIF) trong `packages/backend/src/security/upload.ts`
- [x] T032 [P] Escape công thức khi xuất trong `packages/backend/src/security/formula-escape.ts`
- [x] T033 Helper route handler chuẩn: parse Zod `.strict()`, map lỗi `{error:{code,message}}`, gọi guard + rate limit trong `packages/backend/src/http/handler.ts`
- [x] T034 [P] Storage helper: upload private, signed URL 5 phút, xoá trong `packages/backend/src/evidence/storage.ts`
- [x] T035 Đăng nhập giảng viên/admin `POST /api/auth/staff/login` (rate limit, khoá 15' sau 5 lần sai, `login_failures`), `POST /api/auth/logout`, `GET /api/me` trong `apps/web/src/app/api/auth/**/route.ts`
- [x] T036 [P] Layout tiếng Việt, trang đăng nhập GV trong `apps/web/src/app/(auth)/login/page.tsx`, khung trang `apps/web/src/app/gv/layout.tsx`, `apps/web/src/app/admin/layout.tsx`
- [x] T037 [P] Admin: quản lý giảng viên (tạo/khoá/đặt lại mật khẩu, thu hồi phiên) + sửa bảng tiết `apps/web/src/app/api/admin/instructors/**/route.ts`, `apps/web/src/app/api/admin/periods/route.ts`, `apps/web/src/app/admin/**/page.tsx`
- [x] T038 [P] Admin xem dữ liệu điểm danh toàn trường (FR-002): API `GET /api/admin/attendance` (chỉ Admin, phân trang, lọc theo giảng viên, lớp học phần, học kỳ, khoảng ngày; số lượt hợp lệ/nghi vấn/từ chối, số đơn vắng phép theo lớp/buổi — truy vấn trực tiếp, chưa phụ thuộc FilterSpec) + trang danh sách lớp toàn trường, mở bảng điểm danh của lớp ở chế độ chỉ đọc khi US5 xong, ghi `audit_logs` khi Admin xem/xuất trong `apps/web/src/app/api/admin/attendance/route.ts`, `apps/web/src/app/admin/diem-danh/page.tsx`
- [x] T039 Integration test phân quyền tự sinh: duyệt mọi route trong `apps/web/src/app/api`, gọi với vai trò/chủ sở hữu sai → 401/403 trong `packages/backend/tests/integration/security/authz-matrix.test.ts` (SC-014; mở rộng dần mỗi phase)

**Checkpoint**: DB, auth, RBAC, header bảo mật, rate limit sẵn sàng

---

## Phase 3: User Story 1 — Giảng viên tạo lớp và nhập danh sách lớp (P1) 🎯 MVP

**Goal**: Giảng viên tạo lớp học phần (≤ 15 tuần, lịch theo tiết/ca, phòng) và nhập danh sách từ .xlsx/.csv có xem trước

**Independent Test**: Quickstart Q1–Q3

### Tests

- [x] T040 [P] [US1] Unit test nhận diện cột (MSSV/Mã SV/Mã sinh viên…, có/không dấu), validate dòng, phát hiện trùng trong `packages/backend/tests/unit/roster/parse.test.ts`
- [x] T041 [P] [US1] Unit test diff danh sách (mới / đã có / rút) trong `packages/backend/tests/unit/roster/diff.test.ts`
- [x] T042 [P] [US1] Integration test tạo lớp 16 tuần → 422 `DURATION_EXCEEDED`; preview + commit roster-40.xlsx → 38 SV trong `packages/backend/tests/integration/classes.test.ts`

### Implementation

- [x] T043 [P] [US1] Fixtures `packages/backend/tests/fixtures/roster-40.xlsx`, `roster-ansi.csv`, `roster-formula.xlsx` (tên chứa `=HYPERLINK`)
- [x] T044 [P] [US1] Parser .xlsx (`exceljs`, giới hạn 2.000 dòng, từ chối tỉ lệ nén bất thường) và .csv (`papaparse` + `iconv-lite` nhận UTF-8/BOM/Windows-1258) trong `packages/backend/src/roster/parse.ts`
- [x] T045 [P] [US1] Nhận diện cột + validate (mã `^[0-9]{6,12}$`, Họ, Tên, Lớp, Khoá tuỳ chọn) trong `packages/backend/src/roster/columns.ts`
- [x] T046 [US1] Diff + commit danh sách (upsert students theo mã, enrollments active/withdrawn, giữ lịch sử) trong `packages/backend/src/roster/commit.ts`
- [x] T047 [US1] Service lớp học: tạo/sửa, kiểm ≤ 105 ngày, lịch nhiều buổi/tuần theo tiết, phòng mặc định, cấu hình bán kính/thời lượng trong `packages/backend/src/classes/service.ts`
- [x] T048 [US1] API `GET/POST /api/classes`, `PATCH /api/classes/{id}` trong `apps/web/src/app/api/classes/route.ts`, `apps/web/src/app/api/classes/[id]/route.ts`
- [x] T049 [US1] API `POST /api/classes/{id}/roster/preview|commit`, `POST/DELETE /api/classes/{id}/students/{code}` (rate limit nhập file) trong `apps/web/src/app/api/classes/[id]/roster/**/route.ts`, `apps/web/src/app/api/classes/[id]/students/[code]/route.ts`
- [x] T050 [P] [US1] UI danh sách + tạo lớp (chọn ca 1–5 hoặc khoảng tiết, phòng) trong `apps/web/src/app/gv/lop/page.tsx`, `apps/web/src/app/gv/lop/tao/page.tsx`
- [x] T051 [US1] UI nhập danh sách: tải file, bảng xem trước với dòng lỗi, ghép cột thủ công, xác nhận trong `apps/web/src/app/gv/lop/[classId]/danh-sach/page.tsx`
- [x] T052 [US1] Ghi `audit_logs` cho tạo lớp, nhập danh sách, rút SV trong `packages/backend/src/classes/audit.ts`

**Checkpoint**: Q1–Q3 đạt

---

## Phase 4: User Story 6 — Sinh viên đăng ký thẻ sinh viên (P1)

**Goal**: SV đăng nhập bằng mã SV, đồng ý điều khoản, chụp trực tiếp thẻ; hệ thống đọc mã, cắt chân dung làm ảnh tham chiếu

**Independent Test**: Quickstart Q4–Q5; US6 scenarios 1–6, 8–9

### Tests

- [x] T053 [P] [US6] Unit test xác thực thẻ: mã đọc được khác mã đăng nhập → `CODE_MISMATCH`; không thấy chân dung → `NO_PORTRAIT`; mờ → `UNREADABLE` trong `packages/backend/tests/unit/card/verify.test.ts`
- [x] T054 [P] [US6] Integration test đăng nhập SV (không thuộc lớp → 404 chung chung, rate limit 10/5'/IP, 5/5'/mã) trong `packages/backend/tests/integration/auth-student.test.ts`
- [x] T055 [P] [US6] Integration test đăng ký thẻ: nonce hết hạn/dùng lại bị từ chối; thẻ trùng mặt mã khác → `pending_review` trong `packages/backend/tests/integration/card.test.ts`

### Implementation

- [x] T056 [P] [US6] ONNX sessions dùng chung (nạp 1 lần/instance), detect SCRFD + 5 điểm mốc, align, embed 512-d, cosine trong `packages/backend/src/face/{sessions,detect,align,embed,similarity}.ts`
- [x] T057 [P] [US6] Đọc mã vạch (`zxing-wasm`) + OCR dự phòng (`tesseract.js` chỉ chữ số) trong `packages/backend/src/card/decode.ts`
- [x] T058 [US6] Xác thực thẻ: decode → so mã → detect chân dung trên thẻ → crop → embed → kiểm trùng thẻ active (pgvector) → lưu `student_cards` + ảnh vào bucket `cards`, tính `purge_after` trong `packages/backend/src/card/register.ts`
- [x] T059 [US6] Nonce dùng một lần (purpose card/checkin, hạn 2', challenge) trong `packages/backend/src/security/nonce.ts`
- [x] T060 [US6] API `POST /api/auth/student/login` (thông báo lỗi chung, rate limit, ghi security_events), `POST /api/student/consent`, `POST /api/student/card/nonce`, `POST /api/student/card` trong `apps/web/src/app/api/auth/student/login/route.ts`, `apps/web/src/app/api/student/**/route.ts`
- [x] T061 [US6] API duyệt/đặt lại thẻ `POST /api/admin/students/{id}/card/reset` (+ duyệt `pending_review` cho GV có SV trong lớp) trong `apps/web/src/app/api/admin/students/[id]/card/**/route.ts`
- [X] T062 [P] [US6] UI đăng nhập SV bằng mã trong `apps/web/src/app/(auth)/sv/page.tsx` *(+ màn đồng ý `/sv/dong-y`, chọn lớp `/sv/lop` — API `GET /api/student/classes`)*
- [X] T063 [US6] *(2026-11-10; kèm mặt trực tiếp 3 khung FR-045a + hàng chờ duyệt GV `/gv/lop/[classId]/the`; fallback `<input capture=environment>` chỉ hiện trên thiết bị cảm ứng khi không mở được camera trong trang — xem FR-045)* UI đồng ý điều khoản + chụp thẻ chỉ bằng camera trực tiếp (không input file), khung căn thẻ, hướng dẫn chụp lại trong `apps/web/src/app/sv/the-sinh-vien/page.tsx`, `apps/web/src/components/camera/CardCapture.tsx`
- [x] T064 [US6] Cập nhật `purge_after` của thẻ khi ghi danh/ngày kết thúc lớp thay đổi trong `packages/backend/src/card/retention.ts`

**Checkpoint**: SV có thẻ `active`; Q4–Q5 đạt

---

## Phase 5: User Story 2 — Sinh viên check-in bằng khuôn mặt + GPS (P1)

**Goal**: GV mở check-in (lưu tâm GPS); SV chọn lớp, quét mặt có thử thách quay đầu, server quyết định Hợp lệ/Nghi vấn/Từ chối, đóng dấu ảnh, ghi hồ sơ `attendance-record.v1` cho mọi lượt

**Independent Test**: Quickstart Q6–Q9, Q12; US2 scenarios 1–10

### Tests

- [ ] T065 [P] [US2] Unit test liveness: chuỗi yaw đúng/sai, 3 khung khác người, 0/2 mặt → retry trong `packages/backend/tests/unit/face/liveness.test.ts`
- [ ] T066 [P] [US2] Unit test pipeline quyết định (bảng kịch bản: ngoài phạm vi, accuracy > 100 m → retry, thẻ < ngưỡng thấp → rejected, vùng biên → suspect, khung đóng, chưa ghi danh, đã điểm danh, hết lượt thử) trong `packages/backend/tests/unit/attendance/decide.test.ts`
- [ ] T067 [P] [US2] Integration test `POST /api/windows/{id}/events`: thiếu nonce/ảnh 10 MB bị từ chối < 200 ms trước khi xử lý ảnh (FR-082) trong `packages/backend/tests/integration/checkin.test.ts`
- [ ] T068 [P] [US2] E2E Playwright: GV mở check-in → SV đăng nhập, chọn lớp, quét (camera giả + geolocation giả) → thấy "Hợp lệ" trong `apps/web/tests/e2e/checkin.spec.ts`
- [ ] T069 [P] [US2] Unit test dựng hồ sơ từ kết quả từng bước (dừng ở bước 2, 3, 5, 7; đủ trường; toạ độ làm tròn; không có embedding/ảnh) + validate Zod schema trong `packages/backend/tests/unit/records/build.test.ts`
- [ ] T070 [P] [US2] Unit test diễn giải tiếng Việt theo mẫu cho mỗi `reason` trong `packages/backend/tests/unit/records/narrative.test.ts`

### Implementation

- [ ] T071 [P] [US2] Liveness server-side: yaw từ 5 điểm mốc, khớp chuỗi thử thách, cùng người qua 3 khung, chọn khung nhìn thẳng trong `packages/backend/src/face/liveness.ts`
- [ ] T072 [P] [US2] Reverse geocode Goong + cache ô toạ độ 4 chữ số, fallback toạ độ trong `packages/backend/src/geo/reverse-geocode.ts` + API `GET /api/geo/reverse` (rate limit) cho lớp phủ camera trong `apps/web/src/app/api/geo/reverse/route.ts`
- [ ] T073 [P] [US2] Đóng dấu ảnh (giờ server, địa chỉ, lớp, phòng) bằng `sharp` + SVG + font Be Vietnam Pro trong `packages/backend/src/evidence/stamp.ts`
- [ ] T074 [US2] Service buổi/khung: `open-checkin` (buổi theo lịch hôm nay hoặc học bù, tâm GPS + sai số, tạo luôn khung check-out theo giờ kết thúc tiết cuối ± offset), `PATCH` đổi phòng/bỏ check-out, đóng sớm, tính "đang mở" theo `now()` trong `packages/backend/src/attendance/windows.ts`
- [ ] T075 [US2] Pipeline quyết định bước 1–5 + 8 của plan.md (nonce, khung, ghi danh, GPS, liveness, so thẻ 2 ngưỡng, `late_minutes`, đóng dấu, lưu event, `purge_after`) trong `packages/backend/src/attendance/decide.ts`
- [ ] T076 [US2] API GV `GET /api/classes/{id}/sessions/today`, `POST /api/classes/{id}/sessions/open-checkin`, `PATCH /api/sessions/{id}`, `POST /api/windows/{id}/close` trong `apps/web/src/app/api/classes/[id]/sessions/**/route.ts`, `apps/web/src/app/api/sessions/[id]/route.ts`, `apps/web/src/app/api/windows/[id]/close/route.ts`
- [ ] T077 [US2] API SV `GET /api/student/classes`, `POST /api/windows/{id}/scan-nonce`, `POST /api/windows/{id}/events` (rate limit theo SV) trong `apps/web/src/app/api/student/classes/route.ts`, `apps/web/src/app/api/windows/[id]/{scan-nonce,events}/route.ts`
- [ ] T078 [P] [US2] UI GV "Mở điểm danh": hiện buổi hôm nay (tiết, giờ, phòng), lấy GPS, cảnh báo sai số > 50 m, chỉnh thời lượng/phòng trong `apps/web/src/app/gv/lop/[classId]/mo-diem-danh/page.tsx`
- [ ] T079 [P] [US2] UI SV danh sách lớp (đánh dấu lớp đang mở) trong `apps/web/src/app/sv/lop/page.tsx`
- [ ] T080 [US2] UI SV điểm danh: camera trước, lớp phủ giờ/địa chỉ/lớp/phòng, MediaPipe hướng dẫn quay đầu, chụp 3 khung nén 720p, gửi + hiển thị kết quả/lý do/lượt còn lại trong `apps/web/src/app/sv/diem-danh/[windowId]/page.tsx`, `apps/web/src/components/camera/FaceChallenge.tsx`
- [ ] T081 [US2] Zod schema `attendance-record.v1` + builder gom kết quả từng bước trong `packages/backend/src/records/schema.ts`, `packages/backend/src/records/build.ts`
- [ ] T082 [US2] Gắn builder vào pipeline ngay từ đầu (Constitution III): ghi `record` cho mọi kết quả (kể cả trả về sớm), lưu `retry`, `image_sha256`, `record_purge_after` trong `packages/backend/src/attendance/decide.ts`
- [ ] T083 [US2] `scan_sessions` khi cấp nonce + API `POST /api/scan-sessions/{id}/client-error`; client báo lỗi camera/GPS/mạng trong `apps/web/src/app/api/scan-sessions/[id]/client-error/route.ts`, `apps/web/src/components/camera/FaceChallenge.tsx`
- [ ] T084 [P] [US2] Diễn giải tiếng Việt theo mẫu trong `packages/backend/src/records/narrative.ts`

**Checkpoint**: Check-in đầu-cuối chạy; Q6–Q9, Q12 đạt

---

## Phase 6: User Story 3 — Phát hiện một khuôn mặt dùng cho nhiều mã SV (P1)

**Goal**: Trùng mặt giữa các mã trong cùng khung → tất cả lượt liên quan "Nghi vấn"; giảng viên duyệt

**Independent Test**: Quickstart Q10–Q11; US3 scenarios 1–3

### Tests

- [ ] T085 [P] [US3] Integration test: A rồi C cùng mặt cùng khung → cả hai `suspect`; cùng người ở 2 lớp khác → cả hai `valid`; hai request trùng gửi đồng thời vẫn bị bắt (khoá theo window) trong `packages/backend/tests/integration/duplicate.test.ts`

### Implementation

- [ ] T086 [US3] Bước 7 pipeline: truy vấn pgvector trong khung, `SELECT … FOR UPDATE` theo `window_id`, cập nhật các lượt kia thành `suspect` + `duplicate_of` trong cùng transaction trong `packages/backend/src/attendance/duplicate.ts`
- [ ] T087 [US3] Cảnh báo GV khi có lượt nghi vấn mới (cờ trên bảng + danh sách cần duyệt) trong `packages/backend/src/attendance/alerts.ts`
- [ ] T088 [US3] UI duyệt nghi vấn: ảnh các lượt trùng đặt cạnh nhau + ảnh thẻ + độ tương đồng, duyệt từng lượt trong `apps/web/src/app/gv/lop/[classId]/nghi-van/page.tsx`

**Checkpoint**: Q10–Q11 đạt — MVP chống điểm danh hộ hoàn chỉnh (US1 + US6 + US2 + US3)

---

## Phase 7: User Story 5 — Bảng điểm danh theo buổi với ô màu (P2)

**Goal**: Bảng hàng = SV, nhóm cột = buổi (ngày · tiết · phòng) gồm ô In/Out, tô màu, cập nhật ≤ 5 s, xem bằng chứng, sửa thủ công, xuất Excel

**Independent Test**: Quickstart Q7 (đổi màu), Q15, Q19; US5 scenarios 1–5

### Tests

- [ ] T089 [P] [US5] Unit test tính ô (override, gồm `excused` → 🟦 P > valid > suspect > đang mở xám > đỏ; Out chưa mở; checkout_skipped) và trạng thái buổi FR-067 trong `packages/backend/tests/unit/attendance/cells.test.ts`
- [ ] T090 [P] [US5] Unit test xuất Excel: màu/ký hiệu ✓ ✗ khớp bảng, cột tổng hợp, ô công thức bị escape trong `packages/backend/tests/unit/query/export-sheet.test.ts`

### Implementation

- [ ] T091 [US5] Tính ô + trạng thái buổi + tổng hợp (có mặt, về sớm, vắng, % chuyên cần) trong `packages/backend/src/attendance/cells.ts`
- [ ] T092 [US5] API `GET /api/classes/{id}/sheet?since=` (pivot, chỉ trả thay đổi) trong `apps/web/src/app/api/classes/[id]/sheet/route.ts`
- [ ] T093 [US5] API bằng chứng `GET /api/sessions/{id}/students/{studentId}/evidence` (signed URL ảnh thẻ + In/Out) và `POST …/override` (lý do ≥ 5 ký tự, audit) trong `apps/web/src/app/api/sessions/[id]/students/[studentId]/**/route.ts`
- [ ] T094 [US5] Xuất .xlsx bảng điểm danh (`exceljs`, tô màu, escape công thức) trong `packages/backend/src/query/export-sheet.ts` + `POST /api/classes/{id}/export` trong `apps/web/src/app/api/classes/[id]/export/route.ts`
- [ ] T095 [US5] UI bảng: TanStack Table cuộn ngang, cố định 4 cột SV, nhóm cột "dd/mm · T1–3 · phòng", ô màu 🟩🟥🟨⬜, polling SWR 3 s, cột tổng hợp trong `apps/web/src/app/gv/lop/[classId]/page.tsx`, `apps/web/src/components/sheet/AttendanceSheet.tsx`
- [ ] T096 [US5] UI chi tiết ô: ảnh thẻ cạnh ảnh In/Out, khoảng cách, độ khớp, lịch sử sửa, form sửa trạng thái + lý do; cảnh báo bằng chứng sắp xoá (FR-053) trong `apps/web/src/components/sheet/CellDetailDialog.tsx`

**Checkpoint**: Q15, Q19 đạt; ô đổi màu ≤ 5 s

---

## Phase 8: User Story 4 — Check-out tự động và kiểm tra đột xuất (P2)

**Goal**: Khung check-out tự mở theo giờ kết thúc tiết cuối; check-out phải khớp mặt check-in; kiểm tra đột xuất do GV mở

**Independent Test**: Quickstart Q13–Q14; US4 scenarios 0–5

### Tests

- [ ] T097 [P] [US4] Unit test: buổi T1–3 → check-out 9:15–9:35; chưa check-in → `NO_CHECKIN`; mặt Out khác mặt In → cả hai `suspect/checkin_mismatch` trong `packages/backend/tests/unit/attendance/checkout.test.ts`
- [ ] T098 [P] [US4] Integration test luồng check-in → rời phòng → check-out ngoài phạm vi → trạng thái "Về sớm" trong `packages/backend/tests/integration/checkout.test.ts`

### Implementation

- [ ] T099 [US4] Bước 6 pipeline: so embedding Out/spot-check với lượt In hợp lệ của chính mã, đánh dấu cả hai lượt trong `packages/backend/src/attendance/checkin-match.ts`
- [ ] T100 [US4] API `POST /api/sessions/{id}/spot-check` + bỏ check-out (`checkoutSkipped`) trong `apps/web/src/app/api/sessions/[id]/spot-check/route.ts`
- [ ] T101 [US4] UI SV: polling 10 s, thông báo trong trình duyệt khi khung check-out/đột xuất mở, nút check-out trong `apps/web/src/app/sv/lop/page.tsx`, `apps/web/src/components/notify/WindowWatcher.tsx`
- [ ] T102 [P] [US4] UI GV: nút "Kiểm tra đột xuất", "Cho lớp nghỉ sớm (bỏ check-out)", hiển thị giờ check-out tự mở trong `apps/web/src/app/gv/lop/[classId]/page.tsx`

**Checkpoint**: Q13–Q14 đạt

---

## Phase 9: User Story 9 — Hồ sơ điểm danh JSON & phản hồi thắc mắc (P2)

**Goal**: Xem/tải hồ sơ `attendance-record.v1` (đã được ghi từ Phase 5) sau khi ảnh xoá; SV gửi phản hồi, GV xem dòng thời gian và quyết định

**Independent Test**: Quickstart Q25–Q27; US9 scenarios 1–7

### Tests

- [ ] T103 [P] [US9] Integration test: lượt `retry` và `rejected` vẫn có record; sau purge ảnh record còn nguyên; phản hồi → change tạo manual_override trong `packages/backend/tests/integration/records-disputes.test.ts`

### Implementation

- [ ] T104 [US9] API dòng thời gian `GET /api/sessions/{id}/students/{studentId}/records` và export JSON/TXT theo ô/buổi/lớp trong `apps/web/src/app/api/sessions/[id]/students/[studentId]/records/route.ts`, `apps/web/src/app/api/classes/[id]/records/export/route.ts`
- [ ] T105 [US9] API phản hồi `POST/GET /api/student/disputes`, `GET /api/classes/{id}/disputes`, `POST /api/disputes/{id}/resolve` (giới hạn 2/buổi, hạn class.end + 30 ngày) trong `apps/web/src/app/api/student/disputes/route.ts`, `apps/web/src/app/api/classes/[id]/disputes/route.ts`, `apps/web/src/app/api/disputes/[id]/resolve/route.ts`
- [ ] T106 [P] [US9] UI SV gửi phản hồi từ trang lớp + xem kết quả trong `apps/web/src/app/sv/lop/[classId]/phan-hoi/page.tsx`
- [ ] T107 [US9] UI GV danh sách phản hồi + dòng thời gian hồ sơ (văn bản + xem JSON) + giữ nguyên/sửa trong `apps/web/src/app/gv/lop/[classId]/phan-hoi/page.tsx`; thêm tab "Hồ sơ" vào `apps/web/src/components/sheet/CellDetailDialog.tsx`

**Checkpoint**: Q25–Q27 đạt; SC-017

---

## Phase 10: User Story 8 — Vắng có phép tự động (P2)

**Goal**: SV nộp minh chứng; AI đọc giấy tờ → JSON; luật kiểm tra phân loại đạt/cần xem; GV duyệt hàng loạt hoặc tự duyệt; ô hiển thị 🟦 P

**Independent Test**: Quickstart Q22–Q24; US8 scenarios 1–8

### Tests

- [ ] T108 [P] [US8] Unit test luật kiểm tra — giấy tờ (tên bỏ dấu + Levenshtein ≤ 2, mã SV, khoảng ngày bao phủ, dấu/chữ ký) và đoạn chat (tên GV khớp kể cả tiền tố Thầy/Cô/TS., tin xin phép phía SV, tin đồng ý phía GV, ngày nghỉ = ngày học kể cả "hôm nay/mai", đồng ý trước giờ kết thúc buổi, dấu hiệu chỉnh sửa); chung: trùng sha256/ocr hash, chỉ nộp trong ngày học, độ tin cậy thấp → needs_review trong `packages/backend/tests/unit/leave/checks.test.ts`
- [ ] T109 [P] [US8] Unit test tính ô với đơn duyệt (🟦 P; điểm danh thật ưu tiên → đơn `unused`) bổ sung vào `packages/backend/tests/unit/attendance/cells.test.ts`
- [ ] T110 [P] [US8] Bộ ≥ 20 ảnh minh chứng mẫu gồm giấy tờ và ảnh chat Zalo/Messenger/Teams (tổng hợp, không dùng giấy tờ/tin nhắn thật) + đánh giá tỉ lệ đạt/cần xem (SC-015) và hiệu chỉnh ngưỡng độ tin cậy mặc định 0,80 / 0,85 (FR-103) trong `packages/backend/tests/fixtures/leave/`, `packages/backend/tests/integration/leave.eval.test.ts`

### Implementation

- [ ] T111 [P] [US8] Zod schema `leave-extraction.v1` (union `document` | `chat`) + gọi Claude vision structured output chỉ kèm ngày học — KHÔNG gửi họ tên/mã SV/GV (Constitution VIII); chỉ ảnh giấy tờ/ảnh chat trong `packages/backend/src/leave/extract.ts`
- [ ] T112 [P] [US8] Luật kiểm tra thuần trong `packages/backend/src/leave/checks.ts`
- [ ] T113 [US8] Service đơn: chặn buổi không thuộc hôm nay (giờ VN), draft → submit (nhiều buổi cùng ngày), duyệt/từ chối/huỷ, duyệt hàng loạt, tự duyệt theo cấu hình lớp chỉ cho `document` (không bao giờ cho `chat`), chuyển `unused`, audit trong `packages/backend/src/leave/service.ts`
- [ ] T114 [US8] API SV `GET /api/student/leave/eligible-sessions`, `POST /api/student/leave/extract`, `POST/GET /api/student/leave` (rate limit 10/giờ) trong `apps/web/src/app/api/student/leave/**/route.ts`
- [ ] T115 [US8] API GV `GET /api/classes/{id}/leave`, `POST /api/leave/{id}/decision`, `POST /api/classes/{id}/leave/approve-passed`, cấu hình `leaveAutoApprove` trong `apps/web/src/app/api/classes/[id]/leave/**/route.ts`, `apps/web/src/app/api/leave/[id]/decision/route.ts`
- [ ] T116 [US8] Cập nhật tính ô/tổng hợp: 🟦 P, tách vắng có phép/không phép (FR-062, FR-067) trong `packages/backend/src/attendance/cells.ts` và xuất Excel trong `packages/backend/src/query/export-sheet.ts`
- [ ] T117 [P] [US8] UI SV nộp đơn (chỉ hiện buổi hôm nay): chọn buổi, lý do, chọn loại minh chứng (giấy tờ / ảnh chat), nhắc cắt bỏ nội dung không liên quan, chụp/tải ảnh, thông báo xử lý tự động, xem tóm tắt trích xuất, lịch sử đơn trong `apps/web/src/app/sv/vang-phep/page.tsx`
- [ ] T118 [US8] UI GV danh sách đơn: lọc theo trạng thái, ảnh + JSON (giấy tờ: các trường; chat: dạng hội thoại với tin đồng ý được tô sáng) + checklist kiểm tra, duyệt/từ chối, "Duyệt tất cả đơn đạt", bật tự duyệt trong `apps/web/src/app/gv/lop/[classId]/vang-phep/page.tsx`
- [ ] T119 [US8] Thông báo kết quả đơn cho SV (trong ứng dụng) trong `apps/web/src/components/notify/WindowWatcher.tsx`

**Checkpoint**: Q22–Q24 đạt; SC-015, SC-016

---

## Phase 11: User Story 7 — Lọc, tìm kiếm, xuất dữ liệu và trợ lý AI (P3)

**Goal**: Sắp xếp/lọc/tìm không dấu, xuất mọi bảng; trợ lý AI sinh `FilterSpec`, chỉ đọc, giới hạn lớp của GV

**Independent Test**: Quickstart Q16–Q18; US7 scenarios 1–8

### Tests

- [ ] T120 [P] [US7] Unit test compiler `FilterSpec` → SQL: luôn có `instructor_id = :me`, mọi trường tham số hoá, `late_minutes`, aggregate + having, orderBy, limit ≤ 500 trong `packages/backend/tests/unit/query/compile.test.ts`
- [ ] T121 [P] [US7] Unit test validate `FilterSpec` bằng Zod sinh từ `contracts/ai-filter-spec.schema.json` (từ chối trường lạ) trong `packages/backend/tests/unit/query/filter-spec.test.ts`
- [ ] T122 [P] [US7] Bộ 30 câu hỏi mẫu + 10 câu prompt injection/ngoài phạm vi, đo tỉ lệ đúng (SC-010) trong `packages/backend/tests/integration/assistant.eval.test.ts`

### Implementation

- [ ] T123 [P] [US7] Zod schema `FilterSpec` trong `packages/backend/src/query/filter-spec.ts`
- [ ] T124 [US7] Compiler `FilterSpec` → Drizzle query (search qua `search_text` trgm, adminClass, cohort, trạng thái, khoảng ngày, late_minutes, aggregate) trong `packages/backend/src/query/compile.ts`
- [ ] T125 [US7] API `POST /api/classes/{id}/query` và mở rộng `POST /api/classes/{id}/export` cho `view:'query'` (.xlsx/.csv, escape công thức) trong `apps/web/src/app/api/classes/[id]/query/route.ts`
- [ ] T126 [US7] Trợ lý: prompt (chỉ câu hỏi + mô tả schema + danh sách lớp/buổi của GV, không tên/mã SV), structured output `claude-haiku-5-5` qua Vercel AI SDK, validate Zod, câu hỏi ≤ 500 ký tự, hỏi lại khi mơ hồ, từ chối ghi/ngoài phạm vi, ghi `ai_queries` + `security_events` trong `packages/backend/src/assistant/assistant.ts`
- [ ] T127 [US7] API `POST /api/assistant` (rate limit 20/giờ/GV) trong `apps/web/src/app/api/assistant/route.ts`
- [ ] T128 [P] [US7] UI thanh lọc/sắp xếp/tìm kiếm (không dấu) gắn với bảng trong `apps/web/src/components/sheet/FilterBar.tsx`
- [ ] T129 [US7] UI trợ lý AI: ô hỏi, hiển thị bộ lọc đã hiểu dạng chip chỉnh được, bảng kết quả, nút Xuất trong `apps/web/src/components/assistant/AssistantPanel.tsx`
- [ ] T130 [P] [US7] Trang tổng hợp nhiều lớp của GV (dùng FilterSpec) và bổ sung bộ lọc FilterSpec cho trang Admin toàn trường trong `apps/web/src/app/gv/tong-hop/page.tsx`, `apps/web/src/app/admin/diem-danh/page.tsx`

**Checkpoint**: Q16–Q18 đạt; SC-010 ≥ 90%

---

## Phase 12: Polish, bảo mật & vận hành (Cross-Cutting)

**Purpose**: Hoàn thiện bảo mật (FR-080–FR-096), lưu trữ, hiệu năng, tài liệu

- [ ] T131 Cron purge `GET /api/cron/purge` (Bearer `CRON_SECRET`): xoá ảnh + embedding event quá 7 ngày; thẻ, ảnh vắng phép, hồ sơ JSON, scan_sessions, phản hồi quá hạn; nonce hết hạn; lịch trong `vercel.json` — `apps/web/src/app/api/cron/purge/route.ts` (Q20)
- [ ] T132 [P] Cấu hình Vercel WAF: một quy tắc rate limit theo IP cho `/api/*` (gói Hobby), quy tắc chặn UA rỗng, bot ruleset ở chế độ log → challenge; ghi lại phần lưu được trong `vercel.json` và phần cấu hình dashboard trong `docs/security/waf.md`
- [ ] T133 [P] Quy trình ứng phó sự cố (bật/tắt Attack Challenge Mode, đọc security_events, khoá tài khoản) trong `docs/security/incident-runbook.md`
- [ ] T134 [P] Cảnh báo Admin khi vượt ngưỡng (> 50 đăng nhập SV thất bại/phút, tăng đột biến 429) trong `packages/backend/src/security/alerts.ts`
- [ ] T135 [P] Kịch bản kiểm thử bảo mật S1–S9 của quickstart.md trong `packages/backend/tests/integration/security/*.test.ts`
- [ ] T136 OWASP ZAP baseline trên bản preview, sửa mọi High/Medium (SC-013) — cấu hình trong `.github/workflows/zap.yml`
- [ ] T137 [P] k6: 100 SV điểm danh đồng thời (SC-002) và 10.000 req/phút tấn công + 100 SV thật (SC-012) trong `apps/web/tests/load/checkin.k6.js`, `apps/web/tests/load/attack.k6.js`
- [ ] T138 [P] Đo hiệu năng còn thiếu: thời gian check-in đầu-cuối ≤ 30 s trên 4G giả lập (SC-001, Playwright throttling), ô đổi màu ≤ 5 s (SC-007), lọc/tìm ≤ 1 s với 100 SV × 30 buổi (SC-009), trợ lý AI p95 ≤ 5 s (SC-011) trong `apps/web/tests/perf/*.spec.ts`, `apps/web/tests/perf/query.bench.ts`
- [ ] T139 Hiệu chỉnh ngưỡng cuối bằng `packages/backend/scripts/calibrate.ts` trên dữ liệu thật, ghi vào biến môi trường và research.md (SC-004, SC-004a)
- [ ] T140 [P] Trang điều khoản dữ liệu sinh trắc + quyền yêu cầu xoá dữ liệu cho SV trong `apps/web/src/app/sv/dieu-khoan/page.tsx`, `apps/web/src/app/api/student/data/route.ts`
- [ ] T141 [P] Rà soát truy cập (a11y) và hiển thị di động cho màn hình SV trong `apps/web/src/app/sv/**`
- [ ] T142 [P] README + hướng dẫn triển khai Vercel/Supabase, biến môi trường trong `README.md`, `docs/deploy.md`
- [ ] T143 Chạy toàn bộ quickstart.md (Q1–Q27, S1–S11) và đánh dấu kết quả trong `specs/001-attendance-core/quickstart.md`
- [ ] T145 [P] Tối ưu thời gian đăng ký thẻ (Vercel 1 mẫu: 6,84 s — trong ngưỡng 10 s của đăng ký thẻ nhưng cần biên an toàn khi cold start; các bước dùng chung với điểm danh phải ≤ 5 s): zxing thử ở kích thước nhỏ trước rồi mới phóng to; cân nhắc bỏ OCR họ tên khi mã vạch đã đọc được, hoặc chạy OCR song song với nhận diện mặt/liveness; đo bộ nhớ function (log `card_register_timing` ở Preview) trong `packages/backend/src/card/decode.ts`, `packages/backend/src/card/register.ts`
- [ ] T144 [P] Đăng nhập SV vượt ngưỡng thất bại theo IP (50/5 phút) → hiện thử thách Cloudflare Turnstile (xác minh token ở server, khoá site/secret qua env) thay vì trả 429, để cả lớp sau NAT Wi-Fi không bị chặn cứng; giữ 429 làm phương án dự phòng khi Turnstile lỗi; thêm `security_events` cho thử thách thất bại trong `packages/backend/src/auth/student-login.ts`, `packages/backend/src/security/turnstile.ts`, `apps/web/src/app/(auth)/sv/page.tsx` (FR-083: "thử thách chống bot")

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)** → **Spike (P1b)** → **Foundational (P2)** → các user story
- **US1** cần Foundational
- **US6** cần Foundational + có SV trong lớp (US1) để đăng nhập
- **US2** cần US1 + US6 (thẻ là điều kiện điểm danh)
- **US3** cần US2 (pipeline)
- **US5** cần US2 (có dữ liệu events); có thể làm song song US3
- **US4** cần US2 (+ dùng bảng của US5 để hiển thị Out)
- **US9** cần US2 (hồ sơ đã được ghi trong Phase 5) và US5 (chi tiết ô)
- **US8** cần US5 (bảng, tính ô)
- **US7** cần US5 (bảng, xuất file)
- **Polish (P12)**: T131–T134 làm được ngay sau US2; còn lại sau khi các story xong

### Within Each Story

Test viết trước và FAIL → service → API → UI. Mỗi story xong → chạy kịch bản quickstart tương ứng.

### Parallel Opportunities

- Phase 1: T002–T008 song song
- Phase 1b: T010, T011 song song với T009
- Phase 2: T013–T018 (tests) song song; T022–T026, T029–T032, T034 song song
- US5 và US3 làm song song sau US2 (khác file)
- Mọi task [P] trong một phase chạy song song

## Parallel Example: Phase 2

```text
Task: "Unit test Haversine trong packages/backend/tests/unit/geo/haversine.test.ts"
Task: "Unit test tiết→giờ trong packages/shared/tests/periods.test.ts"
Task: "Unit test escape công thức trong packages/backend/tests/unit/security/formula-escape.test.ts"
Task: "Unit test upload trong packages/backend/tests/unit/security/upload.test.ts"
```

## Implementation Strategy

### MVP (chống điểm danh hộ)

1. Setup → Spike (Go/No-Go) → Foundational
2. US1 → US6 → US2 → US3
3. **DỪNG & KIỂM TRA**: Q1–Q12 + S1–S5 → demo được: tạo lớp, nhập danh sách, đăng ký thẻ, check-in, bắt trùng mặt/người ngoài lớp

### Incremental Delivery

4. US5 (bảng màu + xuất Excel) → demo cho giảng viên
5. US4 (check-out tự động + đột xuất)
6. US9 (hồ sơ JSON + phản hồi) → US8 (vắng phép)
7. US7 (lọc/tìm/AI)
8. Polish & bảo mật đầy đủ → dùng thử thật

## Notes

- Tổng: 144 task (Setup 8 · Spike 4 · Foundational 27 · US1 13 · US6 12 · US2 20 · US3 4 · US5 8 · US4 6 · US9 5 · US8 12 · US7 11 · Polish 14)
- Không commit ảnh khuôn mặt/thẻ thật vào repo; bộ ảnh hiệu chỉnh để ngoài repo
- Commit sau mỗi task hoặc nhóm task logic; dừng ở mỗi Checkpoint để kiểm tra story độc lập
