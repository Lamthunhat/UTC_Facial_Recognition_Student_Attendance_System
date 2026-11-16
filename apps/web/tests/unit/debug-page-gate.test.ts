import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Trang chẩn đoán /sv/the-sinh-vien/debug — CHỈ preview/dev (cùng điều kiện yawDebugEnabled của API liveness-probe).
 * Production → notFound() (404), không render gì. Phần giao diện client được thay bằng bản rỗng (không cần DOM).
 */
vi.mock("@/app/sv/the-sinh-vien/debug/camera-debug", () => ({ CameraDebug: () => null }));

const isNotFound = (e: unknown) => String((e as { digest?: string })?.digest ?? "").includes("404");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function render() {
  const { default: Page } = await import("@/app/sv/the-sinh-vien/debug/page");
  return Page();
}

describe("trang chẩn đoán chỉ ở preview/dev", () => {
  it.each([
    ["Vercel production", { VERCEL: "1", VERCEL_ENV: "production" }],
    ["Vercel thiếu VERCEL_ENV", { VERCEL: "1", VERCEL_ENV: undefined }],
    ["next start cục bộ (NODE_ENV=production)", { VERCEL: undefined, VERCEL_ENV: undefined, NODE_ENV: "production" }],
  ])("%s → notFound (404)", async (_n, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string | undefined);
    let thrown: unknown = null;
    try {
      await render();
    } catch (e) {
      thrown = e;
    }
    expect(isNotFound(thrown), String(thrown)).toBe(true);
  });

  it.each([
    ["Vercel preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ["pnpm dev", { VERCEL: undefined, VERCEL_ENV: undefined, NODE_ENV: "development" }],
  ])("%s → render trang", async (_n, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string | undefined);
    expect(await render()).toBeTruthy();
  });
});
