import { afterEach, describe, expect, it } from "vitest";
import { anthropicApiKey, goongApiKey, parseEnv } from "../../src/env";

/** Biến môi trường: GOONG_API_KEY / ANTHROPIC_API_KEY là tuỳ chọn, chỉ báo "chưa cấu hình" khi tính năng cần tới. */
const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/x",
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
  JWT_SECRET: "j".repeat(40),
  CRON_SECRET: "c".repeat(32),
  LOG_HMAC_SECRET: "l".repeat(40),
};

describe("parseEnv", () => {
  it("không có GOONG_API_KEY / ANTHROPIC_API_KEY vẫn hợp lệ (tính năng chưa dùng)", () => {
    const r = parseEnv(BASE);
    expect(r.GOONG_API_KEY).toBeUndefined();
    expect(r.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.DUPLICATE_ABOVE).toBe(0.45);
  });

  it("chuỗi rỗng coi như chưa cấu hình", () => {
    expect(parseEnv({ ...BASE, GOONG_API_KEY: "", ANTHROPIC_API_KEY: "  " }).GOONG_API_KEY).toBeUndefined();
  });

  it("LOG_HMAC_SECRET bắt buộc, ≥ 32 ký tự (không in giá trị)", () => {
    const { LOG_HMAC_SECRET: _drop, ...rest } = BASE;
    void _drop;
    expect(() => parseEnv(rest)).toThrow(/LOG_HMAC_SECRET/);
    let msg = "";
    try {
      parseEnv({ ...BASE, LOG_HMAC_SECRET: "ngan-qua" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/LOG_HMAC_SECRET/);
    expect(msg).not.toContain("ngan-qua");
  });

  it("thiếu biến bắt buộc → lỗi chỉ nêu TÊN biến, không in giá trị", () => {
    const { JWT_SECRET: _drop, ...rest } = BASE;
    void _drop;
    let msg = "";
    try {
      parseEnv({ ...rest, SUPABASE_SERVICE_ROLE_KEY: "ngan" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/JWT_SECRET/);
    expect(msg).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(msg).not.toContain("ngan");
    expect(msg).not.toContain("localhost:5432");
  });
});

describe("goongApiKey / anthropicApiKey — đọc khi dùng", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("chưa cấu hình → 503 NOT_CONFIGURED 'chưa cấu hình' (không lộ tên biến cho người dùng)", () => {
    delete process.env.GOONG_API_KEY;
    process.env.ANTHROPIC_API_KEY = "   ";
    for (const get of [goongApiKey, anthropicApiKey]) {
      let err: { status?: number; code?: string; message?: string } = {};
      try {
        get();
      } catch (e) {
        err = e as typeof err;
      }
      expect(err).toMatchObject({ status: 503, code: "NOT_CONFIGURED" });
      expect(err.message).toMatch(/chưa (được )?cấu hình/);
      expect(err.message).not.toMatch(/API_KEY/);
    }
  });

  it("đã cấu hình → trả giá trị (đã trim)", () => {
    process.env.GOONG_API_KEY = " khoa-goong ";
    process.env.ANTHROPIC_API_KEY = "khoa-anthropic";
    expect(goongApiKey()).toBe("khoa-goong");
    expect(anthropicApiKey()).toBe("khoa-anthropic");
  });
});
