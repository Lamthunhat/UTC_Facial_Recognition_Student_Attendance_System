import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Test logic phía client (thuần, không DOM): src/lib/**. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"] },
});
