import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@utc/database";
import { tooManyRequests } from "../http/errors";

/**
 * T029 — Giới hạn tần suất tầng ứng dụng theo danh tính (FR-081), cửa sổ cố định, lưu trong Postgres
 * (một câu lệnh upsert nguyên tử nên đúng cả khi nhiều instance serverless chạy song song).
 * Tầng biên (Vercel WAF, theo IP) cấu hình riêng — xem docs/security/waf.md (T131).
 */
export interface RateLimitRule {
  limit: number;
  windowSec: number;
}

/** Ngưỡng theo research.md R14. */
export const RULES = {
  studentLoginIp: { limit: 10, windowSec: 300 },
  studentLoginCode: { limit: 5, windowSec: 300 },
  staffLoginIp: { limit: 20, windowSec: 300 },
  scanNonce: { limit: 6, windowSec: 60 },
  cardRegister: { limit: 3, windowSec: 3600 },
  leaveExtract: { limit: 10, windowSec: 3600 },
  assistant: { limit: 20, windowSec: 3600 },
  export: { limit: 30, windowSec: 3600 },
  rosterImport: { limit: 20, windowSec: 3600 },
  geoReverse: { limit: 6, windowSec: 60 },
  disputes: { limit: 10, windowSec: 3600 },
  adminWrite: { limit: 60, windowSec: 60 },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

export async function hit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const db = await getDb();
  const window = `${rule.windowSec} seconds`;
  const res = await db.execute<{ count: number; window_start: string | Date }>(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start <= now() - ${window}::interval then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start <= now() - ${window}::interval then now() else rate_limits.window_start end
    returning count, window_start`);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as {
    count: number;
    window_start: string | Date;
  }[];
  const { count, window_start } = rows[0];
  const started = new Date(window_start).getTime();
  const retryAfterSec = Math.max(1, Math.ceil((started + rule.windowSec * 1000 - Date.now()) / 1000));
  return { allowed: Number(count) <= rule.limit, count: Number(count), retryAfterSec };
}

/** Ném 429 nếu vượt giới hạn. */
export async function enforce(key: string, rule: RateLimitRule): Promise<void> {
  const r = await hit(key, rule);
  if (!r.allowed) throw tooManyRequests(r.retryAfterSec);
}

/** Xoá bộ đếm (ví dụ sau khi đăng nhập thành công). */
export async function reset(key: string): Promise<void> {
  const db = await getDb();
  await db.execute(sql`delete from rate_limits where key = ${key}`);
}
