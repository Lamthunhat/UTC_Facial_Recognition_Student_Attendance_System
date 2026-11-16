import { expect, test, type Page } from "@playwright/test";
import { studentToken } from "./support";

/**
 * CSP theo khu (headers.ts needsWasm): 'wasm-unsafe-eval' cho TOÀN KHU SV /sv/*. CSP gắn với DOCUMENT → điều hướng phía
 * client bằng next/link từ /sv/lop sang /sv/thẻ-sinh-viên phải giữ được quyền biên dịch WebAssembly (MediaPipe).
 *
 * PHẢI chạy với bản build production (`next dev` thêm 'unsafe-eval' nên không phân biệt được):
 *   pnpm build && ALLOW_LOCAL_PGLITE=1 pnpm --filter @utc/web exec next start -p 3100
 *   E2E_BASE_URL=http://localhost:3100 pnpm --filter @utc/web exec playwright test csp-wasm
 * JWT_SECRET đọc từ biến môi trường hoặc apps/web/.env.local (không in ra). API SV được giả lập bằng page.route — middleware
 * chỉ kiểm chữ ký JWT, không cần DB.
 */
const WASM_URL = "/mediapipe/tasks-vision-1.2.0/vision_wasm_internal.wasm";

/** Biên dịch wasm MediaPipe tự host trong document hiện tại → "ok" hoặc tên lỗi (CSP chặn → CompileError/EvalError). */
const compileWasm = (page: Page) =>
  page.evaluate(async (url) => {
    try {
      const bytes = await (await fetch(url)).arrayBuffer();
      await WebAssembly.compile(bytes);
      return "ok";
    } catch (e) {
      return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }, WASM_URL);

test.beforeEach(async ({ context }) => {
  // Cookie __Host- (Secure) không đặt được qua CDP trên http://localhost → gửi thẳng header cookie cho mọi request
  await context.setExtraHTTPHeaders({ cookie: `__Host-session=${studentToken()}` });
  await context.route("**/api/student/classes", (r) => r.fulfill({ json: { classes: [] } }));
  await context.route("**/api/student/card", (r) => r.fulfill({ json: { card: null } }));
});

test("next/link /sv/lop → /sv/the-sinh-vien: không tải lại document, vẫn biên dịch được wasm MediaPipe", async ({ page }) => {
  const res = await page.goto("/sv/lop");
  expect(page.url()).toContain("/sv/lop"); // không bị đẩy về trang đăng nhập
  expect(res?.headers()["content-security-policy"]).toContain("'wasm-unsafe-eval'");
  await page.evaluate(() => ((window as unknown as { __sameDoc: number }).__sameDoc = 1));

  await page.getByRole("link", { name: "Thẻ sinh viên" }).first().click();
  await page.waitForURL("**/sv/the-sinh-vien");
  await expect(page.getByRole("heading", { name: "Thẻ sinh viên" })).toBeVisible();
  // Cùng document (next/link điều hướng phía client) — CSP vẫn là của /sv/lop
  expect(await page.evaluate(() => (window as unknown as { __sameDoc?: number }).__sameDoc)).toBe(1);
  expect(await compileWasm(page)).toBe("ok");
});

test("đối chứng: /login (CSP chặt) chặn biên dịch wasm — chứng tỏ phép thử trên thực sự kiểm CSP", async ({ page }) => {
  const res = await page.goto("/login");
  expect(res?.headers()["content-security-policy"]).not.toContain("wasm-unsafe-eval");
  expect(await compileWasm(page)).not.toBe("ok");
});
