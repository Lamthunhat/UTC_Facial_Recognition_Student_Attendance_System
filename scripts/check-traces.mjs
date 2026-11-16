// Kiểm bản đóng gói function của `next build` — Vercel đóng gói function theo ĐÚNG danh sách file trong .nft.json.
// Chạy sau `pnpm build`:  node scripts/check-traces.mjs   (exit 1 nếu hỏng — dùng trong CI và buildCommand Vercel)
//  1. Có mặt: các file nạp lúc chạy phải có trong trace của route.
//  2. Không phân giải gói lúc chạy: mã server đã biên dịch không được nhắc tới gói dữ liệu không nằm trong trace
//     (lỗi đã gặp trên Vercel: "Cannot find module '@tesseract.js-data/vie/package.json'").
//  3. Chạy thử: dựng thư mục mô phỏng CHỈ chứa file trong trace (giữ nguyên cấu trúc, symlink/junction của pnpm),
//     rồi trong đó nạp tesseract.js + zxing-wasm bằng dữ liệu card-assets/ và đọc một thẻ giả (mã vạch + OCR).
//     Thiếu file nào cần lúc chạy → bước này hỏng → build hỏng.
// Binary native (onnxruntime/sharp) phụ thuộc hệ điều hành của máy build nên chỉ kiểm khi build trên Linux.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const APP = path.join(REPO, "apps/web");
const ROUTE = "api/student/card";
const REQUIRED = [
  ["card-assets/zxing_reader.wasm", /apps\/web\/card-assets\/zxing_reader\.wasm$/],
  ["card-assets/vie.traineddata.gz (dữ liệu OCR vie best_int)", /apps\/web\/card-assets\/vie\.traineddata\.gz$/],
  ["tesseract worker (node)", /tesseract\.js\/src\/worker-script\/node\/index\.js$/],
  // tesseract.js 7 (Node) luôn nạp bản core KHÔNG-lstm — xem next.config.ts; cần cả hai họ, đủ 3 biến thể CPU
  ["tesseract-core*.wasm (thường/simd/relaxedsimd)", /tesseract\.js-core\/tesseract-core(-simd|-relaxedsimd)?\.wasm$/, 3],
  ["tesseract-core*-lstm.wasm", /tesseract\.js-core\/tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm$/, 3],
  ["tesseract-core*.js", /tesseract\.js-core\/tesseract-core(-simd|-relaxedsimd)?(-lstm)?\.js$/],
  ["model det_500m.onnx", /models\/det_500m\.onnx$/],
  ["model w600k_mbf.onnx", /models\/w600k_mbf\.onnx$/],
  ...(process.platform === "linux"
    ? [
        ["onnxruntime linux-x64", /onnxruntime-node\/bin\/napi-v\d+\/linux\/x64\/onnxruntime_binding\.node$/],
        ["sharp linux-x64", /@img\/sharp-linux-x64\//],
      ]
    : []),
];
/** Chuỗi không được xuất hiện trong mã server của route (gói chỉ có dữ liệu, không được import → không có trong trace). */
const FORBIDDEN_IN_CODE = ["@tesseract.js-data/"];

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`  HỎNG  ${msg}`);
};

const nftDir = path.join(APP, ".next/server/app", ROUTE);
const nftFiles = JSON.parse(readFileSync(path.join(nftDir, "route.js.nft.json"), "utf8")).files.map((f) => path.resolve(nftDir, f));
const posix = (p) => p.split(path.sep).join("/");
const rel = nftFiles.map((f) => posix(path.relative(REPO, f)));
console.log(`/${ROUTE} (${nftFiles.length} file trong trace)`);

// 1. Có mặt
for (const [label, re, min = 1] of REQUIRED) {
  const n = new Set(rel.filter((f) => re.test(f))).size;
  if (n >= min) console.log(`  CÓ    ${label}${n > 1 ? ` (${n})` : ""}`);
  else fail(`thiếu ${label} (có ${n}, cần ≥ ${min})`);
}

// 2. Mã server của route không phân giải gói dữ liệu lúc chạy
const serverJs = [path.join(nftDir, "route.js"), ...nftFiles.filter((f) => posix(f).includes("/.next/server/") && f.endsWith(".js"))];
for (const bad of FORBIDDEN_IN_CODE) {
  const hits = [...new Set(serverJs)].filter((f) => existsSync(f) && readFileSync(f, "utf8").includes(bad));
  if (hits.length) fail(`mã server nhắc tới "${bad}" (không có trong trace): ${hits.map((h) => path.relative(APP, h)).join(", ")}`);
  else console.log(`  OK    mã server không nhắc tới "${bad}"`);
}

