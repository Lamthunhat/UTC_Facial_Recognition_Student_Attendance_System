# Research: Điểm danh lõi (001-attendance-core)

**Date**: 2026-11-07 | **Plan**: [plan.md](./plan.md)

Mỗi mục theo dạng: Quyết định · Lý do · Phương án đã cân nhắc. Các mục gắn 🧪 cần một spike đo thực tế trước khi chốt (task đầu tiên trong `tasks.md`).

---

## R1. Trích xuất đặc trưng khuôn mặt ở server 🧪

- **Quyết định**: `onnxruntime-node` chạy bộ model InsightFace nhẹ (**SCRFD-500M** để phát hiện mặt + 5 điểm mốc, **MobileFaceNet ArcFace (w600k_mbf)** để trích vector 512 chiều), trong Vercel Function Node.js. So sánh bằng cosine similarity. Ảnh được căn chỉnh (align) theo 5 điểm mốc trước khi trích vector.
- **Lý do**: ArcFace cho độ chính xác tốt hơn rõ rệt so với vector 128 chiều của face-api.js, quan trọng vì phải so với ảnh in trên thẻ sinh viên (ảnh cũ, chụp lại). Hai model nhẹ (~15 MB) giữ bundle dưới giới hạn 250 MB không nén của Vercel Functions. Vercel Hobby cho tối đa 2 GB RAM / 1 vCPU và thời lượng tối đa 300 giây, đủ cho suy luận CPU vài trăm ms mỗi ảnh.
- **Lưu ý giấy phép (quan trọng)**: model pretrained của InsightFace (gói `buffalo_s`: SCRFD-500M, MobileFaceNet w600k_mbf) được phát hành chỉ cho **mục đích phi thương mại / nghiên cứu học thuật**. Hệ quả: (1) dùng được cho đồ án học tập và thử nghiệm trong trường; (2) **không** được dùng cho sản phẩm thương mại hay dịch vụ thu phí — khi thương mại hoá phải thay bằng model có giấy phép thương mại (tự huấn luyện, hoặc mua bản quyền) và hiệu chỉnh lại toàn bộ ngưỡng; (3) repo **không** phân phối lại file model: `models/` bị gitignore, model được tải lúc cài/ build bằng `pnpm models:download` (kiểm SHA-256) từ trang phát hành của InsightFace. Mã nguồn thư viện InsightFace (MIT) khác với trọng số model (phi thương mại).
- **Phương án đã cân nhắc**:
  - `face-api.js` / `@vladmandic/face-api`: bản gốc không còn bảo trì; tác giả fork khuyên chuyển sang thư viện Human. Vector 128 chiều yếu hơn cho so ảnh thẻ.
  - `@vladmandic/human` (tfjs): dùng được, nhưng `tfjs-node` nặng và tình trạng bảo trì không chắc chắn → giữ làm phương án dự phòng.
  - Dịch vụ đám mây (AWS Rekognition…): gửi dữ liệu sinh trắc ra nước ngoài, phát sinh chi phí, trái Nguyên tắc IV.
  - Service Python riêng (InsightFace đầy đủ): chính xác nhất nhưng thêm một hệ thống phải vận hành (Nguyên tắc VII) → chỉ dùng nếu spike cho thấy Node không đạt SC-002/SC-004.
- **Spike cần đo**: kích thước bundle, cold start, thời gian xử lý 1 ảnh và 3 khung hình liveness, độ tương đồng ảnh thẻ ↔ selfie trên ≥ 20 sinh viên tình nguyện để đặt 2 ngưỡng (từ chối / nghi vấn).

## R2. Liveness (chứng minh người thật) 🧪

