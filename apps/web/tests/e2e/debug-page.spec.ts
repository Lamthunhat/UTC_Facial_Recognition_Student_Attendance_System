import { expect, test } from "@playwright/test";
import { studentToken } from "./support";

/**
 * /sv/the-sinh-vien/debug CHỈ preview/dev. Chạy với bản build production (next start: NODE_ENV=production, không
 * VERCEL_ENV → yawDebugEnabled() = false) — xem hướng dẫn chạy ở csp-wasm.spec.ts:
 *   E2E_BASE_URL=http://localhost:3100 pnpm --filter @utc/web exec playwright test debug-page
 * SV đã đăng nhập (JWT hợp lệ — middleware cho qua) vẫn nhận 404; trang thẻ sinh viên bình thường vẫn 200 (đối chứng).
 */
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ cookie: `__Host-session=${studentToken()}` });
});

test("production: SV đã đăng nhập mở /sv/the-sinh-vien/debug → 404", async ({ page }) => {
  const res = await page.goto("/sv/the-sinh-vien/debug");
  expect(page.url()).toContain("/sv/the-sinh-vien/debug"); // không bị đẩy về đăng nhập → đúng là đã qua middleware
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Thử liveness")).toHaveCount(0);
});

test("đối chứng: /sv/the-sinh-vien vẫn 200 với cùng phiên", async ({ page }) => {
  await page.route("**/api/student/card", (r) => r.fulfill({ json: { card: null } }));
  const res = await page.goto("/sv/the-sinh-vien");
  expect(res?.status()).toBe(200);
});
