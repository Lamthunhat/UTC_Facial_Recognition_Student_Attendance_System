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

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  JWT_SECRET: z.string().min(32, "JWT_SECRET phải dài ít nhất 32 ký tự"),
  CRON_SECRET: z.string().min(16),
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
});

export type Env = z.infer<typeof EnvSchema>;

/** Kiểm một nguồn biến môi trường (thuần, dùng cho env() và test). Lỗi chỉ nêu tên biến + lý do, không in giá trị. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Biến môi trường không hợp lệ:\n${issues}`);
  }
  if (parsed.data.CARD_REJECT_BELOW >= parsed.data.CARD_ACCEPT_ABOVE) {
    throw new Error("CARD_REJECT_BELOW phải nhỏ hơn CARD_ACCEPT_ABOVE");
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