- **Quyết định**: Thử thách ngẫu nhiên do server cấp kèm nonce (ví dụ "quay trái rồi quay phải"). Client dùng MediaPipe Face Landmarker trong trình duyệt **chỉ để hướng dẫn UX** và tự chụp 3 khung hình tại các thời điểm thử thách. Server tự phát hiện mặt trên cả 3 khung, ước lượng góc quay đầu (yaw) từ 5 điểm mốc SCRFD và xác nhận đúng chuỗi thử thách, cùng một khuôn mặt (cosine giữa các khung cao), khung giữa nhìn thẳng dùng làm ảnh bằng chứng.
- **Lý do**: Quyết định nằm ở server (Nguyên tắc I); thử thách ngẫu nhiên + nonce chặn phát lại video quay sẵn; ảnh in tĩnh không quay đầu được.
- **Phương án đã cân nhắc**: chớp mắt (cần nhiều điểm mốc hơn, khó kiểm ở server với 5 điểm); liveness thụ động bằng model chống giả mạo (thêm model, độ tin cậy khó kiểm chứng) → để giai đoạn sau.
- **Giới hạn đã biết**: không chống được mặt nạ 3D hay deepfake thời gian thực bơm vào camera ảo; chấp nhận cho phạm vi đồ án.
- **Dùng cả khi đăng ký thẻ (FR-045a)**: cùng thử thách + 3 khung; khung nhìn thẳng so với chân dung thẻ. Lý do: chỉ chụp thẻ thì ai cầm được thẻ người khác (mượn, nhặt) cũng đăng ký được. Mặt trực tiếp lệch chân dung → hàng chờ `LIVE_MISMATCH` cho giảng viên, không từ chối (ảnh thẻ có thể cũ). Ngưỡng dùng `CARD_ACCEPT_ABOVE` như khi điểm danh. Quy ước yaw: ảnh camera trước gửi lên KHÔNG lật; SV quay trái → mũi lệch phải ảnh. Ngưỡng tư thế sơ bộ: nhìn thẳng |yaw| ≤ 0,12, quay ≥ 0,20; cùng người: cosine ≥ 0,5 — hiệu chỉnh ở T011.

## R3. Đọc thẻ sinh viên 🧪

- **Quyết định**: (1) Đọc **mã vạch** trên thẻ bằng `zxing-wasm` ở server; (2) nếu không đọc được, OCR dòng "Mã sinh viên" bằng `tesseract.js` (chỉ nhận chữ số); (3) phát hiện khuôn mặt trên ảnh thẻ bằng SCRFD và cắt ảnh chân dung để trích vector tham chiếu.
- **Lý do**: Mã vạch đọc ổn định hơn OCR; OCR làm phương án dự phòng. Cả hai chạy trong Node không cần dịch vụ ngoài.
- **Cần xác minh**: mã vạch trên thẻ UTC có mã hoá đúng mã sinh viên không (kiểm bằng vài thẻ thật trong spike). Nếu không, OCR là đường chính.
- **Chống ảnh có sẵn**: trang đăng ký chỉ mở camera trực tiếp (không có input file, không có `<input capture>` — kể cả trên điện thoại); ảnh gửi kèm nonce có hạn 2 phút. Mở trong webview (Zalo, Facebook, Messenger, Instagram, TikTok, WebView Android) → hướng dẫn mở bằng Chrome/Safari vì camera thường bị chặn.
- **Thẻ SV UTC là thẻ DỌC** (CR80 54 × 85,6 mm): khung hướng dẫn dọc cao 80 % vùng xem trước; ảnh gửi = vùng cắt theo khung. Chụp bằng `ImageCapture.takePhoto` khi trình duyệt hỗ trợ và ảnh cùng tỉ lệ với luồng video (độ phân giải cảm biến); ngược lại lấy khung video (xin 2560×1440).
- **Ngưỡng kích thước ảnh thẻ** (cạnh dài vùng cắt, điểm ảnh gốc): **< 500 px chặn** ("quá nhỏ — dùng camera điện thoại"); **500–999 px cảnh báo** "Ảnh hơi nhỏ, nên dùng camera điện thoại" + "Vẫn dùng ảnh này"; **≥ 1000 px** dùng luôn. Kích thước vùng cắt phụ thuộc độ phân giải camera, không phụ thuộc khoảng cách thẻ (vùng cắt luôn là khung hướng dẫn): webcam 720p ~620 px (cảnh báo), luồng dọc điện thoại 1080×1920 ~1240 px. Ngưỡng sơ bộ — hiệu chỉnh cùng T010 trên thẻ thật.
- **Đọc thẻ ở server**: zxing `tryRotate` + `tryInvert` (mã vạch ngang hay dọc đều đọc được); OCR lần đầu chạy song song với mã vạch; **chỉ khi không đọc được mã vạch** mới OCR lại với ảnh xoay 90°, rồi 270° (tối đa 3 lượt OCR). Mọi lần thử trong một request vẫn tính **1 lượt** đăng ký (6 lượt/giờ). Ở dev, log `card_register_timing` ghi thời gian từng bước (sanitize, đọc thẻ + chân dung, liveness, so khớp, lưu) và số lần OCR xoay.
- **Ngưỡng trùng mặt 1:N (`DUPLICATE_ABOVE`)**: mặc định **0,45 — chờ hiệu chỉnh T011** (bộ ảnh thử ≥ 20 người). Hạ từ 0,6 vì ảnh in trên thẻ (cũ, chụp lại) cho độ tương đồng thấp hơn ảnh chụp trực tiếp; ngưỡng thấp chỉ làm nhiều thẻ vào hàng chờ duyệt hơn, không chặn sinh viên.
- **Ngưỡng chân dung trên thẻ** (`PORTRAIT_RULES`): cạnh mặt tối thiểu 40 px, độ nét tối thiểu 0,02 — sơ bộ; hiệu chỉnh bằng `pnpm --filter @utc/backend calibrate:card <thư mục ảnh>` trên ảnh thẻ thật (chạy cục bộ, không lưu ảnh, không gửi đi đâu).
- **Phương án đã cân nhắc**: Google Vision OCR (gửi dữ liệu ra ngoài, tốn phí); để giảng viên nhập tay (chậm, không chặn được thẻ người khác).

