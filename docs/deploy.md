# Triển khai lên Vercel + Supabase

Tài liệu này KHÔNG chứa giá trị bí mật nào — chỉ tên biến và cách tạo. Không dán chuỗi kết nối, khoá hay mật khẩu vào
issue, commit, chat hay file trong repo (kể cả `.env.staging`, `.env.local`).

Thứ tự: **Supabase → migrate → bucket → admin → Vercel (preview) → checklist → production.**

---

## 1. Tổng quan

| Thành phần | Cấu hình |
|---|---|
| Vercel project | Root Directory = `apps/web`, Framework = Next.js, Node.js 22.x, region function `sin1` (Singapore) — đã khai báo trong `apps/web/vercel.json` |
| Lệnh cài / build | Trong `vercel.json`, chạy từ gốc monorepo: `pnpm install --frozen-lockfile` → `pnpm models:download` (tải model InsightFace, **kiểm SHA-256**) → `pnpm --filter @utc/web build` → `pnpm check:traces` (thiếu wasm/OCR/model thì **build fail**, không lên production) |
| Function đọc thẻ | `src/app/api/student/card/route.ts`: `maxDuration` 60 s (đo cục bộ: lần đầu ~4,4 s, các lần sau ~1,9 s) |
| Supabase | Một project ở region **Southeast Asia (Singapore)** cho gần `sin1`. Postgres + Storage (bucket private) |
| Model khuôn mặt | Giấy phép **phi thương mại** (README, research R1) — không phân phối lại; tải lúc build |

## 2. Biến môi trường

Đặt ở Vercel → Project → Settings → Environment Variables. Mỗi biến chọn môi trường **Production** và/hoặc **Preview**.
Biến bí mật đánh dấu **Sensitive**. Không biến nào được có tiền tố `NEXT_PUBLIC_` (sẽ lộ ra trình duyệt).

| Tên | Bắt buộc | Môi trường | Cách tạo / lấy | Ghi chú |
|---|---|---|---|---|
| `DATABASE_URL` | Có | Prod + Preview | Supabase → Connect → **Transaction pooler** (port **6543**) → URI; thay `[YOUR-PASSWORD]` bằng mật khẩu DB | App dùng `prepare: false` (bắt buộc với transaction pooler). Nên dùng 2 project Supabase riêng cho Preview và Production |
| `DB_POOL_MAX` | Không | Prod + Preview | Số nguyên | Kết nối tối đa mỗi instance, mặc định 3 |
| `SUPABASE_URL` | Có | Prod + Preview | Supabase → Project Settings → API → Project URL | Chỉ dùng ở server |
| `SUPABASE_SERVICE_ROLE_KEY` | Có | Prod + Preview | Supabase → Project Settings → API keys → `service_role` (secret) | **Sensitive.** Toàn quyền DB/Storage — chỉ ở server, không bao giờ gửi về trình duyệt |
| `JWT_SECRET` | Có | Prod + Preview | `openssl rand -base64 48` (hoặc `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`) | **Sensitive.** ≥ 32 ký tự. Khác nhau giữa Preview và Production (phiên preview không dùng được ở production). Đổi giá trị = đăng xuất mọi người |
| `LOG_HMAC_SECRET` | Có | Prod + Preview | `openssl rand -base64 48` | **Sensitive.** ≥ 32 ký tự, **khác** `JWT_SECRET`. Khoá HMAC mã SV ghi trong `security_events` (nối các lần dò cùng một mã mà không lưu mã). Thiếu/ngắn → server không khởi động (xem dòng "Biến môi trường" ở §7). Giữ cố định: đổi giá trị = log cũ và mới không nối được với nhau (không ảnh hưởng phiên đăng nhập) |
| `CRON_SECRET` | Có | Prod + Preview | `openssl rand -hex 32` | **Sensitive.** Bảo vệ route cron và route spike |
| `ENABLE_EXPERIMENTAL_COREPACK` | Nên có | Prod + Preview | Đặt `1` | Để Vercel dùng đúng `pnpm@10.28.0` khai trong `package.json` (`packageManager`) |
| `FACE_MODELS_DIR` | Không | — | Đường dẫn tuyệt đối | Để trống (mặc định `<thư mục chạy>/models`). Chỉ đặt nếu log báo không tìm thấy `.onnx` — xem §7 |
| `CARD_REJECT_BELOW`, `CARD_ACCEPT_ABOVE`, `DUPLICATE_ABOVE`, `CHECKIN_MATCH_ABOVE` | Không | Prod + Preview | Số 0–1 | Mặc định 0,35 / 0,5 / 0,45 / 0,55 — **chờ hiệu chỉnh T011**; chỉ đặt khi có số đo |
| `SPIKE_ENABLED` | Không | **Chỉ Preview** | Đặt `1` khi cần đo | Bật `POST /api/spike/face` (cần `Authorization: Bearer <CRON_SECRET>`). **Không bao giờ đặt ở Production.** Route này sẽ bị xoá sau T012 |
| `GOONG_API_KEY` | Chưa | — | Goong console | Dùng từ US2 (địa chỉ trên ảnh bằng chứng) |
| `ANTHROPIC_API_KEY` | Chưa | — | Anthropic console | Dùng từ US7/US8 (trợ lý AI, trích xuất minh chứng) |
| `LEAVE_FIELD_CONFIDENCE`, `LEAVE_CHAT_APPROVAL_CONFIDENCE` | Chưa | — | Số 0–1 | Dùng từ US8 |
| `NODE_ENV`, `VERCEL` | — | — | Vercel tự đặt | Không tự đặt tay |

