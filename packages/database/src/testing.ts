import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";

/**
 * Tiện ích cho integration test của mọi package: Postgres nhúng (PGlite, WASM) chạy toàn bộ migration thật.
 * Import qua "@utc/database/testing" — không dùng trong code production.
 */

export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector, unaccent, pg_trgm, btree_gist, pgcrypto } });
  const dir = path.resolve(__dirname, "../migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await readFile(path.join(dir, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) await db.exec(stmt);
    }
  }
  return db;
}

/** Drizzle trên PGlite + gắn làm DB của ứng dụng (getDb()). */
export async function useTestAppDb() {
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("./schema");
  const { setTestDb } = await import("./index");
  const pg = await createTestDb();
  const { seedPeriodsSql } = await import("./seed/periods");
  await pg.exec(seedPeriodsSql());
  const db = drizzle(pg, { schema });
  setTestDb(db as never);
  return {
    pg,
    db,
    async close() {
      setTestDb(undefined);
      await pg.close();
    },
  };
}
