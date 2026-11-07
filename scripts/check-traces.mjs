// Kiểm tra file trace (.nft.json) của `next build`: function nào cần file nạp lúc chạy thì phải có đủ trong trace,
// vì Vercel đóng gói function theo đúng danh sách này. Chạy sau `pnpm build`:
//   node scripts/check-traces.mjs
// Exit 1 nếu thiếu (dùng được trong CI). Binary native (onnxruntime/sharp) phụ thuộc hệ điều hành của máy build
// nên chỉ kiểm khi build trên Linux.
import { readFileSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "../apps/web");
const REQUIRED = {
  "api/student/card": [
    ["zxing_reader.wasm", /zxing-wasm\/dist\/reader\/zxing_reader\.wasm$/],
    ["tesseract worker (node)", /tesseract\.js\/src\/worker-script\/node\/index\.js$/],
    ["tesseract-core *-lstm.wasm", /tesseract\.js-core\/tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm$/],
    ["tesseract-core *-lstm.js", /tesseract\.js-core\/tesseract-core(-simd|-relaxedsimd)?-lstm\.js$/],
    ["dữ liệu OCR vie (best_int)", /vie\/4\.0\.0_best_int\/vie\.traineddata\.gz$/],
    ["model det_500m.onnx", /models\/det_500m\.onnx$/],
    ["model w600k_mbf.onnx", /models\/w600k_mbf\.onnx$/],
    ...(process.platform === "linux"
      ? [
          ["onnxruntime linux-x64", /onnxruntime-node\/bin\/napi-v\d+\/linux\/x64\/onnxruntime_binding\.node$/],
          ["sharp linux-x64", /@img\/sharp-linux-x64\//],
        ]
      : []),
  ],
};

let missing = 0;
for (const [route, checks] of Object.entries(REQUIRED)) {
  const nft = path.join(APP, ".next/server/app", route, "route.js.nft.json");
  const files = JSON.parse(readFileSync(nft, "utf8")).files.map((f) => f.replace(/\\/g, "/"));
  console.log(`/${route} (${files.length} file trong trace)`);
  for (const [label, re] of checks) {
    const n = files.filter((f) => re.test(f)).length;
    if (!n) missing++;
    console.log(`  ${n ? "CÓ   " : "THIẾU"} ${label}${n > 1 ? ` (${n})` : ""}`);
  }
}
if (missing) {
  console.error(`\nThiếu ${missing} file — function sẽ lỗi khi chạy trên Vercel.`);
  process.exit(1);
}
console.log("\nĐủ file.");
