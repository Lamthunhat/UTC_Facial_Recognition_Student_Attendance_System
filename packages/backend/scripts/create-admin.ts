/**
 * Tạo (hoặc đặt lại mật khẩu) tài khoản Admin đầu tiên trên database thật.
 * Chạy: ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... pnpm admin:create
 * (đọc DATABASE_URL từ apps/web/.env.local hoặc .env ở thư mục gốc nếu chưa đặt ở shell)
 * DB remote (không phải pglite:/localhost) → bắt buộc CONFIRM_REMOTE_DB=true cho lần chạy đó.
 */
import { config } from "dotenv";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { remoteWriteGuardError } from "@utc/database/db-target";
import { users } from "@utc/database/schema";
import { hashPassword } from "../src/auth/password";
import { revokeAllSessions } from "../src/auth/session";

const ROOT = path.resolve(__dirname, "../../..");
const WEB = path.join(ROOT, "apps/web");
// DATABASE_URL đặt ở shell → đường dẫn pglite tương đối tính từ nơi gõ lệnh;
// lấy từ apps/web/.env.local → tính từ apps/web (giống khi chạy `pnpm dev`).
const fromShell = Boolean(process.env.DATABASE_URL);
config({ path: path.join(WEB, ".env.local") });
config({ path: path.join(ROOT, ".env") });
const url = process.env.DATABASE_URL ?? "";
if (url.startsWith("pglite:") && !path.isAbsolute(url.slice(7))) {
  const base = fromShell ? (process.env.INIT_CWD ?? process.cwd()) : WEB;
  process.env.DATABASE_URL = `pglite:${path.resolve(base, url.slice(7) || ".pglite")}`;
}

async function main() {
  const guard = remoteWriteGuardError(process.env, "admin:create");
  if (guard) {
    console.error(guard);
    process.exit(1);
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "Quản trị viên";
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Cần ADMIN_EMAIL và ADMIN_PASSWORD");
  const db = await getDb();
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) {
    await db.update(users).set({ passwordHash, role: "admin", isLocked: false, fullName: name }).where(sql`id = ${existing.id}`);
    await revokeAllSessions(existing.id);
    console.log(`✔ Đã cập nhật admin ${email} (mọi phiên cũ đã bị thu hồi)`);
  } else {
    await db.insert(users).values({ email, fullName: name, passwordHash, role: "admin" });
    console.log(`✔ Đã tạo admin ${email}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.message}\n${e.cause ?? ""}` : e);
  process.exit(1);
});
