import "server-only";
import { EnvError, parseEnv, type Env } from "./env";
import { log } from "./log";

/**
 * Kiểm biến môi trường LÚC KHỞI ĐỘNG — gọi từ `apps/web/src/instrumentation.ts` (runtime nodejs).
 * Thiếu/sai → log `env_invalid` kèm TÊN biến (không giá trị) rồi ném lỗi: server không khởi động với cấu hình hỏng,
 * thay vì chỉ lỗi 500 khi một nhánh hiếm (vd. đăng nhập SV thất bại cần LOG_HMAC_SECRET) chạy tới.
 */
export function checkEnvOnStartup(source: Record<string, string | undefined> = process.env): Env {
  try {
    return parseEnv(source);
  } catch (e) {
    log.error("env_invalid", { names: e instanceof EnvError ? e.names : [] });
    throw e;
  }
}
