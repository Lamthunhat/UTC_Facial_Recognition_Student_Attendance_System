import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { getDb } from "@utc/database";
import { classes, enrollments } from "@utc/database/schema";
import { vnDateOf } from "@utc/shared/periods";
import { openWindowsFor } from "../attendance/checkin";
import { now } from "../clock";

/**
 * Lớp của chính SV (T062 — màn chọn lớp): ghi danh `active`, lớp chưa qua ngày kết thúc (lớp sắp mở vẫn hiện).
 * `openWindow` (US2-1, FR-030): khung đang mở của lớp {id, type, closesAt, done} — check-in ưu tiên; check-out / kiểm
 * tra đột xuất chỉ hiện với SV đã check-in hợp lệ trong buổi; `done` = đã có lượt hợp lệ/nghi vấn trong khung.
 */
export async function listStudentClasses(studentId: string, today = vnDateOf(now())) {
  const db = await getDb();
  const rows = await db
    .select({ classId: classes.id, code: classes.code, courseName: classes.courseName, room: classes.defaultRoom })
    .from(enrollments)
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, "active"), gte(classes.endDate, today)))
    .orderBy(asc(classes.startDate), asc(classes.code));
  const open = await openWindowsFor(studentId, rows.map((r) => r.classId));
  return rows.map((r) => ({ ...r, openWindow: open.get(r.classId) ?? null }));
}