Chỉ dùng trên **máy của bạn** khi chạy script quản trị (§3, §5) — KHÔNG đặt trên Vercel:

| Tên | Cách tạo | Ghi chú |
|---|---|---|
| `DIRECT_DATABASE_URL` | Supabase → Connect → **Session pooler** (port **5432**) → URI | Migration cần phiên dài → dùng session pooler (hỗ trợ IPv4; "Direct connection" của Supabase chỉ có IPv6). Script ưu tiên biến này hơn `DATABASE_URL` |
| `CONFIRM_REMOTE_DB` | Đặt `true` cho **đúng một lần chạy** | Bắt buộc khi `db:migrate` / `admin:create` ghi lên DB remote. Không lưu trong file `.env*` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Bạn chọn; mật khẩu ≥ 10 ký tự, sinh bằng trình quản lý mật khẩu | Chỉ cho `pnpm admin:create` |

> `pnpm db:seed:demo` **luôn bị chặn** với Supabase/DB remote — dữ liệu demo chỉ dùng cục bộ.

## 3. Chuẩn bị Supabase và chạy migration

1. Tạo project (region Singapore), đặt mật khẩu DB mạnh, lưu vào trình quản lý mật khẩu.
2. Lấy URI **Session pooler** (port 5432) cho bước migrate, URI **Transaction pooler** (port 6543) cho Vercel.
3. Sao lưu trước khi migrate một DB đã có dữ liệu (Supabase → Database → Backups, hoặc `pg_dump`). Migration chỉ đi tiến, không có bước "down".
4. Chạy migrate **từ máy của bạn** (PowerShell, ở thư mục gốc repo; biến đặt ở shell sẽ được ưu tiên hơn `apps/web/.env.local`):

   ```powershell
   $env:DIRECT_DATABASE_URL = Read-Host "Session pooler URI (port 5432)"
   $env:CONFIRM_REMOTE_DB = "true"
   pnpm db:migrate
   Remove-Item Env:CONFIRM_REMOTE_DB, Env:DIRECT_DATABASE_URL
   ```

   bash: `DIRECT_DATABASE_URL='…' CONFIRM_REMOTE_DB=true pnpm db:migrate` (gõ trực tiếp, đừng để lại trong lịch sử shell — thêm khoảng trắng đầu dòng nếu shell bỏ qua lệnh như vậy).

   - Thiếu `CONFIRM_REMOTE_DB=true` → script dừng và in **host** sẽ bị ghi — kiểm host đúng project trước khi bật cờ.
   - Kết quả mong đợi trên DB mới: `đã chạy: 0000_init, 0001_hardening, 0002_card_review, 0003_card_live_check` và seed 16 tiết / 5 ca. Chạy lại: `không có gì mới`.
   - Nếu `CREATE EXTENSION` báo thiếu quyền: bật `vector`, `unaccent`, `pg_trgm`, `btree_gist`, `pgcrypto` ở Database → Extensions rồi chạy lại (mỗi file migration là một transaction — lỗi thì không để lại nửa vời).
