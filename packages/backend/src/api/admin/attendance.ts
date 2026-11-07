import { z } from "zod";
import { attendanceOverview } from "../../admin/attendance";
import { writeAudit } from "../../audit";
import { json, route } from "../../http/handler";

/** GET /api/admin/attendance — dữ liệu điểm danh toàn trường (FR-002, T038). */
const Date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD");
const Query = z
  .object({
    instructorId: z.string().uuid().optional(),
    classId: z.string().uuid().optional(),
    semester: z.string().max(40).optional(),
    from: Date.optional(),
    to: Date.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const GET = route({ roles: ["admin"] }, async ({ req, session }) => {
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const data = await attendanceOverview(q);
  await writeAudit(session, "admin.attendance.view", undefined, { filter: q, rows: data.rows.length });
  return json(data);
});
