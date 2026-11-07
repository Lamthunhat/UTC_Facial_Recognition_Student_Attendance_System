/**
 * T021 — Dữ liệu demo: 1 admin, 1 giảng viên, 1 lớp mẫu có lịch Thứ 7 tiết 1–3.
 * Mật khẩu lấy từ biến môi trường (không hard-code). Chỉ dùng cho môi trường phát triển.
 *
 * Chạy: SEED_ADMIN_PASSWORD=... SEED_INSTRUCTOR_PASSWORD=... pnpm db:seed:demo
 * - Kết nối qua getDb() của @utc/database → dùng được cả `pglite:<thư mục>` (chạy thử cục bộ) lẫn Postgres/Supabase.
 * - Đọc DATABASE_URL giống create-admin.ts: biến shell → apps/web/.env.local → .env ở thư mục gốc.
 *   Đường dẫn pglite tương đối: đặt ở shell thì tính từ nơi gõ lệnh; lấy từ apps/web/.env.local thì tính từ
 *   apps/web (giống `pnpm dev`) — nên seed vào đúng DB mà app đang dùng.
 * - DIRECT_DATABASE_URL (kết nối trực tiếp, port 5432) được ưu tiên nếu có.
 * - Chạy lại nhiều lần được (upsert theo email / mã lớp; không đổi mật khẩu tài khoản đã có).
 */
import { config } from "dotenv";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import { sql } from "drizzle-orm";

const ROOT = path.resolve(__dirname, "../../..");
const WEB = path.join(ROOT, "apps/web");
const fromShell = Boolean(process.env.DATABASE_URL);
config({ path: path.join(WEB, ".env.local") });
config({ path: path.join(ROOT, ".env") });
if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
const url = process.env.DATABASE_URL ?? "";
if (url.startsWith("pglite:") && !path.isAbsolute(url.slice(7))) {
  const base = fromShell ? (process.env.INIT_CWD ?? process.cwd()) : WEB;
  process.env.DATABASE_URL = `pglite:${path.resolve(base, url.slice(7) || ".pglite")}`;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Không chạy seed demo trên production");
  const adminPw = process.env.SEED_ADMIN_PASSWORD;
  const gvPw = process.env.SEED_INSTRUCTOR_PASSWORD;
  if (!process.env.DATABASE_URL || !adminPw || !gvPw) {
    throw new Error("Thiếu DATABASE_URL / SEED_ADMIN_PASSWORD / SEED_INSTRUCTOR_PASSWORD");
  }

  // Import sau khi đã nạp env: getDb() đọc DATABASE_URL lúc được gọi lần đầu.
  const { getDb } = await import("../src/index");
  const { classes, classSchedules, users } = await import("../src/schema");
  const db = await getDb();

  // Upsert theo email: chỉ cập nhật tên hiển thị, KHÔNG ghi đè mật khẩu của tài khoản đã có.
  const upsertUser = async (email: string, fullName: string, role: "admin" | "instructor", password: string) => {
    const [row] = await db
      .insert(users)
      .values({ email, fullName, role, passwordHash: await hash(password) })
      .onConflictDoUpdate({ target: users.email, set: { fullName: sql`excluded.full_name` } })
      .returning({ id: users.id });
    return row.id;
  };
  const adminId = await upsertUser("admin@demo.utc.edu.vn", "Quản trị viên", "admin", adminPw);
  const gvId = await upsertUser("gv.demo@demo.utc.edu.vn", "Nguyễn Kim Sao", "instructor", gvPw);

  const [cls] = await db
    .insert(classes)
    .values({
      instructorId: gvId,
      code: "Khai phá dữ liệu-1-1-26(N03.BT1)",
      courseName: "Khai phá dữ liệu",
      semester: "1-2026-2027",
      startDate: "2026-09-07",
      endDate: "2026-12-20",
      defaultRoom: "301-A7-A7",
    })
    .onConflictDoUpdate({ target: [classes.instructorId, classes.code], set: { courseName: sql`excluded.course_name` } })
    .returning({ id: classes.id });

  await db.execute(sql`
    insert into ${classSchedules} (class_id, weekday, first_period, last_period)
    select ${cls.id}::uuid, 7, 1, 3
    where not exists (select 1 from ${classSchedules} where class_id = ${cls.id}::uuid)`);

  const where = process.env.DATABASE_URL.startsWith("pglite:") ? process.env.DATABASE_URL : "Postgres (DATABASE_URL)";
  console.log("✔ Seed demo:", { db: where, admin: adminId, instructor: gvId, class: cls.id });
}

main()
  // Pool postgres-js / PGlite giữ tiến trình sống → thoát tường minh khi xong
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
