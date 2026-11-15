import "server-only";
import { z } from "zod";
import { HttpError } from "./http/errors";
import { log } from "./log";

/**
 * T006 — Kiểm tra biến môi trường. Chỉ import ở server (Constitution IX: không bí mật ở client).
 * Thông báo lỗi chỉ nêu TÊN biến, không bao giờ in giá trị.
 * Khoá dịch vụ ngoài chưa dùng tới (GOONG_API_KEY, ANTHROPIC_API_KEY) là tuỳ chọn: thiếu thì app vẫn chạy, tính năng
 * cần khoá gọi goongApiKey()/anthropicApiKey() và nhận lỗi 503 NOT_CONFIGURED ("chưa cấu hình").
 */
const threshold = z.coerce.number().min(0).max(1);
/** Chuỗi rỗng / toàn khoảng trắng coi như chưa đặt. */
const optionalSecret = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());

/** Biến dùng chung cho mọi môi trường. JWT_SECRET, LOG_HMAC_SECRET luôn bắt buộc. */
const base = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET phải dài ít nhất 32 ký tự"),
  LOG_HMAC_SECRET: z.string().min(32, "LOG_HMAC_SECRET phải dài ít nhất 32 ký tự"), // HMAC mã SV trong security_events
  GOONG_API_KEY: optionalSecret, // US2 — địa chỉ trên ảnh bằng chứng
  ANTHROPIC_API_KEY: optionalSecret, // US7/US8 — trợ lý AI, trích xuất minh chứng
  FACE_MODELS_DIR: z.string().default("models"),
  CARD_REJECT_BELOW: threshold.default(0.35),
  CARD_ACCEPT_ABOVE: threshold.default(0.5),
  DUPLICATE_ABOVE: threshold.default(0.45), // chờ hiệu chỉnh T011
  CHECKIN_MATCH_ABOVE: threshold.default(0.55),
  LEAVE_FIELD_CONFIDENCE: threshold.default(0.8),
  LEAVE_CHAT_APPROVAL_CONFIDENCE: threshold.default(0.85),
};
/**
 * SUPABASE_URL phải là ORIGIN thuần: https://<ref>.supabase.co — không path (hay dán nhầm ".../rest/v1"), không "/" cuối,
 * không query. http chỉ cho localhost/127.0.0.1 (Supabase CLI). Thông báo lỗi không chứa giá trị.
 */
const SUPABASE_ORIGIN_MSG =
  "SUPABASE_URL phải là origin thuần dạng https://<ref>.supabase.co (không path, không '/' cuối) — nếu có '/rest/v1' thì bỏ đi";
const supabaseOrigin = z.string().refine((v) => {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  const schemeOk = u.protocol === "https:" || (u.protocol === "http:" && local);
  return schemeOk && v === u.origin; // origin không có path, "/" cuối, query, hash, user:pass
}, SUPABASE_ORIGIN_MSG);

/** Storage + cron: bắt buộc với Postgres (Supabase/Vercel). */
const hosted = {
  SUPABASE_URL: supabaseOrigin,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CRON_SECRET: z.string().min(16),
};
const HostedSchema = z.object({ ...base, ...hosted });
/**
 * `DATABASE_URL=pglite:` chỉ dùng cục bộ (README: chạy thử chỉ cần DATABASE_URL + JWT_SECRET + LOG_HMAC_SECRET):
 * storage/cron tuỳ chọn — tính năng cần tới tự báo thiếu khi dùng (evidence/storage.ts).
 */
const LocalSchema = z.object({
  ...base,
  SUPABASE_URL: hosted.SUPABASE_URL.optional(),
  SUPABASE_SERVICE_ROLE_KEY: hosted.SUPABASE_SERVICE_ROLE_KEY.optional(),
  CRON_SECRET: hosted.CRON_SECRET.optional(),
});

export type Env = z.infer<typeof LocalSchema>;

/** Lỗi cấu hình: `names` = tên các biến sai/thiếu (không bao giờ chứa giá trị). */
export class EnvError extends Error {
  constructor(
    message: string,
    readonly names: string[],
  ) {
    super(message);
    this.name = "EnvError";
  }
}

/** Bản build production chạy cục bộ trên pglite (đo hiệu năng, thử khởi động) — bật bằng ALLOW_LOCAL_PGLITE=1, không bao giờ trên Vercel. */
export function localPgliteAllowed(source: Record<string, string | undefined>): boolean {
  return source.ALLOW_LOCAL_PGLITE === "1" && source.VERCEL !== "1";
}

/** Kiểm một nguồn biến môi trường (thuần, dùng cho env(), kiểm khởi động và test). Lỗi chỉ nêu tên biến + lý do, không in giá trị. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const pglite = !!source.DATABASE_URL?.startsWith("pglite:");
  const problems: { name: string; message: string }[] = [];
  // Postgres nhúng chỉ cho dev cục bộ: dữ liệu nằm trên đĩa tạm của instance (mất khi scale/redeploy), một tiến trình.
  // Trên Vercel: luôn chặn. NODE_ENV=production ngoài Vercel (next start cục bộ): chỉ khi ALLOW_LOCAL_PGLITE=1.
  if (pglite && (source.VERCEL === "1" || (source.NODE_ENV === "production" && !localPgliteAllowed(source)))) {
    problems.push({
      name: "DATABASE_URL",
      message: "DATABASE_URL: pglite: chỉ dùng cho dev cục bộ — cấm trên Vercel; production cục bộ cần ALLOW_LOCAL_PGLITE=1",
    });
  }
  const parsed = (pglite ? LocalSchema : HostedSchema).safeParse(source);
  if (!parsed.success) {
    for (const i of parsed.error.issues) problems.push({ name: String(i.path[0]), message: `${i.path.join(".")}: ${i.message}` });
  }
  if (problems.length || !parsed.success) {
    const names = [...new Set(problems.map((p) => p.name))];
    throw new EnvError(`Biến môi trường không hợp lệ:\n${problems.map((p) => p.message).join("\n")}`, names);
  }
  if (parsed.data.CARD_REJECT_BELOW >= parsed.data.CARD_ACCEPT_ABOVE) {
    throw new EnvError("CARD_REJECT_BELOW phải nhỏ hơn CARD_ACCEPT_ABOVE", ["CARD_REJECT_BELOW", "CARD_ACCEPT_ABOVE"]);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * Khoá dịch vụ ngoài, đọc LÚC DÙNG. Thiếu → ghi log tên biến (cho quản trị) và ném 503 NOT_CONFIGURED với thông báo
 * chung cho người dùng (không lộ tên biến/cấu hình máy chủ).
 */
function requireOptional(name: "GOONG_API_KEY" | "ANTHROPIC_API_KEY"): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  log.error("env_not_configured", { name });
  throw new HttpError(503, "NOT_CONFIGURED", "Tính năng này chưa được cấu hình trên máy chủ. Vui lòng báo quản trị viên.");
}

export const goongApiKey = () => requireOptional("GOONG_API_KEY");
export const anthropicApiKey = () => requireOptional("ANTHROPIC_API_KEY");
