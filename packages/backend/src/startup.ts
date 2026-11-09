import "server-only";
import { EnvError, localPgliteAllowed, parseEnv, type Env } from "./env";
import { log } from "./log";

/**
 * Kiểm biến môi trường LÚC KHỞI ĐỘNG — gọi từ `apps/web/src/instrumentation.ts` (runtime nodejs).
 * Thiếu/sai → log `env_invalid` kèm TÊN biến (không giá trị) rồi ném lỗi: server không khởi động với cấu hình hỏng,
 * thay vì chỉ lỗi 500 khi một nhánh hiếm (vd. đăng nhập SV thất bại cần LOG_HMAC_SECRET) chạy tới.
 */
export function checkEnvOnStartup(source: Record<string, string | undefined> = process.env): Env {
  let parsed: Env;
  try {
    parsed = parseEnv(source);
  } catch (e) {
    log.error("env_invalid", { names: e instanceof EnvError ? e.names : [] });
    throw e;
  }
  if (parsed.NODE_ENV === "production" && source.DATABASE_URL?.startsWith("pglite:") && localPgliteAllowed(source)) {
    log.warn("pglite_production_local", { hint: "ALLOW_LOCAL_PGLITE=1 — chỉ dùng cục bộ, không cho người dùng thật" });
  }
  return parsed;
}