## R4. Cơ sở dữ liệu & lưu trữ

- **Quyết định**: **Supabase** (PostgreSQL 15+ với `pgvector`, `unaccent`) + **Supabase Storage** bucket riêng tư (ảnh bằng chứng, ảnh thẻ) truy cập bằng signed URL 5 phút. Kết nối qua **Supavisor transaction pooler** từ Vercel Functions bằng **Drizzle ORM** + `postgres` (tắt prepared statements).
- **Lý do**: Một nhà cung cấp lo cả DB, vector và file; pooler bắt buộc cho serverless (constitution). `pgvector` cho phép kiểm tra trùng 1:N trong một khung giờ bằng một truy vấn.
- **Phương án đã cân nhắc**: Neon + Vercel Blob (tách hai nhà cung cấp, Blob không có ACL riêng tư tốt bằng); Prisma (nặng hơn, cold start chậm hơn Drizzle).
- **Index vector**: không cần HNSW — mỗi truy vấn trùng chỉ quét ≤ 100 lượt trong một khung giờ (lọc theo `window_id` trước).

## R5. Xác thực & phân quyền

- **Quyết định**: JWT tự phát hành bằng `jose` (HS256), lưu trong cookie `httpOnly; Secure; SameSite=Lax`. Giảng viên/Admin đăng nhập email + mật khẩu băm bằng `@node-rs/argon2`. Sinh viên đăng nhập chỉ bằng mã SV (theo spec), token sinh viên hạn 2 giờ. Middleware Next.js kiểm vai trò; mỗi route handler kiểm quyền sở hữu tài nguyên.
- **Giới hạn tần suất**: đếm theo IP + mã SV trong bảng `rate_limits` (Postgres) — ví dụ 10 lần đăng nhập / 5 phút — để chặn dò mã hàng loạt.
- **Phương án đã cân nhắc**: Supabase Auth (không hỗ trợ tự nhiên kiểu đăng nhập chỉ bằng mã SV); NextAuth/Auth.js (thừa cho nhu cầu này).

## R6. Cập nhật trực tiếp bảng điểm danh

- **Quyết định**: Polling 3 giây (SWR `refreshInterval`) từ trang giảng viên tới API trả các ô đã thay đổi kể từ `since`. Trang sinh viên polling 10 giây để biết khung check-out đã mở.
- **Lý do**: Chỉ có vài giảng viên mở bảng cùng lúc; polling đơn giản, không cần WebSocket (Vercel Functions không giữ kết nối lâu). Đạt SC-007 (≤ 5 giây).
- **Phương án đã cân nhắc**: Supabase Realtime (cần JWT tương thích Supabase + RLS, phức tạp hơn với auth tự làm); SSE (giữ function chạy lâu, tốn chi phí).

## R7. Khung check-out tự động & tác vụ định kỳ

