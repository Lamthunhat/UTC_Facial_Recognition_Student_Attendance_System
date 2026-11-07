import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@utc/database";

/**
 * T038 — Tổng hợp điểm danh toàn trường cho Admin (FR-002). Truy vấn trực tiếp, tham số hoá;
 * bộ lọc FilterSpec của US7 sẽ bổ sung sau (T130).
 */
export interface AttendanceFilter {
  instructorId?: string;
  classId?: string;
  semester?: string;
  from?: string; // YYYY-MM-DD theo ngày buổi học
  to?: string;
  page: number;
  pageSize: number;
}

export interface AttendanceRow {
  classId: string;
  classCode: string;
  courseName: string;
  semester: string | null;
  instructorId: string;
  instructorName: string;
  sessions: number;
  valid: number;
  suspect: number;
  rejected: number;
  approvedLeaves: number;
  lastSessionDate: string | null;
}

export async function attendanceOverview(f: AttendanceFilter) {
  const db = await getDb();
  const conds: SQL[] = [sql`true`];
  if (f.instructorId) conds.push(sql`c.instructor_id = ${f.instructorId}`);
  if (f.classId) conds.push(sql`c.id = ${f.classId}`);
  if (f.semester) conds.push(sql`c.semester = ${f.semester}`);
  const where = sql.join(conds, sql` and `);

  const sesConds: SQL[] = [sql`s.class_id = c.id`];
  if (f.from) sesConds.push(sql`s.date >= ${f.from}::date`);
  if (f.to) sesConds.push(sql`s.date <= ${f.to}::date`);
  const sesWhere = sql.join(sesConds, sql` and `);

  const res = await db.execute(sql`
    with filtered as (
      select c.id as class_id, c.code, c.course_name, c.semester, c.instructor_id, u.full_name as instructor_name,
        (select count(*) from sessions s where ${sesWhere})::int as sessions,
        (select count(*) from attendance_events e join attendance_windows w on w.id = e.window_id
           join sessions s on s.id = w.session_id where ${sesWhere} and e.result = 'valid')::int as valid,
        (select count(*) from attendance_events e join attendance_windows w on w.id = e.window_id
           join sessions s on s.id = w.session_id where ${sesWhere} and e.result = 'suspect')::int as suspect,
        (select count(*) from attendance_events e join attendance_windows w on w.id = e.window_id
           join sessions s on s.id = w.session_id where ${sesWhere} and e.result = 'rejected')::int as rejected,
        (select count(*) from leave_request_sessions ls join leave_requests lr on lr.id = ls.leave_request_id
           join sessions s on s.id = ls.session_id where ${sesWhere} and lr.status = 'approved')::int as approved_leaves,
        (select max(s.date)::text from sessions s where ${sesWhere}) as last_session_date
      from classes c join users u on u.id = c.instructor_id
      where ${where}
    )
    select *, count(*) over ()::int as total from filtered
    where (${f.from ?? null}::date is null and ${f.to ?? null}::date is null) or sessions > 0
    order by last_session_date desc nulls last, code
    limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`);

  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, unknown>[];
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    page: f.page,
    pageSize: f.pageSize,
    rows: rows.map(
      (r): AttendanceRow => ({
        classId: String(r.class_id),
        classCode: String(r.code),
        courseName: String(r.course_name),
        semester: (r.semester as string) ?? null,
        instructorId: String(r.instructor_id),
        instructorName: String(r.instructor_name),
        sessions: Number(r.sessions),
        valid: Number(r.valid),
        suspect: Number(r.suspect),
        rejected: Number(r.rejected),
        approvedLeaves: Number(r.approved_leaves),
        lastSessionDate: (r.last_session_date as string) ?? null,
      }),
    ),
  };
}
