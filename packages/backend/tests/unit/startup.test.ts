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

  describe("SUPABASE_URL phải là origin thuần (https, không path, không '/' cuối)", () => {
    for (const [bad, why] of [
      ["https://abcd1234.supabase.co/rest/v1", "có path /rest/v1"],
      ["https://abcd1234.supabase.co/", "có '/' cuối"],
      ["http://abcd1234.supabase.co", "http (không phải localhost)"],
      ["https://abcd1234.supabase.co?x=1", "có query"],
    ] as const) {
      it(`${why} → env_invalid SUPABASE_URL, gợi ý bỏ "/rest/v1", không in giá trị`, () => {
        const err = startupError({ ...POSTGRES, SUPABASE_URL: bad });
        expect(JSON.parse(errors[0])).toMatchObject({ msg: "env_invalid", names: ["SUPABASE_URL"] });
        expect(err.message).toMatch(/origin/);
        expect(err.message).toMatch(/\/rest\/v1/);
        expect(err.message).not.toContain("abcd1234");
      });
    }

    it("hợp lệ: https://<ref>.supabase.co; http chỉ cho localhost / 127.0.0.1 (Supabase CLI)", () => {
      expect(() => checkEnvOnStartup({ ...POSTGRES, SUPABASE_URL: "https://abcd1234.supabase.co" })).not.toThrow();
      expect(() => checkEnvOnStartup({ ...POSTGRES, SUPABASE_URL: "http://127.0.0.1:54321" })).not.toThrow();
      expect(() => checkEnvOnStartup({ ...POSTGRES, SUPABASE_URL: "http://localhost:54321" })).not.toThrow();
    });
  });

  it("pglite (dev cục bộ): chỉ cần DATABASE_URL + JWT_SECRET + LOG_HMAC_SECRET", () => {
    expect(() => checkEnvOnStartup(PGLITE)).not.toThrow();
  });

  it("pglite trên Vercel (VERCEL=1) → env_invalid, tên DATABASE_URL", () => {
    expect(startupError({ ...PGLITE, VERCEL: "1" }).message).toMatch(/DATABASE_URL/);
    expect(JSON.parse(errors[0])).toMatchObject({ msg: "env_invalid", names: ["DATABASE_URL"] });
  });

  it("pglite với NODE_ENV=production (không ALLOW_LOCAL_PGLITE) → env_invalid, tên DATABASE_URL", () => {
    startupError({ ...PGLITE, NODE_ENV: "production" });
    expect(JSON.parse(errors[0]).names).toEqual(["DATABASE_URL"]);
    startupError({ ...PGLITE, NODE_ENV: "production", ALLOW_LOCAL_PGLITE: "true" }); // chỉ đúng "1" mới mở
    expect(JSON.parse(errors[1]).names).toEqual(["DATABASE_URL"]);
  });

  describe("ALLOW_LOCAL_PGLITE=1", () => {
    let warns: string[] = [];
    beforeEach(() => {
      warns = [];
      vi.stubEnv("NODE_ENV", "development"); // log bỏ qua warn khi NODE_ENV của tiến trình test là "test"
      vi.spyOn(console, "warn").mockImplementation((line: string) => void warns.push(String(line)));
    });
    afterEach(() => vi.unstubAllEnvs());

    it("NODE_ENV=production + pglite → cho phép (next start cục bộ), log warn pglite_production_local", () => {
      expect(() => checkEnvOnStartup({ ...PGLITE, NODE_ENV: "production", ALLOW_LOCAL_PGLITE: "1" })).not.toThrow();
      expect(errors).toEqual([]);
      expect(warns).toHaveLength(1);
      expect(JSON.parse(warns[0])).toMatchObject({ level: "warn", msg: "pglite_production_local" });
    });

    it("VERCEL=1 + pglite → VẪN chặn, kể cả có ALLOW_LOCAL_PGLITE=1", () => {
      startupError({ ...PGLITE, NODE_ENV: "production", VERCEL: "1", ALLOW_LOCAL_PGLITE: "1" });
      expect(JSON.parse(errors[0])).toMatchObject({ msg: "env_invalid", names: ["DATABASE_URL"] });
      expect(warns).toEqual([]);
    });

    it("dev/test hay Postgres → không warn", () => {
      checkEnvOnStartup({ ...PGLITE, NODE_ENV: "development", ALLOW_LOCAL_PGLITE: "1" });
      checkEnvOnStartup({ ...POSTGRES, NODE_ENV: "production", ALLOW_LOCAL_PGLITE: "1" });
      expect(warns).toEqual([]);
    });
  });

  it("pglite production còn thiếu biến khác → báo cả DATABASE_URL lẫn biến thiếu", () => {
    const { LOG_HMAC_SECRET: _drop, ...rest } = PGLITE;
    void _drop;
    startupError({ ...rest, VERCEL: "1" });
    expect(JSON.parse(errors[0]).names).toEqual(["DATABASE_URL", "LOG_HMAC_SECRET"]);
  });

  it("Postgres trên Vercel/production → hợp lệ; pglite ở development/test → hợp lệ", () => {
    expect(() => checkEnvOnStartup({ ...POSTGRES, VERCEL: "1", NODE_ENV: "production" })).not.toThrow();
    expect(() => checkEnvOnStartup({ ...PGLITE, NODE_ENV: "development" })).not.toThrow();
    expect(() => checkEnvOnStartup({ ...PGLITE, NODE_ENV: "test", VERCEL: "0" })).not.toThrow();
  });

  it("pglite thiếu LOG_HMAC_SECRET → vẫn lỗi khởi động", () => {
    const { LOG_HMAC_SECRET: _drop, ...rest } = PGLITE;
    void _drop;
    startupError(rest);
    expect(JSON.parse(errors[0]).names).toEqual(["LOG_HMAC_SECRET"]);
  });
});
