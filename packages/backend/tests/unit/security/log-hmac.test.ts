import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logFingerprint } from "../../../src/security/log-hmac";

/**
 * HMAC ghi nhật ký (security_events) dùng khoá riêng LOG_HMAC_SECRET, tách khỏi JWT_SECRET:
 * xoay khoá phiên (JWT_SECRET) không làm đứt chuỗi liên kết các lần dò cùng một mã SV trong log, và lộ khoá log
 * không cho phép giả mạo phiên.
 */
const saved = { ...process.env };
const LOG_KEY = "l".repeat(40);

beforeEach(() => {
  process.env.LOG_HMAC_SECRET = LOG_KEY;
  process.env.JWT_SECRET = "j".repeat(40);
});
afterEach(() => {
  process.env = { ...saved };
});

describe("logFingerprint", () => {
  it("đổi JWT_SECRET KHÔNG làm đổi HMAC", () => {
    const a = logFingerprint("student-login", "231230801");
    process.env.JWT_SECRET = "k".repeat(40);
    expect(logFingerprint("student-login", "231230801")).toBe(a);
  });

  it("đổi LOG_HMAC_SECRET làm đổi HMAC (khoá thật sự được dùng)", () => {
    const a = logFingerprint("student-login", "231230801");
    process.env.LOG_HMAC_SECRET = "m".repeat(40);
    expect(logFingerprint("student-login", "231230801")).not.toBe(a);
  });

  it("= HMAC-SHA256(LOG_HMAC_SECRET, '<mục đích>:<giá trị>'), 16 ký tự hex, không chứa giá trị gốc", () => {
    const fp = logFingerprint("student-login", "231230801");
    expect(fp).toBe(createHmac("sha256", LOG_KEY).update("student-login:231230801").digest("hex").slice(0, 16));
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fp).not.toContain("231230801");
  });

  it("mục đích khác nhau → HMAC khác nhau", () => {
    expect(logFingerprint("student-login", "x")).not.toBe(logFingerprint("other", "x"));
  });

  it("thiếu hoặc < 32 ký tự → lỗi chỉ nêu tên biến, không rơi về khoá mặc định", () => {
    for (const v of [undefined, "", "ngan-qua"]) {
      if (v === undefined) delete process.env.LOG_HMAC_SECRET;
      else process.env.LOG_HMAC_SECRET = v;
      let msg = "";
      try {
        logFingerprint("student-login", "231230801");
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/LOG_HMAC_SECRET/);
      if (v) expect(msg).not.toContain(v);
    }
  });
});
