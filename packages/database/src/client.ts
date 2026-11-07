import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * T022 — Kết nối qua Supavisor transaction pooler (port 6543).
 * Transaction mode không hỗ trợ prepared statement → prepare: false.
 * Mỗi instance serverless giữ tối đa vài kết nối; pooler gom lại phía Supabase.
 */
const globalForDb = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };

function client() {
  if (!globalForDb.__pg) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL chưa cấu hình");
    globalForDb.__pg = postgres(url, {
      prepare: false,
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
    });
  }
  return globalForDb.__pg;
}

export const db = drizzle(client(), { schema, casing: "snake_case" });
export type Db = typeof db;
