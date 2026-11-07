import { z } from "zod";
import { createInstructor, listInstructors } from "../../admin/instructors";
import { PASSWORD_MIN_LENGTH } from "../../auth/password";
import { json, route } from "../../http/handler";
import { enforce, RULES } from "../../security/rate-limit";

/** GET/POST /api/admin/instructors — contracts/api.md §2 */
export const GET = route({ roles: ["admin"] }, async () => json({ instructors: await listInstructors() }));

const Body = z
  .object({
    email: z.string().trim().email().max(254),
    fullName: z.string().trim().min(2).max(120),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(256),
  })
  .strict();

export const POST = route({ roles: ["admin"], body: Body }, async ({ session, body }) => {
  await enforce(`admin-write:${session!.sub}`, RULES.adminWrite);
  const instructor = await createInstructor(session!, body);
  return json({ instructor }, { status: 201 });
});
