import { z } from "zod";
import { assertCanManageStudent, reviewStudentCard } from "../../card/admin";
import { json, route } from "../../http/handler";
import { enforce, RULES } from "../../security/rate-limit";

/** POST /api/admin/students/{id}/card/review — {decision: approve|reject, note?} cho thẻ `pending_review` (US6-6). */
const Body = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional() })
  .strict();

export const POST = route<{ id: string }, typeof Body>({ roles: ["instructor", "admin"], body: Body }, async ({ session, params, body }) => {
  await assertCanManageStudent(session!, params.id);
  await enforce(`admin-write:${session!.sub}`, RULES.adminWrite);
  return json(await reviewStudentCard(session!, params.id, body.decision, body.note));
});
