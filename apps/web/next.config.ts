import path from "node:path";
import type { NextConfig } from "next";

/**
 * - Monorepo: biên dịch trực tiếp mã TypeScript của các package nội bộ (@utc/*).
 * - Gói native (onnxruntime, sharp, argon2) và wasm (zxing) chạy ở server, không bundle bằng webpack.
 * - Đính kèm model ONNX vào function; loại binary của hệ điều hành khác để function
 *   Linux x64 trên Vercel nằm dưới giới hạn 250 MB (research.md R1).
 */
const OTHER_PLATFORM_BINARIES = [
  "**/node_modules/**/onnxruntime-node/bin/napi-v*/darwin/**",
  "**/node_modules/**/onnxruntime-node/bin/napi-v*/win32/**",
  "**/node_modules/**/onnxruntime-node/bin/napi-v*/linux/arm64/**",
  // Vercel chạy glibc → không cần bản musl của libvips
  "**/node_modules/**/@img/sharp-libvips-linuxmusl-*/**",
  "**/node_modules/**/@img/sharp-linuxmusl-*/**",
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@utc/backend", "@utc/database", "@utc/shared"],
  serverExternalPackages: [
    "onnxruntime-node",
    "sharp",
    "zxing-wasm",
    "tesseract.js",
    "@node-rs/argon2",
    "@electric-sql/pglite",
    "@electric-sql/pglite-pgvector",
  ],
  // Gốc monorepo để Vercel đóng gói được mã trong packages/*
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/api/**": ["./models/*.onnx", "./public/fonts/*.ttf"],
    // Đọc thẻ (T057): wasm + worker + dữ liệu OCR được nạp bằng đường dẫn lúc chạy nên trình trace không tự thấy.
    // Chỉ bản 4.0.0_best_int (~2,6 MB) của dữ liệu tiếng Việt.
    "/api/student/card": [
      "./node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
      "./node_modules/tesseract.js/src/worker-script/node/**",
      "./node_modules/@tesseract.js-data/vie/4.0.0_best_int/*",
      "../../node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core/*.{js,wasm}",
    ],
  },
  outputFileTracingExcludes: {
    "*": OTHER_PLATFORM_BINARIES,
  },
};

export default nextConfig;
