import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    settings: { next: { rootDir: "apps/web/" } },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/next-env.d.ts",
      "**/models/**",
      ".specify/**",
      "specs/**",
      "_claude/**",
      ".claude/**",
      "supabase/**",
    ],
  },
  {
    rules: {
      // Constitution IX / FR-086: không render HTML từ dữ liệu người dùng
      "react/no-danger": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default eslintConfig;
