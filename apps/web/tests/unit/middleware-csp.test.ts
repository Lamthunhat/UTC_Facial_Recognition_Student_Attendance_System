import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@utc/backend/auth/cookie";
import { signSession } from "@utc/backend/auth/jwt";
import { middleware } from "@/middleware";
import nextConfig from "../../next.config";

/**
 * CSP theo route: 'wasm-unsafe-eval' (MediaPipe ở trình duyệt) CHỈ ở route nhận diện mặt; route khác giữ CSP cũ.
 * Chạy middleware thật với cookie phiên SV hợp lệ (để vào được khu /sv/*).
 */
const SECRET = "middleware-test-secret-middleware-test-xx";
let studentCookie = "";

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  const token = await signSession({ sub: randomUUID(), role: "student", sid: "s1" }, { ttlSeconds: 600 });
  studentCookie = `${SESSION_COOKIE}=${token}`;
});

async function cspOf(path: string) {
  const res = await middleware(new NextRequest(`http://localhost${path}`, { headers: { cookie: studentCookie } }));
  expect(res.status, path).toBeLessThan(300); // không bị chuyển hướng đăng nhập
  return res.headers.get("content-security-policy") ?? "";
}

describe("middleware — CSP theo route", () => {
  it("/sv/the-sinh-vien và /sv/the-sinh-vien/debug: có 'wasm-unsafe-eval'", async () => {
    expect(await cspOf("/sv/the-sinh-vien")).toContain("'wasm-unsafe-eval'");
    expect(await cspOf("/sv/the-sinh-vien/debug")).toContain("'wasm-unsafe-eval'");
  });

  it("route khác: CSP cũ, không 'wasm-unsafe-eval'", async () => {
    for (const p of ["/sv/lop", "/sv/dong-y", "/sv", "/"]) {
      const csp = await cspOf(p);
      expect(csp, p).toContain("script-src 'self' 'nonce-");
      expect(csp, p).not.toContain("wasm-unsafe-eval");
    }
  });
});

describe("next.config — cache tài nguyên MediaPipe (tên file có phiên bản/hash)", () => {
  it("/mediapipe/* → Cache-Control: public, max-age=31536000, immutable", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const mp = rules.find((r) => r.source === "/mediapipe/:path*");
    expect(mp?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });
});
