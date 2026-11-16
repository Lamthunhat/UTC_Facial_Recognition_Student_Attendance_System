import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // "server-only" chỉ có nghĩa trong Next.js; trong test thay bằng module rỗng.
    alias: { "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Dữ liệu đọc thẻ (OCR vie, wasm zxing) ở thư mục cố định như lúc chạy thật — chép + kiểm sha256 trước khi test
    globalSetup: ["./tests/support/card-assets-setup.ts"],
    env: { CARD_ASSETS_DIR: fileURLToPath(new URL("../../apps/web/card-assets", import.meta.url)) },
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
