# Điểm danh UTC — nhận diện khuôn mặt + GPS

Hệ thống điểm danh sinh viên cho Trường ĐH Giao thông Vận tải. Đặc tả, kế hoạch và danh sách task nằm trong `specs/001-attendance-core/` (quy trình Spec Kit); nguyên tắc dự án ở `.specify/memory/constitution.md`.

## Cấu trúc (monorepo pnpm)

| Thư mục | Package | Vai trò |
|---|---|---|
| `apps/web` | `@utc/web` | **Front-end**: Next.js — giao diện + route API mỏng |
| `packages/backend` | `@utc/backend` | **Back-end**: xác thực, phân quyền, bảo mật, nhận diện khuôn mặt, điểm danh… |
| `packages/database` | `@utc/database` | **Database**: Drizzle schema, migration SQL, seed, kết nối |
| `packages/shared` | `@utc/shared` | Mã dùng chung: tiết/ca/giờ VN, xử lý tiếng Việt |

Phụ thuộc một chiều: `web → backend → database → shared`. Giao diện không truy cập database trực tiếp.

## Yêu cầu

- Node.js ≥ 22, pnpm 10 (`npm install -g pnpm@10`)
- Docker Desktop + Supabase CLI nếu chạy database cục bộ (test không cần — dùng Postgres nhúng PGlite)

## Bắt đầu

```powershell
pnpm install
pnpm models:download                    # tải model khuôn mặt vào apps/web/models
copy .env.example apps\web\.env.local   # rồi sửa các giá trị bên dưới
pnpm dev                                # http://localhost:3000
```

**Chạy thử không cần Supabase/Docker** — trong `apps/web/.env.local` chỉ cần:

```
DATABASE_URL=pglite:./.pglite
JWT_SECRET=<chuỗi ngẫu nhiên ≥ 32 ký tự>
```

Postgres nhúng tự tạo bảng + 16 tiết ở lần chạy đầu (dữ liệu lưu trong `apps/web/.pglite`). Tạo tài khoản quản trị đầu tiên (dừng `pnpm dev` trước, vì Postgres nhúng chỉ cho một tiến trình mở; script tự đọc `DATABASE_URL` trong `apps/web/.env.local`):

```powershell
$env:ADMIN_EMAIL="admin@utc.edu.vn"; $env:ADMIN_PASSWORD="mat-khau-dai-it-nhat-10"; $env:ADMIN_NAME="Quản trị viên"
pnpm admin:create
```

Rồi chạy lại `pnpm dev` và đăng nhập tại `/login`.

## Lệnh thường dùng (chạy ở thư mục gốc)

| Lệnh | Việc |
|---|---|
| `pnpm test` | Test mọi package |
| `pnpm --filter @utc/backend test` | Test riêng một package |
| `pnpm lint` · `pnpm typecheck` | Kiểm tra mã |
| `pnpm build` | Build Next.js |
| `pnpm db:generate` | Sinh migration từ `packages/database/src/schema.ts` |
| `pnpm db:migrate` | Chạy migration + seed 16 tiết / 5 ca vào database trong `DATABASE_URL` |
| `pnpm admin:create` | Tạo/đặt lại tài khoản Admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`) |
| `pnpm db:seed:demo` | Dữ liệu demo (cần `SEED_ADMIN_PASSWORD`, `SEED_INSTRUCTOR_PASSWORD`) |
| `pnpm --filter @utc/backend spike:face <ảnh>` | Đo tốc độ nhận diện khuôn mặt |
| `pnpm --filter @utc/backend spike:card <ảnh thẻ>` | Thử đọc mã vạch thẻ sinh viên |
| `pnpm --filter @utc/backend calibrate:card <thư mục ảnh>` | Đo đọc thẻ trên ảnh thẻ thật (cục bộ, không lưu/gửi ảnh) — xác nhận R3, hiệu chỉnh ngưỡng chân dung |
| `pnpm check:traces` | Sau `pnpm build`: kiểm function đọc thẻ có đủ wasm + dữ liệu OCR + model trong bản đóng gói |

## Lưu ý

- **Giấy phép model khuôn mặt**: trọng số InsightFace `buffalo_s` (SCRFD-500M + MobileFaceNet) chỉ được dùng cho **mục đích phi thương mại / nghiên cứu học thuật** — phù hợp đồ án, KHÔNG dùng cho sản phẩm thương mại hay dịch vụ thu phí (khi đó phải thay model có giấy phép thương mại và hiệu chỉnh lại ngưỡng). Repo không phân phối lại model: tải bằng `pnpm models:download` (kiểm SHA-256). Chi tiết: `specs/001-attendance-core/research.md` R1.
- Không commit ảnh khuôn mặt, ảnh thẻ, file `.env*` hay thư mục `models/`.
- Font Be Vietnam Pro theo giấy phép SIL OFL 1.1 (`apps/web/public/fonts/OFL.txt`).
- Deploy Vercel: Root Directory = `apps/web`.
