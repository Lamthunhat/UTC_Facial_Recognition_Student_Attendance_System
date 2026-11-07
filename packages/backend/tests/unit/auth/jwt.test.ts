import { beforeAll, describe, expect, it } from "vitest";
import { signSession, verifySession, type SessionClaims } from "../../../src/auth/jwt";

const SECRET = "test-secret-test-secret-test-secret-1234";

describe("JWT phiên đăng nhập (T016)", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  const student: SessionClaims = { sub: "11111111-1111-4111-8111-111111111111", role: "student", sid: "s1" };

  it("phát hành và xác minh được", async () => {
    const token = await signSession(student, { ttlSeconds: 60 });
    const claims = await verifySession(token);
    expect(claims).toMatchObject({ sub: student.sub, role: "student", sid: "s1" });
  });

  it("từ chối token hết hạn", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signSession(student, { ttlSeconds: 60, now: now - 3600 });
    await expect(verifySession(token)).resolves.toBeNull();
  });

  it("từ chối token ký bằng khoá khác", async () => {
    const token = await signSession(student, { ttlSeconds: 60, secret: "another-secret-another-secret-123456" });
    await expect(verifySession(token)).resolves.toBeNull();
  });

  it("từ chối token bị sửa nội dung", async () => {
    const token = await signSession(student, { ttlSeconds: 60 });
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...student, role: "admin" })).toString("base64url");
    await expect(verifySession(`${h}.${forged}.${s}`)).resolves.toBeNull();
  });

  it("từ chối vai trò không hợp lệ", async () => {
    // @ts-expect-error cố ý truyền vai trò sai
    await expect(signSession({ ...student, role: "root" }, { ttlSeconds: 60 })).rejects.toThrow();
  });

  it("thu hồi theo sid qua hàm kiểm tra truyền vào", async () => {
    const token = await signSession(student, { ttlSeconds: 60 });
    await expect(verifySession(token, { isRevoked: async (sid) => sid === "s1" })).resolves.toBeNull();
    await expect(verifySession(token, { isRevoked: async () => false })).resolves.not.toBeNull();
  });
});
