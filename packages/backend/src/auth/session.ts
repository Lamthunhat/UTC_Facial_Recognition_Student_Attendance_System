import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { userSessions } from "@utc/database/schema";
import { readCookie } from "../security/request";
import { SESSION_TTL_SECONDS, signSession, verifySession, type Role, type SessionClaims } from "./jwt";

/**
 * T025 — Phiên đăng nhập: JWT trong cookie httpOnly + Secure + SameSite=Lax, có `sid` lưu trong
 * user_sessions để thu hồi (đổi mật khẩu, khoá tài khoản — FR-094).
 * Production dùng tiền tố __Host- (bắt buộc Secure, Path=/, không Domain → chống ghi đè từ subdomain).
 */
import { SESSION_COOKIE } from "./cookie";

export { SESSION_COOKIE };

const actorTypeOf = (role: Role) => role; // admin | instructor | student

export async function createSession(actorId: string, role: Role) {
  const db = await getDb();
  const sid = randomBytes(18).toString("base64url");
  const ttl = SESSION_TTL_SECONDS[role];
  await db.insert(userSessions).values({
    sid,
    actorType: actorTypeOf(role),
    actorId,
    expiresAt: new Date(Date.now() + ttl * 1000),
  });
  const token = await signSession({ sub: actorId, role, sid }, { ttlSeconds: ttl });
  // FR-004: phiên SV hết hạn khi đóng trình duyệt → cookie phiên (không Max-Age); JWT + user_sessions vẫn hết hạn sau ttl.
  return { token, cookie: sessionCookie(token, role === "student" ? null : ttl), sid };
}

/** maxAgeSec = null → cookie phiên trình duyệt (mất khi đóng trình duyệt). */
export function sessionCookie(token: string, maxAgeSec: number | null) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = maxAgeSec === null ? "" : `; Max-Age=${maxAgeSec}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secure}`;
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

async function isRevoked(sid: string) {
  const db = await getDb();
  const rows = await db
    .select({ sid: userSessions.sid })
    .from(userSessions)
    .where(and(eq(userSessions.sid, sid), isNull(userSessions.revokedAt), sql`${userSessions.expiresAt} > now()`))
    .limit(1);
  return rows.length === 0;
}

/** Đọc + xác minh phiên từ request; trả null nếu không có / hết hạn / đã thu hồi. */
export async function getSession(req: Request): Promise<SessionClaims | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return verifySession(token, { isRevoked });
}

export async function revokeSession(sid: string) {
  const db = await getDb();
  await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.sid, sid));
}

/** Thu hồi mọi phiên của một người (đổi mật khẩu, khoá tài khoản). */
export async function revokeAllSessions(actorId: string) {
  const db = await getDb();
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.actorId, actorId), isNull(userSessions.revokedAt)));
}
