/**
 * T030 — Log JSON có cấu trúc; tự che các trường nhạy cảm (Constitution IV, FR-095).
 * Không bao giờ ghi ảnh, vector khuôn mặt, mật khẩu, token.
 */
const SENSITIVE_KEYS = /^(password|passwordHash|password_hash|token|jwt|cookie|authorization|embedding|image|photo|frames?|secret|.*key)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return `[binary ${value.byteLength}B]`;
  if (Array.isArray(value)) {
    if (value.length > 64 && value.every((x) => typeof x === "number")) return `[vector ${value.length}]`;
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...(meta ? (redact(meta) as object) : {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};