// 2b. Route lượt điểm danh (US2): model ONNX + font đóng dấu ảnh bằng chứng (sharp/Pango nạp font theo đường dẫn)
{
  const ROUTE_EVENTS = "api/windows/[id]/events";
  const dir = path.join(APP, ".next/server/app", ROUTE_EVENTS);
  const files = JSON.parse(readFileSync(path.join(dir, "route.js.nft.json"), "utf8")).files.map((f) => posix(path.relative(REPO, path.resolve(dir, f))));
  console.log(`/${ROUTE_EVENTS} (${files.length} file trong trace)`);
  const NEED = [
    ["model det_500m.onnx", /models\/det_500m\.onnx$/],
    ["model w600k_mbf.onnx", /models\/w600k_mbf\.onnx$/],
    ["font BeVietnamPro-SemiBold.ttf (đóng dấu ảnh)", /apps\/web\/public\/fonts\/BeVietnamPro-SemiBold\.ttf$/],
    ...(process.platform === "linux"
      ? [
          ["onnxruntime linux-x64", /onnxruntime-node\/bin\/napi-v\d+\/linux\/x64\/onnxruntime_binding\.node$/],
          ["sharp linux-x64", /@img\/sharp-linux-x64\//],
        ]
      : []),
  ];
  for (const [label, re] of NEED) {
    if (files.some((f) => re.test(f))) console.log(`  CÓ    ${label}`);
    else fail(`thiếu ${label}`);
  }
}

// 3. Chạy thử trong thư mục mô phỏng output đã trace
const SKIP = /\.(onnx|node|dll|so(\.\d+)*|dylib)$|pglite\.(wasm|data)$/; // lớn và không cần cho bước đọc thẻ thử
const sim = mkdtempSync(path.join(tmpdir(), "trace-sim-"));
try {
  const inSim = (abs) => path.join(sim, path.relative(REPO, abs));
  let copied = 0;
  const links = [];
  for (const abs of new Set(nftFiles)) {
    if (!existsSync(abs) && !lstatSync(abs, { throwIfNoEntry: false })) continue;
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) links.push(abs);
    else if (st.isFile() && !SKIP.test(abs)) {
      mkdirSync(path.dirname(inSim(abs)), { recursive: true });
      copyFileSync(abs, inSim(abs));
      copied++;
    }
  }
  for (const link of links) {
    const target = path.resolve(path.dirname(link), readlinkSync(link));
    mkdirSync(path.dirname(inSim(link)), { recursive: true });
    mkdirSync(inSim(target), { recursive: true });
    symlinkSync(inSim(target), inSim(link), "junction"); // junction: không cần quyền admin trên Windows
  }

  // Thẻ giả: mã vạch Code128 + dòng MSSV/Họ tên (tạo bằng gói của máy build, NGOÀI thư mục mô phỏng)
  const req = createRequire(path.join(APP, "package.json"));
  const sharp = req("sharp");
  const { prepareZXingModule, writeBarcode } = await import(pathToFileURL(req.resolve("zxing-wasm/writer")).href);
  await prepareZXingModule({ overrides: { wasmBinary: readFileSync(req.resolve("zxing-wasm/writer/zxing_writer.wasm")).buffer }, fireImmediately: true });
  const CODE = "231230899";
  const bc = Buffer.from(await (await writeBarcode(CODE, { format: "Code128", scale: 3 })).image.arrayBuffer());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630"><rect width="100%" height="100%" fill="#fff"/>
    <text x="40" y="120" font-family="Arial" font-size="44">MSSV: ${CODE}</text></svg>`;
  const card = path.join(sim, "card.png");
  writeFileSync(card, await sharp(Buffer.from(svg)).composite([{ input: bc, left: 40, top: 260 }]).png().toBuffer());

  const simApp = inSim(APP);
  mkdirSync(simApp, { recursive: true });
  // Nạp đúng cách route làm: import() (zxing-wasm → bản ESM dist/es; tesseract.js → index CJS), cwd = apps/web
  const probe = path.join(simApp, ".trace-probe.mjs");
  writeFileSync(
    probe,
    `// Chạy trong thư mục mô phỏng: chỉ thấy file đã trace.
import fs from "node:fs";
import path from "node:path";
try {
  const assets = path.join(process.cwd(), "card-assets");
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
  await prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(path.join(assets, "zxing_reader.wasm")).buffer }, fireImmediately: true });
  const img = fs.readFileSync(process.argv[2]);
  const codes = (await readBarcodes(new Uint8Array(img), { formats: ["Code128"] })).map((r) => r.text);
  const { createWorker } = await import("tesseract.js");
  const w = await createWorker("vie", 1, { langPath: assets, gzip: true, cacheMethod: "none" });
  const { data } = await w.recognize(img);
  await w.terminate();
  console.log(JSON.stringify({ codes, text: data.text }));
} catch (e) {
  console.error(String((e && e.stack) || e));
  process.exit(1);
}
`,
  );
  console.log(`  …     thư mục mô phỏng: ${copied} file + ${links.length} liên kết (bỏ qua binary native/model); chạy thử đọc thẻ`);
  let out;
  try {
    out = JSON.parse(execFileSync(process.execPath, [probe, card], { cwd: simApp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim().split("\n").pop());
  } catch (e) {
    fail(`chạy thử trong output đã trace lỗi:\n${String(e.stderr || e.message).split("\n").slice(0, 8).join("\n")}`);
  }
  if (out) {
    if (out.codes.includes(CODE)) console.log("  OK    zxing (wasm từ card-assets) đọc được mã vạch trong output đã trace");
    else fail(`zxing không đọc được mã vạch thẻ giả (được: ${JSON.stringify(out.codes)})`);
    if (out.text.includes(CODE)) console.log("  OK    tesseract (worker + core + dữ liệu vie) đọc được chữ trong output đã trace");
    else fail(`OCR không đọc được MSSV trên thẻ giả (được: ${JSON.stringify(out.text.slice(0, 80))})`);
  }
} finally {
  rmSync(sim, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} lỗi — function sẽ hỏng khi chạy trên Vercel.`);
  process.exit(1);
}
console.log("\nĐủ file, chạy thử trong output đã trace thành công.");
