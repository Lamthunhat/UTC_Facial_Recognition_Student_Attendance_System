import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { getDb } from "@utc/database";
import { classes, enrollments } from "@utc/database/schema";
import { vnDateOf } from "@utc/shared/periods";

/**
 * Lớp của chính SV (T062 — màn chọn lớp): ghi danh `active`, lớp chưa qua ngày kết thúc (lớp sắp mở vẫn hiện).
 * `openWindow` luôn null cho tới khi có check-in (US2, T077).
 */
export async function listStudentClasses(studentId: string, today = vnDateOf(new Date())) {
  const db = await getDb();
  const rows = await db
    .select({ classId: classes.id, code: classes.code, courseName: classes.courseName, room: classes.defaultRoom })
    .from(enrollments)
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, "active"), gte(classes.endDate, today)))
    .orderBy(asc(classes.startDate), asc(classes.code));
  return rows.map((r) => ({ ...r, openWindow: null }));
}
