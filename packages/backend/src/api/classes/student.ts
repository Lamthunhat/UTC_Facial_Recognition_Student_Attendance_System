import { z } from "zod";
import { assertOwnsClass } from "../../auth/guards";
import { json, route } from "../../http/handler";
import { addStudent, withdrawStudent } from "../../roster/commit";

/**
 * POST/DELETE /api/classes/{id}/students/{code} — thêm / rút thủ công một sinh viên (FR-015).
 * Nhật ký roster.student_add / roster.student_withdraw được ghi trong transaction của service.
 */
const Body = z
  .object({
    lastName: z.string().max(100).optional(),
    firstName: z.string().max(60).optional(),
    adminClass: z.string().max(40).nullable().optional(),
    cohort: z.string().max(20).nullable().optional(),
  })
  .strict();

type P = { id: string; code: string };

export const POST = route<P, typeof Body>({ roles: ["instructor", "admin"], body: Body }, async ({ session, params, body }) => {
  await assertOwnsClass(session!, params.id);
  const r = await addStudent(session!, params.id, params.code, body);
  return json({ enrollment: r.enrollment, changed: r.changed }, { status: r.created ? 201 : 200 });
});

export const DELETE = route<P>({ roles: ["instructor", "admin"] }, async ({ session, params }) => {
  await assertOwnsClass(session!, params.id);
  const r = await withdrawStudent(session!, params.id, params.code);
  return json({ enrollment: r.enrollment, changed: r.changed });
});
