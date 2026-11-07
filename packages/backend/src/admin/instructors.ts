import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { classes, users } from "@utc/database/schema";
import { writeAudit } from "../audit";
import type { SessionClaims } from "../auth/jwt";
import { hashPassword } from "../auth/password";
import { revokeAllSessions } from "../auth/session";
import { HttpError, notFound } from "../http/errors";

/** T037 — Admin quản lý tài khoản giảng viên (FR-002). Không trả password_hash ra ngoài. */
export async function listInstructors() {
  const db = await getDb();
  return db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isLocked: users.isLocked,
      createdAt: users.createdAt,
      classCount: count(classes.id),
    })
    .from(users)
    .leftJoin(classes, eq(classes.instructorId, users.id))
    .where(eq(users.role, "instructor"))
    .groupBy(users.id)
    .orderBy(users.fullName);
}

export async function createInstructor(actor: SessionClaims, input: { email: string; fullName: string; password: string }) {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();
  const exists = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (exists.length) throw new HttpError(409, "EMAIL_EXISTS", "Email này đã có tài khoản.");
  const [row] = await db
    .insert(users)
    .values({ email, fullName: input.fullName.trim(), passwordHash: await hashPassword(input.password), role: "instructor" })
    .returning({ id: users.id, email: users.email, fullName: users.fullName });
  await writeAudit(actor, "instructor.create", { type: "user", id: row.id }, { email });
  return row;
}

export async function updateInstructor(
  actor: SessionClaims,
  id: string,
  patch: { fullName?: string; isLocked?: boolean; password?: string },
) {
  const db = await getDb();
  const [target] = await db
    .select({ id: users.id, isLocked: users.isLocked })
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "instructor")))
    .limit(1);
  if (!target) throw notFound();

  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.fullName !== undefined) set.fullName = patch.fullName.trim();
  if (patch.isLocked !== undefined) set.isLocked = patch.isLocked;
  if (patch.password !== undefined) set.passwordHash = await hashPassword(patch.password);
  if (Object.keys(set).length === 0) throw new HttpError(422, "NOTHING_TO_UPDATE", "Không có thay đổi nào.");

  await db.update(users).set(set).where(eq(users.id, id));

  // Khoá tài khoản hoặc đổi mật khẩu → đăng xuất khỏi mọi thiết bị (FR-094)
  if (patch.isLocked === true || patch.password !== undefined) await revokeAllSessions(id);

  if (patch.isLocked !== undefined && patch.isLocked !== target.isLocked)
    await writeAudit(actor, patch.isLocked ? "instructor.lock" : "instructor.unlock", { type: "user", id });
  if (patch.password !== undefined) await writeAudit(actor, "instructor.reset_password", { type: "user", id });
  if (patch.fullName !== undefined) await writeAudit(actor, "instructor.rename", { type: "user", id }, { fullName: set.fullName });

  const [row] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, isLocked: users.isLocked })
    .from(users)
    .where(eq(users.id, id));
  return row;
}