- **Quyết định**: Khi giảng viên mở check-in, server tạo luôn bản ghi khung check-out với `opens_at = giờ kết thúc tiết cuối − 10'` và `closes_at = + 10'`. Trạng thái "đang mở" được tính theo thời gian hiện tại khi đọc — không cần cron để mở/đóng. **Vercel Cron** chạy hằng ngày để xoá ảnh/vector quá 7 ngày và ảnh thẻ quá hạn.
- **Lý do**: Tính "lười" tránh phụ thuộc vào độ trễ cron; Hobby plan chỉ cần cron 1 lần/ngày cho việc dọn dữ liệu.

## R8. Địa chỉ in trên ảnh & đóng dấu ảnh

- **Quyết định**: Reverse geocoding ở server bằng **Goong.io** (địa chỉ tiếng Việt tốt), cache theo ô toạ độ làm tròn 4 chữ số thập phân; lỗi thì in toạ độ thay địa chỉ. Đóng dấu ảnh bằng `sharp` (composite lớp SVG chứa chữ) với font **Be Vietnam Pro** đóng gói kèm để hiển thị đúng dấu.
- **Phương án đã cân nhắc**: Nominatim (giới hạn 1 req/s, địa chỉ VN kém hơn); Google Geocoding (tốn phí).

## R9. Nhập/xuất Excel & CSV

- **Quyết định**: `exceljs` để đọc .xlsx và xuất .xlsx có tô màu ô; `papaparse` cho CSV (tự nhận UTF-8/BOM; thử Windows-1258/1252 nếu có ký tự lỗi qua `iconv-lite`). Nhận diện tiêu đề cột bằng bảng đồng nghĩa ("Mã SV", "MSSV", "Mã sinh viên"…) sau khi bỏ dấu và hạ chữ thường; nếu không chắc thì giao diện ghép cột.
- **Phương án đã cân nhắc**: SheetJS (bản trên npm cũ, phải cài từ CDN riêng).

## R10. Tìm kiếm không dấu

- **Quyết định**: Cột sinh `search_text = lower(f_unaccent(student_code || ' ' || last_name || ' ' || first_name || ' ' || last_name || ' ' || first_name ...))` với hàm `f_unaccent` IMMUTABLE bọc `unaccent`, index `pg_trgm` GIN. Lưu ý xử lý riêng "đ/Đ" → "d".

## R11. Trợ lý AI cho giảng viên

- **Quyết định**: Vercel AI SDK + Anthropic (`claude-haiku-5-5`) với **structured output** sinh `FilterSpec` (xem `contracts/ai-filter-spec.schema.json`), kiểm tra lại bằng Zod. Server biên dịch `FilterSpec` → truy vấn Drizzle có tham số, **luôn** thêm điều kiện `class.instructor_id = :me`. Prompt chỉ chứa câu hỏi, mô tả schema của `FilterSpec`, danh sách lớp/buổi của giảng viên (mã, ngày, tiết) — **không** chứa tên/mã sinh viên.
- **Lý do**: Đáp ứng Nguyên tắc VIII (không SQL tự do, giới hạn quyền ở server, hạn chế dữ liệu cá nhân gửi ra ngoài). Giảng viên thấy và sửa được bộ lọc trên giao diện lọc thường.
- **Phương án đã cân nhắc**: text-to-SQL (rủi ro bảo mật, trái Nguyên tắc VIII); không dùng AI (thiếu yêu cầu của người dùng).

## R12. Thời gian & múi giờ

- **Quyết định**: Lưu `timestamptz` (UTC); bảng tiết học lưu giờ địa phương `time`; quy đổi bằng `Asia/Ho_Chi_Minh` (UTC+7, không đổi giờ mùa hè) với `date-fns-tz`. Mọi mốc quyết định lấy `now()` của server.

## R13. Kiểm thử

- **Quyết định**: Vitest (unit: Haversine, tính trạng thái buổi, biên dịch FilterSpec, nhận diện cột Excel, quy đổi tiết → giờ); Vitest + Supabase CLI local (integration: luồng check-in/check-out, kiểm trùng, phân quyền); Playwright (e2e với camera giả `--use-fake-device-for-media-stream` và geolocation giả); bộ ảnh thử khuôn mặt riêng (không commit vào repo) để đo SC-004/SC-004a.

## R14. Bảo mật & chống DDoS

