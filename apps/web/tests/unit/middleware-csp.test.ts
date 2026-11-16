import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@utc/backend/auth/cookie";
import { signSession } from "@utc/backend/auth/jwt";
import { middleware } from "@/middleware";
import nextConfig from "../../next.config";

/**
 * CSP theo khu: 'wasm-unsafe-eval' (MediaPipe ở trình duyệt) cho TOÀN KHU SV /sv/*; /sv (đăng nhập), /gv, /admin, /login, /api giữ CSP chặt.
 * Chạy middleware thật với cookie phiên SV hợp lệ (để vào được khu /sv/*).
 */
const SRC = join(__dirname, "../../src");
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

describe("middleware — CSP theo khu", () => {
  it("toàn khu SV /sv/*: có 'wasm-unsafe-eval' (next/link giữa các trang SV vẫn chạy được MediaPipe)", async () => {
    for (const p of ["/sv/lop", "/sv/dong-y", "/sv/the-sinh-vien", "/sv/the-sinh-vien/debug"]) {
      expect(await cspOf(p), p).toContain("'wasm-unsafe-eval'");
    }
  });

  it("/sv (đăng nhập SV), /login, /, /api: CSP chặt, không 'wasm-unsafe-eval'", async () => {
    for (const p of ["/sv", "/login", "/", "/api/student/card"]) {
      const csp = await cspOf(p);
      expect(csp, p).toContain("script-src 'self' 'nonce-");
      expect(csp, p).not.toContain("wasm-unsafe-eval");
    }
  });

  it("khu GV / Admin: CSP chặt", async () => {
    const staff = async (role: "instructor" | "admin", path: string) => {
      const token = await signSession({ sub: randomUUID(), role, sid: "s2" }, { ttlSeconds: 600 });
      const res = await middleware(new NextRequest(`http://localhost${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
      expect(res.status, path).toBeLessThan(300);
      return res.headers.get("content-security-policy") ?? "";
    };
    expect(await staff("instructor", "/gv/lop")).not.toContain("wasm-unsafe-eval");
    expect(await staff("admin", "/admin")).not.toContain("wasm-unsafe-eval");
  });
});

describe("khu SV không còn AppLink / useAppNavigate (CSP cùng một chính sách → next/link bình thường)", () => {
  it("không file nào trong src import @/components/app-link hay lib/csp-navigation", () => {
    const hits = readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(tsx?|mts)$/.test(d.name))
      .map((d) => join(d.parentPath, d.name))
      .filter((f) => /app-link|csp-navigation/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
    expect(existsSync(join(SRC, "components/app-link.tsx"))).toBe(false);
  });
});

describe("next.config — cache tài nguyên MediaPipe (tên file có phiên bản/hash)", () => {
  it("/mediapipe/* → Cache-Control: public, max-age=31536000, immutable", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const mp = rules.find((r) => r.source === "/mediapipe/:path*");
    expect(mp?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });
});
