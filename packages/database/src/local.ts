import "server-only";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";
import { seedPeriodsSql } from "./seed/periods";

/**
 * Chế độ chạy thử cục bộ không cần Docker/Supabase: DATABASE_URL=pglite:./.pglite
 * → Postgres nhúng (WASM) chạy trong tiến trình, dữ liệu lưu ở thư mục chỉ định.
 * Lần đầu tự chạy migration + seed tiết/ca. KHÔNG dùng cho production (1 tiến trình, không pooler).
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

export async function migrateAll(pg: PGlite) {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await readFile(path.join(dir, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  }
  await pg.exec(seedPeriodsSql());
}

export async function openLocalDb(url: string) {
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("Không dùng Postgres nhúng (pglite:) trên Vercel");
  }
  const dataDir = path.resolve(url.slice(LOCAL_PREFIX.length) || ".pglite");
  const pg = await PGlite.create({ dataDir, extensions: { vector, unaccent, pg_trgm, btree_gist, pgcrypto } });
  const { rows } = await pg.query<{ ok: string | null }>(`select to_regclass('public.users')::text as ok`);
  if (!rows[0]?.ok) await migrateAll(pg);
  return drizzle(pg, { schema });
}
