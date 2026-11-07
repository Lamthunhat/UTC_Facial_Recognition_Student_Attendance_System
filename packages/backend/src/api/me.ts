import { eq } from "drizzle-orm";
import { getDb } from "@utc/database";
import { students, users } from "@utc/database/schema";
import { unauthorized } from "../http/errors";
import { json, route } from "../http/handler";

/** GET /api/me — thông tin phiên hiện tại. */
export const GET = route({ roles: ["admin", "instructor", "student"] }, async ({ session }) => {
  const db = await getDb();
  if (session!.role === "student") {
    const [s] = await db
      .select({ id: students.id, code: students.studentCode, lastName: students.lastName, firstName: students.firstName, consentAt: students.consentAt })
      .from(students)
      .where(eq(students.id, session!.sub))
      .limit(1);
    if (!s) throw unauthorized();
    return json({ user: { role: "student", ...s, fullName: `${s.lastName} ${s.firstName}` } });
  }
  const [u] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role })
    .from(users)
    .where(eq(users.id, session!.sub))
    .limit(1);
  if (!u) throw unauthorized();
  return json({ user: u });
});
