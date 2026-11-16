import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Test logic phía client (thuần, không DOM): src/lib/**; middleware + next.config (node). */
export default defineConfig({
  // tsconfig của Next dùng jsx "preserve"; test server component (.tsx) cần biến đổi JSX
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" chỉ có nghĩa trong Next.js; test middleware/backend → module rỗng (giống packages/backend)
      "server-only": fileURLToPath(new URL("../../packages/backend/tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"] },
});