5. Kiểm: Database → Tables có RLS **enabled** trên mọi bảng (migration 0001 bật RLS + thu hồi quyền `anon`/`authenticated`; app truy cập bằng service role ở server). Bảng thêm ở migration sau này cũng phải bật RLS.

## 4. Tạo bucket Storage (private)

Supabase → Storage → New bucket, **Public bucket: tắt** cho cả 4 bucket (giống `supabase/config.toml` dùng cục bộ):

| Bucket | Giới hạn file | MIME cho phép | Dùng cho |
|---|---|---|---|
| `cards` | 2 MiB | `image/jpeg` | Ảnh thẻ + chân dung (US6) — giữ tới hết lớp + 30 ngày |
| `evidence` | 2 MiB | `image/jpeg` | Ảnh bằng chứng điểm danh (US2) — xoá sau 7 ngày |
| `leave` | 5 MiB | `image/jpeg`, `image/png`, `application/pdf` | Minh chứng vắng phép (US8) |
| `disputes` | 5 MiB | `image/jpeg`, `image/png` | Phản hồi điểm danh (US9) |

Hoặc chạy trong SQL Editor (không chứa bí mật):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('cards',    'cards',    false, 2097152, array['image/jpeg']),
  ('evidence', 'evidence', false, 2097152, array['image/jpeg']),
  ('leave',    'leave',    false, 5242880, array['image/jpeg','image/png','application/pdf']),
  ('disputes', 'disputes', false, 5242880, array['image/jpeg','image/png'])
