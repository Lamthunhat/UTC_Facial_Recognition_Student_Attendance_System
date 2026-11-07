import "server-only";
import { z } from "zod";

/**
 * T006 — Kiểm tra biến môi trường khi khởi động. Chỉ import ở server (Constitution IX: không bí mật ở client).
 */
const threshold = z.coerce.number().min(0).max(1);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  JWT_SECRET: z.string().min(32, "JWT_SECRET phải dài ít nhất 32 ký tự"),
  CRON_SECRET: z.string().min(16),
  GOONG_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  FACE_MODELS_DIR: z.string().default("models"),
  CARD_REJECT_BELOW: threshold.default(0.35),
  CARD_ACCEPT_ABOVE: threshold.default(0.5),
  DUPLICATE_ABOVE: threshold.default(0.45), // chờ hiệu chỉnh T011
  CHECKIN_MATCH_ABOVE: threshold.default(0.55),
  LEAVE_FIELD_CONFIDENCE: threshold.default(0.8),
  LEAVE_CHAT_APPROVAL_CONFIDENCE: threshold.default(0.85),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Biến môi trường không hợp lệ:\n${issues}`);
    }
    if (parsed.data.CARD_REJECT_BELOW >= parsed.data.CARD_ACCEPT_ABOVE) {
      throw new Error("CARD_REJECT_BELOW phải nhỏ hơn CARD_ACCEPT_ABOVE");
    }
    cached = parsed.data;
  }
  return cached;
}