- **Quyết định (tầng biên — Vercel Firewall)**:
  - Dựa vào lớp chống DDoS L3/L4 tự động của nền tảng (có sẵn mọi gói, không cần cấu hình).
  - WAF: quy tắc rate limit theo IP cho `/api/*` (gói Hobby chỉ có **một** quy tắc rate limit/project → gộp các đường dẫn nhạy cảm vào một quy tắc; lên Pro nếu cần tách); quy tắc chặn/thử thách theo user-agent rỗng, quốc gia bất thường cho trang quản trị; bật bộ quy tắc chống bot ở chế độ log trước, challenge sau.
  - Quy trình sự cố: bật **Attack Challenge Mode** khi bị tấn công có chủ đích, tắt sau sự cố (không để thường trực vì sinh viên dùng điện thoại có thể bị thử thách).
  - Lưu ý: có báo cáo người dùng Hobby bị tấn công L7 không được tự chặn và phải tự thêm quy tắc rate limit → quy tắc WAF phải có ngay từ ngày đầu, không đợi sự cố.
- **Quyết định (tầng ứng dụng)**:
  - `@vercel/firewall` `checkRateLimit` với khoá tuỳ biến (mã SV, user id) cho: đăng nhập SV (theo IP: **chỉ đếm lượt thất bại** 50/5 phút + trần tổng 300/5 phút (vượt ngưỡng: hiện trả 429; Polish T144 đổi sang thử thách Turnstile) — cả lớp sau một NAT Wi-Fi trường vẫn đăng nhập được; khi bộ đếm thất bại đầy thì chặn mọi lượt từ IP đó trước khi tra cứu để không lộ mã đúng qua 200/429. Theo mã: 5/5 phút **chỉ đếm lượt thất bại** — đăng nhập không cần mật khẩu nên nếu đếm cả lượt thành công, kẻ xấu đăng nhập liên tục mã A từ nhiều IP sẽ khoá được sinh viên A). **Mọi API đã đăng nhập khoá theo id người dùng, không theo IP**, đăng nhập GV (5 lần sai → khoá 15 phút), nonce quét (6/phút/SV), gửi lượt (theo `attempt_no` ≤ 3/khung), thẻ (6/giờ/SV, lỗi kèm `remainingAttempts`), AI (20/giờ/GV), xuất file (30/giờ/GV). Dự phòng: bảng `rate_limits` trong Postgres nếu SDK không khả dụng.
  - Middleware Next.js đặt header: CSP có nonce (`default-src 'self'; img-src 'self' blob: data: <supabase-storage>; connect-src 'self'; frame-ancestors 'none'`), HSTS 2 năm + preload, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`.
  - CSRF: cookie `SameSite=Lax` + kiểm `Origin` khớp host cho mọi method ≠ GET.
  - Đầu vào: Zod `.strict()` cho mọi body; giới hạn body (khung ảnh điểm danh 1 MB/khung, ảnh minh chứng vắng phép 1,2 MB/ảnh, file danh sách 4 MB; tổng mỗi request ≤ 4 MB); kiểm magic bytes; `sharp` giải mã + mã hoá lại JPEG, bỏ EXIF; `exceljs` đọc với giới hạn số dòng/ô, từ chối tỉ lệ nén bất thường.
  - **Vì sao 4 MB/request**: Vercel Functions từ chối body request lớn hơn **4,5 MB** (413 `FUNCTION_PAYLOAD_TOO_LARGE`) ngay ở tầng nền tảng, trước khi code chạy — giới hạn cũ 5 MB không bao giờ đạt được và người dùng sẽ nhận lỗi của nền tảng thay vì thông báo tiếng Việt của ứng dụng. Đặt 4 MB để còn ~0,5 MB cho phần bao multipart (boundary, các trường khác). Khung ảnh điểm danh (client nén JPEG 720p, thực tế ~300 KB) giới hạn 1 MB/khung × 3 khung; ảnh minh chứng nén ở trình duyệt về ≤ 1,2 MB/ảnh × 3 ảnh. File danh sách lớp 2.000 dòng thực tế < 1 MB nên 4 MB vẫn dư. Nếu sau này cần file lớn hơn: tải thẳng lên Supabase Storage bằng signed upload URL rồi server đọc từ bucket.
  - Xuất file: tiền tố `'` cho ô bắt đầu bằng `= + - @ \t \r`.
  - DB: chỉ server dùng service-role; bật RLS "deny all" cho vai trò `anon`/`authenticated` trên mọi bảng để phòng lộ khoá anon; không công bố URL bucket.
  - Phiên: JWT có `sid` lưu trong bảng `user_sessions` để thu hồi khi đổi mật khẩu/khoá tài khoản.
  - Log & cảnh báo: log JSON có cấu trúc (không chứa ảnh/vector/mật khẩu); bảng `security_events`; cron mỗi giờ hoặc cảnh báo qua email Admin khi vượt ngưỡng.
  - Chuỗi cung ứng: `pnpm audit --prod` + Dependabot + GitHub CodeQL trong CI; khoá phiên bản bằng lockfile.
