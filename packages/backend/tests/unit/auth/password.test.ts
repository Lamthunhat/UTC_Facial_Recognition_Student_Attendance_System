import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/auth/password";

describe("argon2id (T026)", () => {
  it("băm và xác minh đúng/sai", async () => {
    const h = await hashPassword("mat-khau-du-dai");
    expect(h.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(h, "mat-khau-du-dai")).resolves.toBe(true);
    await expect(verifyPassword(h, "sai-mat-khau-123")).resolves.toBe(false);
  });
  it("từ chối mật khẩu quá ngắn", async () => {
    await expect(hashPassword("ngan")).rejects.toThrow();
  });
  it("hash hỏng trả false, không ném lỗi", async () => {
    await expect(verifyPassword("khong-phai-hash", "abc")).resolves.toBe(false);
  });
});
