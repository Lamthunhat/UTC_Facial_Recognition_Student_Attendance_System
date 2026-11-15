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

/**
 * Ngưỡng theo research.md R14.
 * Nguyên tắc khoá: API CHƯA đăng nhập (đăng nhập SV/GV) mới khoá theo IP; mọi API ĐÃ đăng nhập (nonce, đăng ký thẻ,
 * check-in, nhập danh sách…) khoá theo id người dùng (session.sub) — cả lớp đứng sau một IP Wi-Fi trường (NAT)
 * không được làm nhau bị chặn.
 */
export const RULES = {
  /**
   * Đăng nhập SV theo IP: chỉ đếm lượt THẤT BẠI (chống dò mã); vượt thì chặn mọi lượt từ IP đó.
   * 50 vì nhiều lớp chung một NAT Wi-Fi trường và SV gõ nhầm mã. Polish T144: vượt ngưỡng → Turnstile thay vì 429.
   */
  studentLoginIpFail: { limit: 50, windowSec: 300 },
  /** Trần tổng mọi lượt đăng nhập SV theo IP (đủ cho vài lớp sau một NAT, chặn lạm dụng). */
  studentLoginIpTotal: { limit: 300, windowSec: 300 },
  /** Đăng nhập SV theo mã: chỉ đếm lượt THẤT BẠI — người khác không thể khoá hộ mã của SV thật. */
  studentLoginCode: { limit: 5, windowSec: 300 },
  staffLoginIp: { limit: 20, windowSec: 300 },
  scanNonce: { limit: 6, windowSec: 60 },
  /** Đăng ký thẻ: 6 lượt/giờ/SV; lượt lỗi phía server đã phân loại được HOÀN (xem card/register.ts). */
  cardRegister: { limit: 6, windowSec: 3600 },
  /** Trần tổng đăng ký thẻ/giờ/SV — đếm MỌI lượt đã qua nonce, kể cả lượt được hoàn (chặn lặp vô hạn khi server lỗi). */
  cardRegisterTotal: { limit: 20, windowSec: 3600 },
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

/**
 * Ném 429 nếu bộ đếm ĐÃ đạt ngưỡng trong cửa sổ hiện tại — KHÔNG tăng bộ đếm. Dùng cho giới hạn chỉ đếm lượt thất bại:
 * kiểm trước khi xử lý (chặn cả lượt sẽ thành công), còn bộ đếm chỉ tăng bằng hit() khi thất bại.
 */
export async function assertNotLimited(key: string, rule: RateLimitRule): Promise<void> {
  const db = await getDb();
  const res = await db.execute<{ count: number; window_start: string | Date }>(sql`
    select count, window_start from rate_limits
    where key = ${key} and window_start > now() - ${`${rule.windowSec} seconds`}::interval`);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { count: number; window_start: string | Date }[];
  if (rows[0] && Number(rows[0].count) >= rule.limit) {
    const started = new Date(rows[0].window_start).getTime();
    throw tooManyRequests(Math.max(1, Math.ceil((started + rule.windowSec * 1000 - Date.now()) / 1000)));
  }
}

/** Hoàn một lượt đã tính (lỗi phía server, không phải lỗi của người dùng). Không xuống dưới 0. */
export async function refund(key: string): Promise<void> {
  const db = await getDb();
  await db.execute(sql`update rate_limits set count = greatest(count - 1, 0) where key = ${key}`);
}

/** Xoá bộ đếm (ví dụ sau khi đăng nhập thành công). */
export async function reset(key: string): Promise<void> {
  const db = await getDb();
  await db.execute(sql`delete from rate_limits where key = ${key}`);
}
