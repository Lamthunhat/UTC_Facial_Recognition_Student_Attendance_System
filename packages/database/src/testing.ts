import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgliteExecutor, runMigrations } from "./migrator";

/**
 * Tiện ích cho integration test của mọi package: Postgres nhúng (PGlite, WASM) chạy toàn bộ migration thật
 * bằng đúng runner production dùng (migrator.ts).
 * Import qua "@utc/database/testing" — không dùng trong code production.
 */

export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector, unaccent, pg_trgm, btree_gist, pgcrypto } });
  await runMigrations(pgliteExecutor(db), { dir: path.resolve(__dirname, "../migrations") });
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