- **Kiểm thử**: OWASP ZAP baseline scan trên bản preview; k6 kịch bản tấn công (SC-012); bộ test phân quyền tự sinh cho mọi route (SC-014); test prompt injection cho trợ lý AI.
- **Phương án đã cân nhắc**: Cloudflare đặt trước Vercel (thêm một lớp, cấu hình DNS/SSL phức tạp, có thể xung đột với firewall của Vercel) → chỉ cân nhắc nếu WAF của Vercel không đủ; Upstash Redis cho rate limit (thêm nhà cung cấp, trái Nguyên tắc VII khi đã có SDK của Vercel).

## R15. Trích xuất minh chứng vắng phép

- **Quyết định**: Claude (`claude-haiku-5-5`, đầu vào ảnh) qua Vercel AI SDK với structured output theo `leave-extraction.v1`, validate Zod; luật kiểm tra viết thuần TypeScript, có unit test. Phát hiện trùng bằng SHA-256 ảnh + băm toàn văn đã chuẩn hoá (bỏ dấu, bỏ khoảng trắng).
- **Lý do**: Giấy tờ VN đa dạng (viết tay, có dấu đỏ, mẫu khác nhau) — OCR thuần (`tesseract.js`) đọc được chữ nhưng không hiểu cấu trúc; mô hình vision trả trực tiếp các trường cần thiết. Luật kiểm tra tách khỏi AI để kết luận "đạt/cần xem" giải thích được và kiểm thử được.
- **Ảnh chụp màn hình chat**: cùng mô hình vision trích xuất danh sách tin nhắn có người gửi (phân biệt hai phía theo vị trí bong bóng chat), thời gian, và phân loại câu trả lời của giảng viên (đồng ý/từ chối/mơ hồ); quy đổi "hôm nay/mai" theo thời gian tin nhắn. Ảnh chụp màn hình rất dễ chỉnh sửa → đơn chat không bao giờ tự duyệt, AI chỉ giúp giảng viên xác nhận nhanh.
- **Quyền riêng tư**: chỉ ảnh giấy tờ / ảnh chat và ngày học được gửi (không gửi họ tên, mã SV — so khớp làm trong hệ thống); ảnh (Constitution VIII 2.4.0); thông báo cho SV trước khi nộp; không gửi ảnh khuôn mặt.
- **Phương án đã cân nhắc**: `tesseract.js` + regex (độ chính xác thấp với chữ viết tay/dấu); để GV tự đọc (không đạt mục tiêu tự động hoá).

## R16. Hồ sơ điểm danh JSON

- **Quyết định**: Lưu cột `jsonb` `record` trên `attendance_events` (+ `scan_sessions` cho lần mở màn hình), schema có phiên bản `attendance-record.v1`, validate Zod khi ghi. Diễn giải tiếng Việt sinh bằng hàm mẫu thuần (không AI) để kết quả ổn định và kiểm thử được. Toạ độ làm tròn 5 chữ số (~1 m), IP rút gọn.
- **Lý do**: Ảnh xoá sau 7 ngày nhưng thắc mắc thường đến cuối kỳ; các con số kiểm tra (khoảng cách, điểm tương đồng, liveness) đủ để giải thích vì sao một lượt hợp lệ/không hợp lệ mà không giữ dữ liệu sinh trắc.
- **Không làm**: mô tả ảnh bằng AI (ví dụ "nam, đeo kính, áo trắng") — tốn chi phí cho mọi lượt, phải gửi ảnh khuôn mặt ra ngoài (trái Nguyên tắc IV/VIII), và suy đoán nhân khẩu học là dữ liệu nhạy cảm.

## Kết quả spike (2026-11-07, đo cục bộ — T009/T010 phần 1)

