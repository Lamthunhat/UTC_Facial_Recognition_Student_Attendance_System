import { existsSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * File nạp bằng đường dẫn lúc chạy cho đọc thẻ (T057) — trình trace không tự thấy, phải include thủ công.
 * Phân giải ĐƯỜNG DẪN THẬT ngay lúc build (không dùng glob có ký tự đại diện): glob kiểu
 * `node_modules/.pnpm/zxing-wasm@*` quét thư mục .pnpm song song cho mọi route và từng cho kết quả
 * lúc có lúc không (đã đo bằng .nft.json qua nhiều lần build sạch). Thiếu file → build lỗi ngay, không im lặng.
 */
const requireFromApp = createRequire(path.join(__dirname, "package.json"));
function cardRuntimeFiles(): string[] {
  const real = (p: string) => realpathSync(p);
  const zxingWasm = real(requireFromApp.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  const vieData = path.join(path.dirname(real(requireFromApp.resolve("@tesseract.js-data/vie/package.json"))), "4.0.0_best_int", "vie.traineddata.gz");
  // tesseract.js-core là phụ thuộc của tesseract.js → phân giải từ thư mục thật của tesseract.js
  const requireFromTesseract = createRequire(real(requireFromApp.resolve("tesseract.js/package.json")));
  const coreDir = path.dirname(real(requireFromTesseract.resolve("tesseract.js-core/package.json")));
  // OEM 1 (LSTM) → chỉ các bản *-lstm.wasm (thường / simd / relaxedsimd tuỳ CPU)
  const coreWasm = readdirSync(coreDir).filter((f) => f.endsWith("-lstm.wasm")).map((f) => path.join(coreDir, f));
  const files = [zxingWasm, vieData, ...coreWasm];
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length || coreWasm.length === 0) throw new Error(`Thiếu file chạy đọc thẻ: ${missing.join(", ") || "tesseract-core *-lstm.wasm"}`);
  // Glob của Next tính tương đối từ thư mục app, dùng dấu "/"
  return files.map((f) => path.relative(__dirname, f).split(path.sep).join("/"));
}

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
    // Đọc thẻ (T057): wasm zxing + wasm tesseract-core + dữ liệu OCR tiếng Việt (bản 4.0.0_best_int).
    // Worker + core *.js được trace tự động. Khoá so với tên route nội bộ "/app/api/student/card" (picomatch, contains).
    // Kiểm sau khi build: scripts/check-traces.mjs.
    "/api/student/card": cardRuntimeFiles(),
  },
  outputFileTracingExcludes: {
    "*": OTHER_PLATFORM_BINARIES,
  },
};

export default nextConfig;
