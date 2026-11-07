import { z } from "zod";
import { updateInstructor } from "../../admin/instructors";
import { isUuid } from "../../auth/guards";
import { PASSWORD_MIN_LENGTH } from "../../auth/password";
import { notFound } from "../../http/errors";
import { json, route } from "../../http/handler";
import { enforce, RULES } from "../../security/rate-limit";

/** PATCH /api/admin/instructors/{id} — khoá/mở khoá, đặt lại mật khẩu, đổi tên. */
const Body = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    isLocked: z.boolean().optional(),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(256).optional(),
  })
  .strict();

export const PATCH = route<{ id: string }, typeof Body>({ roles: ["admin"], body: Body }, async ({ session, params, body }) => {
  if (!isUuid(params.id)) throw notFound();
  await enforce(`admin-write:${session!.sub}`, RULES.adminWrite);
  return json({ instructor: await updateInstructor(session!, params.id, body) });
});
