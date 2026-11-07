import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export * as schema from "./schema";

/**
 * Điểm truy cập DB duy nhất cho service/route. Production dùng postgres-js (client.ts);
 * integration test thay bằng PGlite qua setTestDb() — cùng schema, cùng migration.
 */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const holder = globalThis as unknown as { __appDb?: AppDb };

export async function getDb(): Promise<AppDb> {
  if (!holder.__appDb) {
    const url = process.env.DATABASE_URL ?? "";
    if (url.startsWith("pglite:")) {
      const { openLocalDb } = await import("./local");
      holder.__appDb = (await openLocalDb(url)) as unknown as AppDb;
    } else {
      const { db } = await import("./client");
      holder.__appDb = db as unknown as AppDb;
    }
  }
  return holder.__appDb;
}

/** Chỉ dùng trong test. */
export function setTestDb(db: AppDb | undefined) {
  if (process.env.NODE_ENV === "production") throw new Error("setTestDb chỉ dùng trong test");
  holder.__appDb = db;
}
