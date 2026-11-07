/**
 * Chạy migration + seed tiết/ca. Dùng kết nối trực tiếp (port 5432, DIRECT_DATABASE_URL) nếu có,
 * vì migration cần phiên dài hơn transaction pooler.
 * Chạy: pnpm db:migrate
 */
import "dotenv/config";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { seedPeriodsSql } from "../src/seed/periods";

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu DIRECT_DATABASE_URL hoặc DATABASE_URL");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(sql), { migrationsFolder: path.resolve(__dirname, "../migrations") });
    await sql.unsafe(seedPeriodsSql());
    console.log("✔ Migration + seed tiết/ca xong");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
