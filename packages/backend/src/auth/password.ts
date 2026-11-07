import "server-only";
import { hash, verify } from "@node-rs/argon2";

/** T026 — Băm mật khẩu argon2id (tham số theo khuyến nghị OWASP: m=19 MiB, t=2, p=1). */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < PASSWORD_MIN_LENGTH) throw new Error(`Mật khẩu phải dài ít nhất ${PASSWORD_MIN_LENGTH} ký tự`);
  if (plain.length > 256) throw new Error("Mật khẩu quá dài");
  return hash(plain, OPTIONS);
}

/** So sánh an toàn; trả false thay vì ném lỗi với hash hỏng. */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  if (plain.length > 256) return false;
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

/** Hash giả dùng để so khi email không tồn tại — giữ thời gian phản hồi đồng đều (chống dò email). */
let dummy: Promise<string> | undefined;
export function dummyHash() {
  dummy ??= hash("dummy-password-for-timing", OPTIONS);
  return dummy;
}
