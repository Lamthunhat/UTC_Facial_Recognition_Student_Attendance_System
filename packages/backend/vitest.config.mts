import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { ensureFontconfig } from "./src/evidence/fontconfig";

// Vẽ chữ lên ảnh bằng chứng (sharp/Pango): cấu hình fontconfig không cache, đặt TRƯỚC khi tạo worker để mọi tiến trình
// test thừa hưởng (trên Windows đặt biến bên trong worker không có hiệu lực) — xem src/evidence/fontconfig.ts.
ensureFontconfig(fileURLToPath(new URL("../../apps/web/public/fonts", import.meta.url)));

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
