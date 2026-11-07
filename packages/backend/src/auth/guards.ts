import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@utc/database";
import { classes, sessions, users } from "@utc/database/schema";
import { forbidden, notFound, unauthorized } from "../http/errors";
import type { Role, SessionClaims } from "./jwt";

/**
 * T027 — Kiểm tra quyền (Constitution V, FR-089). Mặc định từ chối.
 * Tài nguyên không thuộc quyền trả 404 (không lộ là có tồn tại).
 */
export function requireRole(session: SessionClaims | null, roles: readonly Role[]): SessionClaims {
  if (!session) throw unauthorized();
  if (!roles.includes(session.role)) throw forbidden();
  return session;
}

/** Tài khoản staff còn hoạt động (bị khoá sau khi đăng nhập thì chặn ngay). */
export async function assertStaffActive(session: SessionClaims) {
  if (session.role === "student") return;
  const db = await getDb();
  const [u] = await db.select({ locked: users.isLocked }).from(users).where(eq(users.id, session.sub)).limit(1);
  if (!u || u.locked) throw unauthorized();
}

/** Giảng viên chỉ thao tác lớp của mình; admin xem được mọi lớp. */
export async function assertOwnsClass(session: SessionClaims, classId: string) {
  if (!isUuid(classId)) throw notFound();
  const db = await getDb();
  const where =
    session.role === "admin" ? eq(classes.id, classId) : and(eq(classes.id, classId), eq(classes.instructorId, session.sub));
  const rows = await db.select({ id: classes.id }).from(classes).where(where).limit(1);
  if (rows.length === 0) throw notFound();
}

export async function assertOwnsSession(session: SessionClaims, sessionId: string) {
  if (!isUuid(sessionId)) throw notFound();
  const db = await getDb();
  const rows = await db
    .select({ id: sessions.id, instructorId: classes.instructorId })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (rows.length === 0 || (session.role !== "admin" && rows[0].instructorId !== session.sub)) throw notFound();
}

/** Sinh viên chỉ thao tác dữ liệu của chính mình. */
export function assertSelf(session: SessionClaims, studentId: string) {
  if (session.role !== "student" || session.sub !== studentId) throw forbidden();
}

export function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
