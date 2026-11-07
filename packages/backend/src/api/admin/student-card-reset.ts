import { z } from "zod";
import { assertCanManageStudent, resetStudentCard } from "../../card/admin";
import { json, route } from "../../http/handler";
import { enforce, RULES } from "../../security/rate-limit";

/** POST /api/admin/students/{id}/card/reset — {reason} → thẻ hiệu lực thành `replaced`, SV đăng ký lại được (US6-9). */
const Body = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const POST = route<{ id: string }, typeof Body>({ roles: ["instructor", "admin"], body: Body }, async ({ session, params, body, ip }) => {
  await assertCanManageStudent(session!, params.id);
  await enforce(`admin-write:${session!.sub}`, RULES.adminWrite);
  return json(await resetStudentCard(session!, params.id, body.reason, ip));
});
