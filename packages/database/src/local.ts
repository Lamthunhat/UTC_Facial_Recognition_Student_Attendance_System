import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { pgliteExecutor, runMigrations } from "./migrator";
import * as schema from "./schema";
import { seedPeriodsSql } from "./seed/periods";

/**
 * Chế độ chạy thử cục bộ không cần Docker/Supabase: DATABASE_URL=pglite:./.pglite
 * → Postgres nhúng (WASM) chạy trong tiến trình, dữ liệu lưu ở thư mục chỉ định.
 * Mỗi lần mở: chạy mọi migration còn thiếu bằng runner dùng chung (migrator.ts) — thêm migration mới KHÔNG cần
 * xoá thư mục dữ liệu; DB tạo theo cơ chế cũ được baseline tự động. Seed tiết/ca chỉ khi DB vừa được tạo (không ghi
 * đè bảng tiết Admin đã sửa). KHÔNG dùng cho production (1 tiến trình, không pooler).
 */
export const LOCAL_PREFIX = "pglite:";

/** Thư mục migration — khi bị Next.js bundle thì __dirname không còn đúng nên thử thêm theo cwd. */
function migrationsDir() {
  const candidates = [
    process.env.DB_MIGRATIONS_DIR,
    path.resolve(__dirname, "../migrations"),
    path.resolve(process.cwd(), "../../packages/database/migrations"),
    path.resolve(process.cwd(), "packages/database/migrations"),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(path.join(p, "meta/_journal.json")));
  if (!found) throw new Error("Không tìm thấy thư mục migrations");
  return found;
}

/** Chạy migration còn thiếu; seed tiết/ca nếu lượt này vừa tạo bảng (0000_init). */
export async function migrateLocal(pg: PGlite) {
  const r = await runMigrations(pgliteExecutor(pg), { dir: migrationsDir() });
  if (r.applied.includes("0000_init")) await pg.exec(seedPeriodsSql());
  return r;
}

export async function openLocalDb(url: string) {
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("Không dùng Postgres nhúng (pglite:) trên Vercel");
  }
  const dataDir = path.resolve(url.slice(LOCAL_PREFIX.length) || ".pglite");
  const pg = await PGlite.create({ dataDir, extensions: { vector, unaccent, pg_trgm, btree_gist, pgcrypto } });
  const r = await migrateLocal(pg);
  if (r.baselined.length || r.applied.length) {
    console.info(`[pglite] ${dataDir}: baseline ${r.baselined.join(", ") || "—"}; đã chạy ${r.applied.join(", ") || "—"}`);
  }
  return drizzle(pg, { schema });
}
