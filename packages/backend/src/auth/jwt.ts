import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

/** T025 — JWT phiên đăng nhập (HS256). Cookie và bảng user_sessions xử lý ở session.ts. */
export const ROLES = ["admin", "instructor", "student"] as const;
export type Role = (typeof ROLES)[number];

const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(ROLES),
  sid: z.string().min(1).max(64),
});
export type SessionClaims = z.infer<typeof ClaimsSchema>;

const ISSUER = "utc-face-attendance";

function key(secret = process.env.JWT_SECRET) {
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET chưa cấu hình hoặc quá ngắn");
  return new TextEncoder().encode(secret);
}

export async function signSession(
  claims: SessionClaims,
  opts: { ttlSeconds: number; now?: number; secret?: string },
): Promise<string> {
  const c = ClaimsSchema.parse(claims);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ role: c.role, sid: c.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(c.sub)
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + opts.ttlSeconds)
    .sign(key(opts.secret));
}

/** Trả về claims nếu hợp lệ, ngược lại null (không ném lỗi để tránh lộ chi tiết). */
export async function verifySession(
  token: string,
  opts: { isRevoked?: (sid: string) => Promise<boolean>; secret?: string } = {},
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(opts.secret), { issuer: ISSUER, algorithms: ["HS256"] });
    const parsed = ClaimsSchema.safeParse({ sub: payload.sub, role: payload.role, sid: payload.sid });
    if (!parsed.success) return null;
    if (opts.isRevoked && (await opts.isRevoked(parsed.data.sid))) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Thời hạn phiên theo vai trò (FR-004, FR-094). */
export const SESSION_TTL_SECONDS: Record<Role, number> = {
  student: 2 * 60 * 60,
  instructor: 12 * 60 * 60,
  admin: 12 * 60 * 60,
};
