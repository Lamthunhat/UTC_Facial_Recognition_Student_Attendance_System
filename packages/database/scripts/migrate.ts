/**
 * Chạy mọi migration còn thiếu bằng runner dùng chung (src/migrator.ts) — mỗi file một transaction, ghi nhận vào bảng
 * theo dõi của Drizzle, baseline DB tạo theo cơ chế cũ. Seed tiết/ca khi DB vừa được tạo.
 *   pnpm db:migrate
 * - Postgres/Supabase: ưu tiên DIRECT_DATABASE_URL (kết nối trực tiếp port 5432 — migration cần phiên dài hơn pooler).
 * - `pglite:<thư mục>`: mở qua openLocalDb (cùng đường chạy với `pnpm dev`). Dừng `pnpm dev` trước khi chạy.
 * Đọc DATABASE_URL giống create-admin.ts: biến shell → apps/web/.env.local → .env gốc.
 */
import { config } from "dotenv";
import path from "node:path";
import postgres from "postgres";
import { postgresJsExecutor, runMigrations } from "../src/migrator";
import { seedPeriodsSql } from "../src/seed/periods";

const ROOT = path.resolve(__dirname, "../../..");
const WEB = path.join(ROOT, "apps/web");
const fromShell = Boolean(process.env.DATABASE_URL);
config({ path: path.join(WEB, ".env.local") });
config({ path: path.join(ROOT, ".env") });
if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
const url = process.env.DATABASE_URL ?? "";
if (url.startsWith("pglite:") && !path.isAbsolute(url.slice(7))) {
  const base = fromShell ? (process.env.INIT_CWD ?? process.cwd()) : WEB;
  process.env.DATABASE_URL = `pglite:${path.resolve(base, url.slice(7) || ".pglite")}`;
}

async function main() {
  const target = process.env.DATABASE_URL;
  if (!target) throw new Error("Thiếu DIRECT_DATABASE_URL hoặc DATABASE_URL");

  if (target.startsWith("pglite:")) {
    const { openLocalDb } = await import("../src/local"); // chạy migration + log kết quả khi mở
    await openLocalDb(target);
    console.log(`✔ Migration xong (${target})`);
    return;
  }

  const sql = postgres(target, { max: 1, prepare: false });
  try {
    const r = await runMigrations(postgresJsExecutor(sql), { dir: path.resolve(__dirname, "../migrations") });
    if (r.applied.includes("0000_init")) await sql.unsafe(seedPeriodsSql());
    console.log(`✔ Migration xong — baseline: ${r.baselined.join(", ") || "—"}; đã chạy: ${r.applied.join(", ") || "không có gì mới"}`);
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
