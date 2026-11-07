/**
 * T021 — Dữ liệu demo: 1 admin, 1 giảng viên, 1 lớp mẫu có lịch tiết 1–3.
 * Mật khẩu lấy từ biến môi trường (không hard-code). Chỉ dùng cho môi trường phát triển.
 * Chạy: SEED_ADMIN_PASSWORD=... SEED_INSTRUCTOR_PASSWORD=... pnpm db:seed:demo
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  const adminPw = process.env.SEED_ADMIN_PASSWORD;
  const gvPw = process.env.SEED_INSTRUCTOR_PASSWORD;
  if (!url || !adminPw || !gvPw) throw new Error("Thiếu DATABASE_URL / SEED_ADMIN_PASSWORD / SEED_INSTRUCTOR_PASSWORD");
  if (process.env.NODE_ENV === "production") throw new Error("Không chạy seed demo trên production");

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const [admin] = await sql`
      insert into users (email, password_hash, full_name, role)
      values ('admin@demo.utc.edu.vn', ${await hash(adminPw)}, 'Quản trị viên', 'admin')
      on conflict (email) do update set full_name = excluded.full_name returning id`;
    const [gv] = await sql`
      insert into users (email, password_hash, full_name, role)
      values ('gv.demo@demo.utc.edu.vn', ${await hash(gvPw)}, 'Nguyễn Kim Sao', 'instructor')
      on conflict (email) do update set full_name = excluded.full_name returning id`;
    const [cls] = await sql`
      insert into classes (instructor_id, code, course_name, semester, start_date, end_date, default_room)
      values (${gv.id}, 'Khai phá dữ liệu-1-1-26(N03.BT1)', 'Khai phá dữ liệu', '1-2026-2027', '2026-09-07', '2026-12-20', '301-A7-A7')
      on conflict (instructor_id, code) do update set course_name = excluded.course_name returning id`;
    await sql`
      insert into class_schedules (class_id, weekday, first_period, last_period)
      select ${cls.id}, 7, 1, 3
      where not exists (select 1 from class_schedules where class_id = ${cls.id})`;
    console.log("✔ Seed demo:", { admin: admin.id, instructor: gv.id, class: cls.id });
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