on conflict (id) do nothing;
```

Không tạo policy cho `anon`/`authenticated`: chỉ server (service role) đọc/ghi; trình duyệt nhận signed URL 5 phút.

## 5. Tạo tài khoản Admin đầu tiên

```powershell
$env:DATABASE_URL = Read-Host "Session hoặc Transaction pooler URI"
$env:ADMIN_EMAIL = "<email quản trị>"; $env:ADMIN_NAME = "<họ tên>"
$env:ADMIN_PASSWORD = Read-Host "Mật khẩu admin (≥ 10 ký tự)"
$env:CONFIRM_REMOTE_DB = "true"
pnpm admin:create
Remove-Item Env:CONFIRM_REMOTE_DB, Env:DATABASE_URL, Env:ADMIN_PASSWORD, Env:ADMIN_EMAIL, Env:ADMIN_NAME
```

Chạy lại với cùng email = đặt lại mật khẩu và thu hồi mọi phiên cũ. Giảng viên tạo trong giao diện Admin (`/admin/giang-vien`), không tạo bằng script.

## 6. Tạo project Vercel và deploy Preview

1. Vercel → Add New → Project → chọn repo GitHub `UTC_Facial_Recognition_Student_Attendance_System`.
2. **Root Directory: `apps/web`**; giữ bật "Include source files outside of the Root Directory" (cần cho `packages/*`). Framework, lệnh cài/build lấy từ `apps/web/vercel.json` — không ghi đè trong giao diện.
3. Settings → General → Node.js Version: **22.x**.
4. Thêm biến môi trường theo §2 (Preview trỏ project Supabase thử nghiệm).
5. Settings → Deployment Protection: bật cho Preview (chỉ thành viên team xem được).
6. Deploy bản **Preview** trước (push nhánh `001-attendance-core` hoặc `vercel` CLI), chạy checklist §7, đạt rồi mới lên Production.

## 6b. Dữ liệu đọc thẻ trong bản đóng gói

`apps/web/card-assets/` (dữ liệu OCR tiếng Việt + wasm zxing) được tạo lúc build bởi `scripts/card-assets.mjs` (chép từ `node_modules`, kiểm sha256 đã ghim — đổi phiên bản gói thì build hỏng cho tới khi cập nhật hash). Code chạy chỉ đọc theo `<thư mục chạy>/card-assets`. `pnpm check:traces` (chạy trong `buildCommand`) hỏng nếu thiếu file trong trace của `/api/student/card` hoặc nếu đọc thử một thẻ giả trong thư mục mô phỏng output đã trace không được.

## 7. Checklist sau deploy

Ghi kết quả (thời gian, số đo) vào PR/issue deploy. Thay `<url>` bằng URL deployment.

- [ ] **Build log có `pnpm check:traces` → `Đủ file.`** — trên Vercel (Linux) script kiểm thêm `onnxruntime` và `sharp` bản linux-x64. Thiếu bất kỳ mục nào thì build đã fail; nếu không thấy dòng này, kiểm lại `buildCommand`.
- [ ] **Function sống, chưa cần DB**: `curl -i <url>/api/me` → `401` JSON `UNAUTHORIZED` (không phải 500/404).
- [ ] **Biến môi trường**: server kiểm biến lúc khởi động (`apps/web/src/instrumentation.ts`). Thiếu/sai → log function có dòng `{"msg":"env_invalid","names":[...]}` (chỉ tên biến) và **mọi request trả 500** — sửa biến trong Vercel rồi redeploy. `DATABASE_URL=pglite:` luôn bị từ chối trên Vercel (`names:["DATABASE_URL"]`); **không** đặt `ALLOW_LOCAL_PGLITE` trên Vercel (vô tác dụng ở đó, chỉ dành cho máy cục bộ). Với Postgres bắt buộc: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `CRON_SECRET`, `LOG_HMAC_SECRET`.
- [ ] **Header bảo mật**: `curl -I <url>/` có HSTS, CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, `Permissions-Policy`.
- [ ] **DB + phiên**: đăng nhập Admin ở `/login` → `GET /api/me` trả `200` với vai trò admin.
- [ ] **Đăng ký thẻ thử (đường đọc thẻ đầy đủ)**: tạo một giảng viên thử, một lớp đang học, thêm một SV thử bằng mã giả; đăng nhập SV (`/sv` hoặc `POST /api/auth/student/login`), đồng ý điều khoản, lấy nonce, gửi `POST /api/student/card` với **một ảnh JPEG ≤ 1 MB không có mặt người** (ví dụ ảnh chụp một trang giấy) + 3 khung bất kỳ.
  - Mong đợi `422` với mã `UNREADABLE` hoặc `NO_PORTRAIT` → server đã chạy được zxing (wasm), tesseract (worker + wasm + dữ liệu tiếng Việt) và ONNX.
  - `500`, hoặc log có `ENOENT` / `Cannot find module` / `.wasm` / `.onnx` / `traineddata` → thiếu file trong bản đóng gói (xem dòng cuối checklist).
  - KHÔNG dùng ảnh thẻ hay ảnh mặt của người thật cho bước thử này.
- [ ] **Đo cold / warm + bộ nhớ** cho `POST /api/student/card`:
  - Cold: lần gọi đầu sau deploy (hoặc sau ≥ 15 phút không có request). Warm: gọi lại ngay sau đó (cần nonce mới).
  - Thời gian: `curl -w "%{time_total}\n"` hoặc DevTools; bộ nhớ: Vercel → Logs / Observability → request → **Max Memory Used**.
  - Mốc tham chiếu (bản build production chạy cục bộ trên Windows): cold ~4,4 s, warm ~1,9 s, RSS ~600 MB. Ngưỡng chấp nhận: cold < 10 s, warm < 3 s, bộ nhớ < 2 GB (giới hạn Hobby). Vượt → ghi lại và xem T012 (Go/No-Go).
- [ ] **Dọn dẹp**: xoá giảng viên/lớp/SV thử; tắt `SPIKE_ENABLED` nếu đã bật.
- [ ] **Nếu thiếu model / wasm khi chạy** dù build đủ file: function tìm model và dữ liệu theo thư mục chạy (`process.cwd()`). Điểm này **chưa kiểm chứng trên Vercel** (đã kiểm cục bộ với bản build production). Nếu log báo không tìm thấy `models/*.onnx`, đặt `FACE_MODELS_DIR` thành đường dẫn tuyệt đối của thư mục `models` bên trong function (xem đường dẫn trong thông báo lỗi nếu có, hoặc log tạm `process.cwd()`) rồi redeploy; ghi kết quả lại vào tài liệu này.

## 8. Lên Production và rollback

- Production chỉ deploy khi checklist §7 đạt trên Preview cùng commit.
- Code: Vercel → Deployments → **Instant Rollback** về bản trước.
- Database: migration chỉ đi tiến. Migration mới phải tương thích với code bản trước (thêm cột/bảng, chưa xoá) để rollback code không cần rollback DB; khôi phục dữ liệu bằng backup ở §3.
- CI hiện chưa tự chạy khi push (sự cố phía GitHub với repo mới) — chạy tay `gh workflow run CI --ref <nhánh>` và đợi xanh trước khi merge.
