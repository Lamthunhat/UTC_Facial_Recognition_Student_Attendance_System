import { describe, expect, it } from "vitest";
import { buildCsp, isCsrfSafe, needsWasm, securityHeaders } from "../../../src/security/headers";

describe("CSP (T028, FR-086)", () => {
  const csp = buildCsp({ nonce: "abc123", storageOrigin: "https://x.supabase.co" });
  it("chỉ cho script có nonce, không unsafe-inline/eval cho script", () => {
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    // 'unsafe-eval' (eval JS) và 'unsafe-inline' bị cấm; 'wasm-unsafe-eval' CHỈ cho biên dịch WebAssembly
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  });
  it("mặc định KHÔNG cho biên dịch WebAssembly", () => {
    expect(csp).not.toContain("wasm-unsafe-eval");
  });
  it("route nhận diện mặt: thêm 'wasm-unsafe-eval' (MediaPipe tự host), vẫn cấm unsafe-eval/inline", () => {
    const w = buildCsp({ nonce: "abc123", wasm: true });
    expect(w).toMatch(/script-src [^;]*'wasm-unsafe-eval'/);
    expect(w).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    // wasm + model tải từ chính origin (public/mediapipe) — không mở thêm nguồn ngoài
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/https:\/\/(cdn|storage\.googleapis)/);
  });
  it("chặn nhúng iframe, object, đổi base", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
  it("cho ảnh từ kho Supabase; production nâng cấp https", () => {
    expect(csp).toContain("img-src 'self' blob: data: https://x.supabase.co");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("dev cho phép eval + websocket (HMR)", () => {
    const dev = buildCsp({ nonce: "n", dev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self' ws: wss:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});

describe("header bảo mật (FR-088)", () => {
  it("đủ các header bắt buộc", () => {
    const h = securityHeaders();
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=63072000/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toContain("camera=(self)");
    expect(h["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(h["Permissions-Policy"]).toContain("microphone=()");
  });
  it("dev không gửi HSTS (localhost http)", () => {
    expect(securityHeaders({ dev: true })["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("chống CSRF (FR-087)", () => {
  const base = { expectedOrigin: "https://diemdanh.utc.edu.vn", secFetchSite: null, hasSessionCookie: true };
  it("GET luôn qua", () => expect(isCsrfSafe({ ...base, method: "GET", origin: "https://evil.com" })).toBe(true));
  it("POST cùng origin qua", () =>
    expect(isCsrfSafe({ ...base, method: "POST", origin: "https://diemdanh.utc.edu.vn" })).toBe(true));
  it("POST khác origin bị chặn", () =>
    expect(isCsrfSafe({ ...base, method: "POST", origin: "https://evil.com" })).toBe(false));
  it("POST thiếu Origin nhưng có cookie phiên bị chặn", () =>
    expect(isCsrfSafe({ ...base, method: "POST", origin: null })).toBe(false));
  it("POST thiếu Origin, không cookie (curl/cron) qua", () =>
    expect(isCsrfSafe({ ...base, method: "POST", origin: null, hasSessionCookie: false })).toBe(true));
  it("Sec-Fetch-Site cross-site bị chặn", () =>
    expect(
      isCsrfSafe({ ...base, method: "DELETE", origin: null, secFetchSite: "cross-site", hasSessionCookie: false }),
    ).toBe(false));
});

describe("needsWasm — route nào được biên dịch WebAssembly (nhận diện mặt ở trình duyệt)", () => {
  it("trang thẻ SV và trang chẩn đoán", () => {
    expect(needsWasm("/sv/the-sinh-vien")).toBe(true);
    expect(needsWasm("/sv/the-sinh-vien/debug")).toBe(true);
  });
  it("route khác giữ CSP cũ (kể cả tên gần giống)", () => {
    for (const p of ["/", "/sv", "/sv/lop", "/sv/dong-y", "/gv/lop", "/login", "/api/student/card", "/sv/the-sinh-vien-khac"]) {
      expect(needsWasm(p), p).toBe(false);
    }
  });
});
