import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { enrollments, students } from "@utc/database/schema";

/**
 * T063 — Danh sách SV đang học của một lớp kèm trạng thái thẻ (cho giảng viên/Admin; gọi sau assertOwnsClass).
 * Thẻ = thẻ hiệu lực (active/pending_review), nếu không có thì thẻ gần nhất (để thấy "bị từ chối"/"đã đặt lại").
 * Không trả ảnh, đường dẫn ảnh hay embedding — chi tiết từng thẻ xem qua GET /api/admin/students/{id}/card.
 */
export type ClassCardStatus = "active" | "pending_review" | "rejected" | "reset";

export async function listClassCards(classId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      studentId: students.id,
      code: students.studentCode,
      lastName: students.lastName,
      firstName: students.firstName,
      adminClass: students.adminClass,
      card: sql<{ status: string; review_reasons: string[]; registered_at: string; reviewed_by: string | null } | null>`(
        select json_build_object('status', sc.status, 'review_reasons', sc.review_reasons, 'registered_at', sc.registered_at, 'reviewed_by', sc.reviewed_by)
        from student_cards sc where sc.student_id = ${students.id}
        order by case when sc.status in ('active','pending_review') then 0 else 1 end, sc.registered_at desc
        limit 1)`,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(sql`${enrollments.classId} = ${classId} and ${enrollments.status} = 'active'`)
    .orderBy(asc(students.firstName), asc(students.lastName), asc(students.studentCode));

  return rows.map((r) => {
    const c = r.card;
    let status: ClassCardStatus | null = null;
    if (c?.status === "active" || c?.status === "pending_review") status = c.status;
    else if (c?.status === "deleted" && c.reviewed_by) status = "rejected";
    else if (c?.status === "replaced") status = "reset";
    return {
      studentId: r.studentId,
      code: r.code,
      fullName: `${r.lastName} ${r.firstName}`,
      adminClass: r.adminClass,
      card: status
        ? { status, reviewReasons: status === "pending_review" ? (c!.review_reasons ?? []) : [], registeredAt: c!.registered_at }
        : null,
    };
  });
}
