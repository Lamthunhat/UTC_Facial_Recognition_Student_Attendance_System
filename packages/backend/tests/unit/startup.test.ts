import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEnvOnStartup } from "../../src/startup";

/**
 * Kiểm biến môi trường LÚC KHỞI ĐỘNG (apps/web/src/instrumentation.ts gọi checkEnvOnStartup ở runtime nodejs):
 * thiếu/sai → ném lỗi ngay, log chỉ nêu TÊN biến, không bao giờ in giá trị.
 */
const POSTGRES = {
  DATABASE_URL: "postgresql://u:matkhau-db@db.example.com:5432/x",
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
  JWT_SECRET: "j".repeat(40),
  CRON_SECRET: "c".repeat(32),
  LOG_HMAC_SECRET: "l".repeat(40),
};
const PGLITE = { DATABASE_URL: "pglite:./.pglite", JWT_SECRET: "j".repeat(40), LOG_HMAC_SECRET: "l".repeat(40) };

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(String(line)));
});
afterEach(() => vi.restoreAllMocks());

function startupError(source: Record<string, string | undefined>) {
  try {
    checkEnvOnStartup(source);
  } catch (e) {
    return e as Error;
  }
  throw new Error("checkEnvOnStartup không ném lỗi");
}

describe("checkEnvOnStartup", () => {
  it("đủ biến (Postgres) → không lỗi, không log lỗi", () => {
    expect(checkEnvOnStartup(POSTGRES).LOG_HMAC_SECRET).toBe(POSTGRES.LOG_HMAC_SECRET);
    expect(errors).toEqual([]);
  });

  it("thiếu LOG_HMAC_SECRET → khởi động lỗi; log nêu tên biến", () => {
    const { LOG_HMAC_SECRET: _drop, ...rest } = POSTGRES;
    void _drop;
    expect(startupError(rest).message).toMatch(/LOG_HMAC_SECRET/);
    expect(errors).toHaveLength(1);
    expect(JSON.parse(errors[0])).toMatchObject({ level: "error", msg: "env_invalid", names: ["LOG_HMAC_SECRET"] });
  });

  it("giá trị sai (quá ngắn) → không in giá trị ra log hay thông báo lỗi; không lộ URL DB", () => {
    const err = startupError({ ...POSTGRES, LOG_HMAC_SECRET: "gia-tri-ngan-bi-mat", JWT_SECRET: "jwt-ngan" });
    const all = [err.message, ...errors].join("\n");
    expect(all).toMatch(/LOG_HMAC_SECRET/);
    expect(all).toMatch(/JWT_SECRET/);
    for (const v of ["gia-tri-ngan-bi-mat", "jwt-ngan", "matkhau-db", "db.example.com"]) expect(all).not.toContain(v);
    expect(JSON.parse(errors[0]).names).toEqual(["JWT_SECRET", "LOG_HMAC_SECRET"]);
  });

  it("Postgres thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CRON_SECRET → lỗi", () => {
    const { SUPABASE_URL: _a, SUPABASE_SERVICE_ROLE_KEY: _b, CRON_SECRET: _c, ...rest } = POSTGRES;
    void [_a, _b, _c];
    startupError(rest);
    expect(JSON.parse(errors[0]).names).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]);
  });

  it("pglite (dev cục bộ): chỉ cần DATABASE_URL + JWT_SECRET + LOG_HMAC_SECRET", () => {
    expect(() => checkEnvOnStartup(PGLITE)).not.toThrow();
  });

  it("pglite thiếu LOG_HMAC_SECRET → vẫn lỗi khởi động", () => {
    const { LOG_HMAC_SECRET: _drop, ...rest } = PGLITE;
    void _drop;
    startupError(rest);
    expect(JSON.parse(errors[0]).names).toEqual(["LOG_HMAC_SECRET"]);
  });
});
