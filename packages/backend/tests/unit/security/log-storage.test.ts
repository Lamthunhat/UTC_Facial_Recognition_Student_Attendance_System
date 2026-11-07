import { describe, expect, it } from "vitest";
import { assertSafePath } from "../../../src/evidence/storage";
import { redact } from "../../../src/log";

describe("redact log (T030)", () => {
  it("che mật khẩu, token, vector, nhị phân", () => {
    const out = redact({
      email: "a@b.vn",
      password: "123",
      nested: { authorization: "Bearer x", embedding: Array.from({ length: 512 }, () => 0.1) },
      image: new Uint8Array(10),
      frames: ["a"],
      SUPABASE_SERVICE_ROLE_KEY: "k",
    }) as Record<string, unknown>;
    expect(out.email).toBe("a@b.vn");
    expect(out.password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).authorization).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).embedding).toBe("[redacted]");
    expect(out.image).toBe("[redacted]");
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe("[redacted]");
  });
  it("vector số dài không có tên nhạy cảm vẫn bị rút gọn", () => {
    expect(redact({ v: Array.from({ length: 100 }, () => 1) })).toEqual({ v: "[vector 100]" });
  });
});

describe("đường dẫn lưu trữ an toàn (T034)", () => {
  it.each(["2026/11/abc.jpg", "cards/uuid-1.jpg"])("chấp nhận %s", (p) => expect(() => assertSafePath(p)).not.toThrow());
  it.each(["../x", "a/../b", "/abs", "a//b", "a b.jpg", "a\\b"])("từ chối %j", (p) => expect(() => assertSafePath(p)).toThrow());
});
