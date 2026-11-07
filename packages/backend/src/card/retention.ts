import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@utc/database";

/**
 * T064 — Hạn giữ ảnh thẻ + đặc trưng khuôn mặt (FR-054): hết ngày thứ 30 sau ngày kết thúc của lớp muộn nhất
 * mà SV đang học (ghi danh active; nếu đã rút hết thì tính mọi lớp từng học). purge_after = 00:00 giờ VN
 * của ngày (end_date + 31). Cron xoá (Polish) dựa vào cột này.
 * Gọi trong CÙNG transaction với thao tác làm thay đổi ghi danh hoặc ngày kết thúc lớp.
 */
export const CARD_RETENTION_DAYS = 30;

/** Biểu thức purge_after cho một student_id (VN cố định UTC+7, không đổi giờ mùa hè). */
const purgeFor = (studentId: SQL) => sql`(
  select ((coalesce(max(c.end_date) filter (where e.status = 'active'), max(c.end_date))
           + ${CARD_RETENTION_DAYS + 1}::int)::timestamp at time zone 'UTC') - interval '7 hours'
  from enrollments e join classes c on c.id = e.class_id
  where e.student_id = ${studentId}
)`;

/** purge_after cho thẻ mới của một SV (null nếu SV chưa từng thuộc lớp nào). */
export async function cardPurgeAfter(db: AppDb, studentId: string): Promise<Date | null> {
  const res = await db.execute<{ p: string | Date | null }>(sql`select ${purgeFor(sql`${studentId}::uuid`)} as p`);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { p: string | Date | null }[];
  return rows[0]?.p ? new Date(rows[0].p) : null;
}

/** Tính lại purge_after cho thẻ hiệu lực của các SV liên quan (theo danh sách SV hoặc cả lớp). */
export async function refreshCardRetention(db: AppDb, scope: { studentIds: string[] } | { classId: string }) {
  const who =
    "classId" in scope
      ? sql`sc.student_id in (select student_id from enrollments where class_id = ${scope.classId})`
      : scope.studentIds.length
        ? sql`sc.student_id in (${sql.join(scope.studentIds.map((id) => sql`${id}::uuid`), sql`, `)})`
        : sql`false`;
  await db.execute(sql`
    update student_cards sc set purge_after = ${purgeFor(sql`sc.student_id`)}
    where sc.status in ('active', 'pending_review') and ${who}`);
}
