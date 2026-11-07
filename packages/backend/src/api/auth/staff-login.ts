import { z } from "zod";
import { createSession } from "../../auth/session";
import { loginStaff } from "../../auth/staff-login";
import { json, route } from "../../http/handler";

/** POST /api/auth/staff/login — contracts/api.md §1 */
const Body = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

export const POST = route({ body: Body, maxBodyBytes: 2_000 }, async ({ body, ip }) => {
  const user = await loginStaff({ email: body.email, password: body.password, ip });
  const session = await createSession(user.id, user.role);
  return json(
    { user: { id: user.id, role: user.role, fullName: user.fullName } },
    { headers: { "Set-Cookie": session.cookie } },
  );
});
