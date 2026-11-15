# Implementation Plan: Điểm danh lõi

**Branch**: `001-attendance-core` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-attendance-core/spec.md`

## Summary

Web app Next.js full-stack trên Vercel cho phép giảng viên tạo lớp học phần (≤ 15 tuần, lịch theo tiết/ca, phòng), nhập danh sách lớp từ .xlsx/.csv, mở check-in (check-out tự mở theo giờ kết thúc tiết cuối), và theo dõi bảng điểm danh tô màu theo buổi. Sinh viên đăng nhập bằng mã SV, đăng ký thẻ sinh viên một lần, rồi điểm danh bằng selfie có thử thách quay đầu + GPS.

Cách tiếp cận kỹ thuật: mọi quyết định ở server (Nguyên tắc I). Server nhận 3 khung hình, chạy SCRFD + ArcFace MobileFaceNet qua `onnxruntime-node` để kiểm liveness, so với ảnh chân dung trên thẻ (2 ngưỡng), kiểm trùng 1:N trong khung bằng `pgvector`, so check-out với check-in, tính khoảng cách Haversine tới vị trí giảng viên, rồi đóng dấu ảnh bằng `sharp`. Ảnh/vector lượt điểm danh tự xoá sau 7 ngày. Mỗi lượt (kể cả bị từ chối) sinh hồ sơ JSON `attendance-record.v1` giữ tới 30 ngày sau khi lớp kết thúc để xử lý phản hồi của sinh viên khi ảnh đã xoá. Sinh viên nộp minh chứng vắng phép; AI đọc ảnh giấy tờ trích xuất JSON, luật kiểm tra tự động phân loại "đạt / cần xem", giảng viên duyệt hàng loạt hoặc bật tự duyệt. Giảng viên có bộ lọc/tìm kiếm/xuất file và trợ lý AI sinh `FilterSpec` có cấu trúc (không SQL tự do). Chi tiết lựa chọn: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22 LTS (runtime Node của Vercel Functions)

**Primary Dependencies**: Next.js 15 (App Router, Route Handlers), React 19, Tailwind CSS + shadcn/ui, TanStack Table (bảng điểm danh cuộn ngang, cố định cột), SWR, Drizzle ORM + `postgres`, `jose`, `@node-rs/argon2`, Zod, `onnxruntime-node` (SCRFD-500M + MobileFaceNet w600k_mbf), `@mediapipe/tasks-vision` (chỉ hướng dẫn UX phía client), `sharp`, `zxing-wasm`, `tesseract.js`, `exceljs`, `papaparse`, `iconv-lite`, `date-fns-tz`, Vercel AI SDK + `@ai-sdk/anthropic`

**Storage**: Supabase PostgreSQL (extensions `vector`, `unaccent`, `pg_trgm`, `pgcrypto`) qua Supavisor transaction pooler; Supabase Storage bucket private `evidence/`, `cards/` (signed URL 5 phút)

**Testing**: Vitest (unit), Vitest + Supabase CLI local (integration), Playwright (e2e với camera/GPS giả), k6 (tải 100 người), script hiệu chỉnh ngưỡng trên bộ ảnh thử

**Target Platform**: Vercel (Functions Node.js, Fluid compute, region gần VN nhất — `sin1`), trình duyệt di động Chrome Android / Safari iOS qua HTTPS

**Project Type**: Web application — monorepo một app Next.js full-stack

**Performance Goals**: 100 lượt điểm danh đồng thời, p95 ≤ 5 s/lượt (SC-002); đăng ký thẻ p95 ≤ 10 s (một lần, có màn tiến trình — T012); bảng điểm danh cập nhật ≤ 5 s (SC-007); lọc/tìm ≤ 1 s cho 100 SV × 30 buổi (SC-009); trợ lý AI ≤ 5 s p95 (SC-011)

**Constraints**: Bundle mỗi function ≤ 250 MB không nén; RAM 2 GB/1 vCPU (Hobby); ảnh gửi lên ≤ 3 × 300 KB (client nén JPEG 720p); không lưu ảnh tham chiếu ngoài ảnh thẻ; ảnh/vector lượt điểm danh xoá sau 7 ngày; thời gian theo server; giao diện tiếng Việt

**Scale/Scope**: 1 trường, vài chục giảng viên, vài nghìn sinh viên; lớp ≤ ~100 SV; ≤ 30 buổi/lớp; ~15 màn hình

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Constitution v2.2.0.

| Nguyên tắc | Đánh giá | Bằng chứng trong thiết kế |
|---|---|---|
| I. Server là nguồn sự thật | ✅ | Embedding, liveness, khoảng cách, thời gian tính ở server; tâm GPS không bao giờ trả về client sinh viên; nonce dùng một lần (`scan_nonces`); chữ trên ảnh do server đóng dấu |
| II. Chống điểm danh hộ nhiều lớp | ✅ | Pipeline 7 bước (mục *Luồng quyết định* dưới); trùng → `suspect` cho tất cả lượt liên quan qua cột `duplicate_of` |
| III. Con người quyết định cuối | ✅ | `manual_overrides` với lý do bắt buộc + `audit_logs`; trang bằng chứng đặt ảnh thẻ cạnh ảnh điểm danh |
| IV. Bảo vệ dữ liệu sinh trắc | ✅ | `consent_at` bắt buộc; bucket private + signed URL; `purge_after` + cron hằng ngày; logger lọc trường `embedding`/ảnh |
| V. RBAC mọi endpoint | ✅ | Middleware vai trò + hàm `assertOwnsClass`, `assertSelf` trong mỗi handler; mặc định từ chối; test phân quyền cho từng route |
| VI. Kiểm thử logic quyết định | ✅ | Unit test viết trước cho Haversine, tính ô/trạng thái buổi, FilterSpec compiler, nhận diện cột Excel, tiết→giờ; integration cho check-in/out; script hiệu chỉnh ngưỡng |
| VII. Đơn giản | ✅ | Một app Next.js, một nhà cung cấp DB/Storage; polling thay realtime; check-out "lười" không cần scheduler; không index vector |
| IX. Bảo mật theo chiều sâu | ✅ | WAF + rate limit 2 tầng; nonce trước mọi thao tác nặng; CSP/HSTS/CSRF; Zod strict; kiểm file + mã hoá lại ảnh; chống formula injection; RLS deny-all; quét phụ thuộc trong CI (R14) |
| III (bổ sung 2.4.0) | ✅ | Tự duyệt vắng phép chỉ khi GV bật, hiển thị + huỷ được; hồ sơ JSON giải thích mọi quyết định |
| IV (bổ sung 2.4.0) | ✅ | Hồ sơ JSON không chứa ảnh/vector/nhân khẩu học; minh chứng vắng phép bucket private, xoá class.end + 30 ngày |
| VIII (bổ sung 2.4.0) | ✅ | Chỉ ảnh giấy tờ vắng phép gửi AI vision, có thông báo; đầu ra Zod; không gửi ảnh khuôn mặt |
| VIII. Trợ lý AI chỉ đọc | ✅ | LLM chỉ sinh `FilterSpec` (JSON Schema + Zod); compiler luôn thêm `instructor_id = :me`; prompt không chứa tên/mã SV; không có thao tác ghi |

**Kết quả**: ĐẠT, không vi phạm cần giải trình. Kiểm lại sau Phase 1: ĐẠT (data-model và contracts không thêm thành phần mới ngoài bảng trên).

## Luồng quyết định một lượt điểm danh (`POST /api/windows/{id}/events`)

1. Xác thực JWT sinh viên; nonce hợp lệ, chưa dùng, đúng `window_id`, chưa hết hạn → đánh dấu đã dùng.
2. Khung đang mở (theo `now()` server); SV có ghi danh `active`; với check-out/spot-check: đã có check-in `valid|suspect`; chưa có lượt `valid|suspect` trong khung; còn lượt thử.
3. GPS: `accuracy_m > 100` → `retry/low_accuracy`; Haversine tới tâm buổi > `radius_m` → `rejected/out_of_range`.
4. Ảnh: mỗi khung đúng 1 khuôn mặt (không → `retry`); yaw theo đúng chuỗi thử thách và 3 khung cùng một người → nếu không `rejected/liveness_failed`.
5. Embedding khung nhìn thẳng; cosine với thẻ: `< CARD_REJECT_BELOW` → `rejected/card_mismatch`; giữa hai ngưỡng → `suspect/card_borderline`.
6. Check-out/spot-check: cosine với lượt check-in hợp lệ `< CHECKIN_MATCH_ABOVE` → `suspect/checkin_mismatch` (cả hai lượt).
7. Trùng trong khung (pgvector) `≥ DUPLICATE_ABOVE` với mã khác → `suspect/duplicate_face`, cập nhật các lượt kia thành `suspect` trong cùng transaction (`SELECT … FOR UPDATE` theo `window_id` để tránh hai lượt trùng cùng lúc lọt qua).
8. Đóng dấu ảnh (giờ server, địa chỉ Goong, lớp, phòng) → Storage; dựng hồ sơ `attendance-record.v1` từ kết quả từng bước (kể cả khi dừng sớm ở bước 2–5) → ghi event + record; trả kết quả.

## Vắng phép: trích xuất & kiểm tra

1. SV tải 1–3 ảnh → kiểm tra upload (FR-090) → re-encode, băm SHA-256.
2. Gửi ảnh (giấy tờ hoặc ảnh chụp chat) tới Claude (vision, structured output) với schema `leave-extraction.v1` theo `evidenceType`, chỉ kèm **ngày học** để quy đổi "hôm nay/mai" — KHÔNG gửi họ tên SV/GV hay mã SV (Constitution VIII; việc so khớp tên làm ở bước 4 trong hệ thống) → validate Zod; nếu lỗi/độ tin cậy thấp → `needs_review`.
3. Chặn trước khi gọi AI: mọi buổi chọn phải có `session.date = hôm nay (giờ VN)` (FR-101).
4. Luật kiểm tra thuần (unit test được):
   - document: khớp tên SV (bỏ dấu; cùng số từ, mỗi từ Levenshtein ≤ 1, tổng ≤ 2 — để "Tú" ≠ "Tuấn"), mã SV, `validFrom ≤ session.date ≤ validTo`, có dấu/chữ ký;
   - chat: tên phía bên kia khớp giảng viên của lớp (bỏ dấu, bỏ tiền tố Thầy/Cô/TS./ThS.), có tin xin phép phía SV, tin `approve` phía giảng viên với độ tin cậy ≥ ngưỡng, `absenceDate = session.date`, thời gian tin đồng ý < `session.ends_at`, không có `tamperSigns`;
   - chung: không trùng `sha256`/`ocr_text_hash` → `passed | needs_review` + danh sách lý do.
5. GV duyệt từng đơn / hàng loạt; tự duyệt theo cấu hình lớp chỉ cho `document`; quyết định ghi `audit_logs`.

## Kiến trúc bảo mật (Constitution IX, FR-080–FR-096)

```text
Internet ──► Vercel Edge: DDoS L3/L4 tự động ─► WAF (rate limit IP /api/*, bot rules, Attack Challenge Mode khi sự cố)
         ──► Next.js middleware: security headers + CSP nonce, kiểm Origin (CSRF), xác thực JWT + vai trò
         ──► Route handler: Zod strict, checkRateLimit theo danh tính, assertOwns*(id), nonce/khung/ghi danh
         ──► Service: xử lý ảnh (sau khi qua mọi kiểm tra), truy vấn tham số hoá (Drizzle)
         ──► Supabase: service-role chỉ ở server, RLS deny-all cho anon, bucket private + signed URL
```

| Mối đe doạ | Biện pháp chính |
|---|---|
| DDoS L3/L4 | Lớp tự động của Vercel |
| DDoS L7 / spam API | WAF rate limit theo IP + `checkRateLimit` theo SV/GV; Attack Challenge Mode |
| Đốt CPU bằng ảnh (cost DoS) | Nonce + khung mở + ghi danh kiểm trước; giới hạn 3 khung × 1 MB, tổng ≤ 4 MB; 3 lần thử/khung |
| Dò mã SV / brute-force mật khẩu GV | Rate limit, khoá tạm, thử thách bot, thông báo lỗi chung |
| SQL injection | Drizzle tham số hoá; FilterSpec biên dịch, không SQL tự do |
| XSS | React escape, không `dangerouslySetInnerHTML`, CSP nonce |
| CSRF | SameSite cookie + kiểm Origin |
| IDOR | `assertOwnsClass/Session/Student` mọi handler; UUID |
| Upload độc hại / zip bomb | Giới hạn kích thước, magic bytes, sharp re-encode, giới hạn dòng/tỉ lệ nén |
| Formula injection khi xuất | Tiền tố an toàn |
| Prompt injection trợ lý AI | Structured output + Zod, phạm vi áp ở server, không đưa dữ liệu SV vào prompt |
| Replay ảnh/lượt điểm danh | Nonce dùng một lần + thử thách ngẫu nhiên |
| Lộ bí mật | Env vars trên Vercel, RLS deny-all, không key ở client |
| Chiếm phiên | Cookie httpOnly/Secure, `sid` thu hồi được, hết hạn 2h (SV) / 12h (GV) |
| Lỗ hổng thư viện | `pnpm audit`, Dependabot, CodeQL chặn High/Critical |
| Ảnh chat giả / cắt ghép để xin phép (US8) | Đơn `chat` không bao giờ tự duyệt; GV — người trong cuộc — xác nhận; AI chỉ đánh dấu `tamperSigns` |
| Spam đơn vắng phép để đốt chi phí AI (US8) | Chặn buổi không thuộc hôm nay *trước* khi gọi AI; rate limit 10/giờ/SV; ≤ 3 ảnh × 1,2 MB (nén ở trình duyệt), tổng ≤ 4 MB; trùng sha256 không gọi lại AI |
| Prompt injection qua chữ trong ảnh giấy tờ/chat (US8) | Structured output + Zod; đầu ra chỉ là dữ liệu, kết luận do luật thuần; không có công cụ/hành động nào để AI gọi |
| Spam phản hồi điểm danh (US9) | ≤ 2 phản hồi/buổi/SV, ≤ 1.000 ký tự, rate limit, chỉ buổi của lớp mình |
| Sửa/giả hồ sơ điểm danh (US9) | Hồ sơ chỉ server ghi, không API sửa; mọi thay đổi trạng thái qua `manual_overrides` + audit; lưu `image_sha256`, phiên bản model/ngưỡng |
| Dò vị trí qua API địa chỉ | `/api/geo/reverse` chỉ nhận toạ độ SV gửi, không liên quan tâm GV; rate limit |

## Project Structure

### Documentation (this feature)

```text
specs/001-attendance-core/
├── spec.md
├── plan.md              # File này
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md
│   └── ai-filter-spec.schema.json
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (chưa tạo)
```

### Source Code (repository root) — monorepo pnpm

```text
apps/
└── web/                              # @utc/web — Next.js 15 (App Router): giao diện + route API mỏng
    ├── src/
    │   ├── middleware.ts             # security headers, CSP nonce, CSRF origin check, auth gate
    │   ├── app/
    │   │   ├── (auth)/login/         # đăng nhập giảng viên/admin
    │   │   ├── (auth)/sv/            # đăng nhập sinh viên bằng mã SV
    │   │   ├── sv/                   # khu sinh viên: lop/, the-sinh-vien/, diem-danh/[windowId]/, vang-phep/
    │   │   ├── gv/                   # khu giảng viên: lop/, lop/[classId]/…, tong-hop/
    │   │   ├── admin/                # giảng viên, tiết học, dữ liệu toàn trường
    │   │   └── api/                  # route handler: chỉ parse request → gọi @utc/backend → trả response
    │   ├── components/               # UI (bảng điểm danh, camera, ô màu…)
    │   └── lib/                      # tiện ích chỉ dùng ở UI (cn, định dạng hiển thị)
    ├── public/fonts/                 # Be Vietnam Pro (OFL)
    ├── models/                       # file .onnx (tải bằng script, không commit)
    └── tests/e2e/ · tests/load/ · tests/perf/
packages/
├── backend/                          # @utc/backend — toàn bộ logic phía server (không phụ thuộc Next.js)
│   ├── src/
│   │   ├── auth/                     # jwt, mật khẩu, phiên (thu hồi được), guards RBAC
│   │   ├── security/                 # rate limit, security_events, upload, formula-escape, nonce
│   │   ├── http/                     # route(): xác thực + Zod strict + map lỗi; HttpError
│   │   ├── face/                     # onnx sessions, detect, align, embed, liveness
│   │   ├── card/ · attendance/ · geo/ · evidence/ · roster/ · query/ · assistant/ · leave/ · records/ · admin/
│   │   └── log.ts · env.ts
│   ├── scripts/                      # spike-face, spike-card, calibrate
│   └── tests/unit/ · tests/integration/ · tests/fixtures/
├── database/                         # @utc/database — Drizzle schema, client, getDb(), seed, PGlite cho test
│   ├── src/                          # schema.ts, client.ts, index.ts, seed/, testing.ts
│   ├── migrations/                   # SQL (drizzle-kit + viết tay)
│   ├── scripts/                      # migrate, seed-demo
│   └── tests/
└── shared/                           # @utc/shared — tiết/ca/giờ VN, xử lý tiếng Việt (dùng cả UI lẫn server)
    ├── src/
    └── tests/
scripts/                              # script cấp repo (download-models)
supabase/                             # cấu hình Supabase CLI (bucket private)
```

**Structure Decision**: Monorepo pnpm workspaces, một lần deploy Vercel (Root Directory = `apps/web`, `outputFileTracingRoot` = gốc repo). Quy tắc phụ thuộc một chiều: `@utc/web → @utc/backend → @utc/database → @utc/shared`; `@utc/web` được dùng `@utc/shared` trực tiếp cho hiển thị, nhưng KHÔNG import `@utc/database` — mọi truy cập dữ liệu đi qua `@utc/backend`. Route handler trong `apps/web/src/app/api` chỉ làm việc HTTP (đọc request, gọi service, trả JSON); logic nghiệp vụ, phân quyền và kiểm tra đầu vào nằm trong `@utc/backend` để unit/integration test không cần Next.js. Các package được biên dịch trực tiếp từ TypeScript (`transpilePackages`), không có bước build riêng. Gói native (`onnxruntime-node`, `sharp`, `@node-rs/argon2`, `zxing-wasm`) khai báo cả trong `apps/web` để Next.js giữ chúng ở dạng external.

## Giai đoạn triển khai đề xuất (đầu vào cho `/speckit-tasks`)

0. **Spike kỹ thuật (bắt buộc trước)**: đóng gói `onnxruntime-node` + model lên Vercel, đo cold start/latency; đọc mã vạch thẻ UTC thật; hiệu chỉnh sơ bộ ngưỡng thẻ↔selfie (R1–R3).
1. **Nền tảng**: schema + migrations + seed tiết/ca, auth + RBAC, layout tiếng Việt, khu Admin (quản lý giảng viên, bảng tiết, xem dữ liệu điểm danh toàn trường).
2. **US1** lớp học + nhập danh sách.
3. **US6** đồng ý + đăng ký thẻ.
4. **US2 + US3** check-in, pipeline quyết định **kèm ghi hồ sơ `attendance-record.v1` cho mọi lượt** (Constitution III), kiểm trùng.
5. **US5** bảng điểm danh + bằng chứng + sửa thủ công + xuất Excel.
6. **US4** check-out tự động + kiểm tra đột xuất.
7. **US9** xem hồ sơ + phản hồi (phần *ghi* hồ sơ đã nằm trong bước 4); **US8** vắng có phép.
8. **US7** lọc/tìm/xuất + trợ lý AI.
9. **Bảo mật**: middleware header/CSP/CSRF, rate limit 2 tầng, cấu hình WAF (lưu trong `vercel.json` phần hỗ trợ), CI quét phụ thuộc, OWASP ZAP, k6 tấn công, test phân quyền — một phần (rate limit, guard) làm ngay ở giai đoạn 1.
10. **Vận hành**: cron purge, tải 100 người, hiệu chỉnh ngưỡng cuối, tài liệu triển khai + quy trình ứng phó sự cố (bật Attack Challenge Mode).

## Rủi ro chính

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Ảnh thẻ cũ/in mờ làm từ chối nhầm nhiều | SV thật bị chặn | 2 ngưỡng + `suspect`; cho đăng ký lại thẻ; hiệu chỉnh trên dữ liệu thật |
| Suy luận ONNX trên CPU serverless chậm/cold start | Vượt 5 s p95 | Spike sớm; giữ model nhỏ; giảm độ phân giải; phương án dự phòng là service Python riêng (cần sửa constitution VII) |
| GPS trong nhà sai lệch | Từ chối nhầm | `retry` khi accuracy kém; bán kính chỉnh được; sửa thủ công |
| Mã vạch thẻ không chứa mã SV | Đăng ký thẻ thất bại | OCR dự phòng; giảng viên duyệt thủ công |
| Giấy phép model InsightFace phi thương mại | Không dùng thương mại được | Ghi rõ phạm vi đồ án; thay model khi thương mại hoá |

## Complexity Tracking

Không có vi phạm constitution cần giải trình.