**R1 – Nhận diện khuôn mặt (`packages/backend/scripts/spike-face.ts`)**, CPU 1 luồng, model InsightFace buffalo_s (SCRFD-500M + w600k_mbf), mã băm file được ghim trong `scripts/download-models.ts`:
- Nạp 2 model (cold): ~83 ms.
- Ảnh 960×1280: giải mã 28 ms, phát hiện 30–55 ms, trích vector 18–29 ms. **Warm detect + embed ≈ 48 ms/ảnh** → 3 khung liveness < 0,5 s trên máy đo; Vercel 1 vCPU dự kiến chậm hơn 2–3 lần, vẫn trong ngân sách 5 s.
- Cùng một khuôn mặt sau thu nhỏ ½, lật ngang, xoay 8°: cosine 0,95–0,98.
- Chân dung trên ảnh chụp thẻ chỉ rộng ~86 px khi ảnh thẻ 960×1280 → khi đăng ký thẻ cần giải mã ảnh ở độ phân giải cao hơn (cạnh dài ≥ 2048) và yêu cầu thẻ chiếm phần lớn khung hình.
- Sửa ước lượng yaw để không bị ảnh hưởng khi ảnh/đầu nghiêng (chiếu lên trục nối hai mắt).
- **Kích thước bundle** route có ONNX (sau `next build`, đếm theo file trace): **105,6 MB** < 250 MB, không kéo binary darwin/win32/arm64 (đã loại bằng `outputFileTracingExcludes`; loại thêm bản musl của libvips).
- **Còn thiếu**: đo trên Vercel thật (cold start, p95) qua `POST /api/spike/face` — cần tài khoản Vercel của dự án; chưa có ảnh người khác để đo cosine khác người (T011).

**R3 – Đọc thẻ (`packages/backend/scripts/spike-card.ts`)**, 1 ảnh thẻ UTC thật (K64):
- Mã vạch trên thẻ là **Code128 mã hoá đúng mã sinh viên** in trên thẻ → dùng mã vạch làm đường chính, OCR chỉ dự phòng.
- Thời gian đọc: 45 ms (ảnh xám + tăng tương phản), 180–210 ms (ảnh gốc/phóng to).
- `zxing-wasm` mặc định tải wasm từ CDN → phải nạp `zxing_reader.wasm` từ `node_modules` qua `prepareZXingModule({ overrides: { wasmBinary } })` và đính kèm file vào function.
- **Còn thiếu**: thử thêm ≥ 4 thẻ khác (khoá khác, thẻ cũ/mờ).

## Kết quả thử thật (2026-11-16, Vercel Preview + iPhone — T009/T010 phần 2)

Người dùng tự thử: iPhone, **iOS 18.4 Safari**, Vercel Preview của PR #2 (sau khi sửa đóng gói `card-assets/`), **1 thẻ UTC thật** (thẻ dọc).

**Luồng (US6)**
- Đăng ký thẻ **thành công** (thẻ thật + mặt thật, thử thách quay đầu).
- Quay sai hướng → `LIVENESS_FAILED`, lượt bị tính đúng.
- Giảng viên đặt lại thẻ → SV thấy "Cần đăng ký lại" → đăng ký lại thành công.

**Camera (R3 — số liệu từ `/sv/the-sinh-vien/debug`)**
- Luồng camera sau: **1440×2560** (dọc); khả năng tối đa 4032×3024; `takePhoto`: **2160×3840**.
- Vùng thẻ cắt theo khung dọc: **1046×1658** → cạnh dài ≥ 1000 px, qua ngưỡng "ổn" (không cảnh báo).

**Thời gian trên Vercel (T009 — 1 mẫu mỗi loại, chưa rõ cold/warm)**

| Request | Kết quả | Thời gian |
|---|---|---|
| `POST /api/student/card` | 201 (đăng ký thành công) | **6,84 s** |
| `POST /api/student/card` | 422 `LIVENESS_FAILED` | 4,97 s |
| `POST /api/admin/students/{id}/card/reset` | 200 | 1,57 s |

- 201 = 6,84 s **vượt ngưỡng p95 ≤ 5 s của T012** (1 mẫu — cần thêm mẫu cold/warm trước khi quyết Go/No-Go). Bộ nhớ function **chưa đo**.
- Hướng tối ưu (task Polish T145): zxing thử ở kích thước nhỏ trước; bỏ OCR họ tên khi mã vạch đã đọc được hoặc chạy song song với nhận diện mặt; đo bộ nhớ.
