import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { loginFailures, users } from "@utc/database/schema";
import { HttpError } from "../http/errors";
import { recordSecurityEvent } from "../security/events";
import { enforce, RULES } from "../security/rate-limit";
import { dummyHash, verifyPassword } from "./password";
import type { Role } from "./jwt";

/**
 * T035 — Đăng nhập giảng viên/admin bằng email + mật khẩu.
 * - Một thông báo chung cho mọi lý do thất bại (không lộ email nào tồn tại / bị khoá).
 * - Sai 5 lần liên tiếp với cùng email → khoá 15 phút (tính cả email không tồn tại để không lộ thông tin).
 * - Giới hạn theo IP ở tầng ứng dụng (RULES.staffLoginIp) bên cạnh WAF.
 */
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export const loginFailed = () =>
  new HttpError(401, "LOGIN_FAILED", "Email hoặc mật khẩu không đúng.");

export async function loginStaff(input: { email: string; password: string; ip: string | null }) {
  const email = input.email.trim().toLowerCase();
  if (input.ip) await enforce(`staff-login:ip:${input.ip}`, RULES.staffLoginIp);
  const db = await getDb();

  const [lock] = await db
    .select({ lockedUntil: loginFailures.lockedUntil })
    .from(loginFailures)
    .where(eq(loginFailures.email, email))
    .limit(1);
  if (lock?.lockedUntil && lock.lockedUntil.getTime() > Date.now()) {
    const retry = Math.ceil((lock.lockedUntil.getTime() - Date.now()) / 1000);
    throw new HttpError(429, "LOGIN_LOCKED", `Đăng nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(retry / 60)} phút.`, {
      "Retry-After": String(retry),
    });
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, role: users.role, isLocked: users.isLocked, fullName: users.fullName })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  // Luôn chạy argon2 để thời gian phản hồi như nhau dù email có tồn tại hay không
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), input.password);

  if (!user || !ok || user.isLocked) {
    await db.execute(sql`
      insert into login_failures (email, count, locked_until) values (${email}, 1, null)
      on conflict (email) do update set
        count = case when login_failures.count + 1 >= ${MAX_FAILS} then 0 else login_failures.count + 1 end,
        locked_until = case when login_failures.count + 1 >= ${MAX_FAILS}
                            then now() + ${`${LOCK_MINUTES} minutes`}::interval else login_failures.locked_until end`);
    await recordSecurityEvent("login_failed", { ip: input.ip, actorId: user?.id ?? null, meta: { kind: "staff" } });
    throw loginFailed();
  }

  await db.delete(loginFailures).where(eq(loginFailures.email, email));
  return { id: user.id, role: user.role as Extract<Role, "admin" | "instructor">, fullName: user.fullName };
}
