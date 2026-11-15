// Chép dữ liệu đọc thẻ dùng LÚC CHẠY vào thư mục cố định apps/web/card-assets/ (gitignore), kiểm sha256 đã ghim.
// Code chạy (packages/backend/src/card/assets.ts) chỉ đọc theo đường dẫn <cwd>/card-assets — KHÔNG phân giải
// package.json lúc chạy: function Vercel chỉ chứa file có trong trace, package.json của gói không được import
// (vd. @tesseract.js-data/vie) không có trong đó → "Cannot find module …/package.json".
// Chạy tự động trước `next dev` / `next build` (apps/web/package.json) và trước test backend.
//   node scripts/card-assets.mjs            → chép vào apps/web/card-assets
// Đổi phiên bản gói → sha256 khác → lỗi: kiểm file mới rồi cập nhật sha256 dưới đây.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Phân giải lúc BUILD (máy build có đủ node_modules) — không bao giờ lúc chạy. */
export const CARD_ASSETS = [
  {
    name: "vie.traineddata.gz",
    // @tesseract.js-data/vie 1.0.0 — bản 4.0.0_best_int (research R3)
    source: (req) => path.join(path.dirname(req.resolve("@tesseract.js-data/vie/package.json")), "4.0.0_best_int", "vie.traineddata.gz"),
    sha256: "2284f610f262a1b19ec8df9f196b9ff6ce38ddb4a66329e998941df4b8961c8d",
  },
  {
    name: "zxing_reader.wasm",
    // zxing-wasm 3.1.6
    source: (req) => req.resolve("zxing-wasm/reader/zxing_reader.wasm"),
    sha256: "5003fb4b88c4fbd1fd518a2fd8c8ad365c519e183a08c03a322dddfea3cea84e",
  },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Chép + kiểm. Trả danh sách {name, path}. Nguồn sai sha256 → lỗi, không chép gì của file đó. */
export async function prepareCardAssets({ appDir, outDir = path.join(appDir, "card-assets"), assets = CARD_ASSETS }) {
  const req = createRequire(path.join(appDir, "package.json"));
  await mkdir(outDir, { recursive: true });
  const done = [];
  for (const a of assets) {
    const src = a.source(req);
    const got = sha256(await readFile(src));
    if (got !== a.sha256) {
      throw new Error(`${a.name}: sha256 của nguồn (${src}) là ${got}, khác bản ghim ${a.sha256} — gói đã đổi phiên bản? Kiểm rồi cập nhật scripts/card-assets.mjs.`);
    }
    const dest = path.join(outDir, a.name);
    const current = await readFile(dest).then(sha256, () => null);
    if (current !== a.sha256) {
      await copyFile(src, dest);
      if (sha256(await readFile(dest)) !== a.sha256) throw new Error(`${a.name}: chép xong nhưng sha256 không khớp`);
    }
    done.push({ name: a.name, path: dest });
  }
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web");
  prepareCardAssets({ appDir })
    .then((r) => console.log(`card-assets: ${r.map((x) => x.name).join(", ")} (sha256 đã kiểm)`))
    .catch((e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    });
}
