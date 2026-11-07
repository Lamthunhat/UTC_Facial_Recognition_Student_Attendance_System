import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { extractStudentCode, pickBarcodeCode, type DecodedCode } from "./verify";

/**
 * T057 — Đọc thẻ sinh viên ở server (Principle I, research R3), chạy hoàn toàn cục bộ:
 * - Mã vạch: zxing-wasm, file .wasm nạp từ node_modules (không tải từ CDN).
 * - OCR: tesseract.js + dữ liệu tiếng Việt @tesseract.js-data/vie (đọc được cả chữ số) — dùng để
 *   đọc mã khi mã vạch hỏng và để so họ tên trên thẻ. Không ghi cache ra đĩa (filesystem serverless chỉ đọc).
 * Worker OCR được giữ lại giữa các request trong cùng instance (khởi tạo ~0,3–0,5 s).
 */
// createRequire theo thư mục chạy (không dùng import.meta.url): webpack của Next chỉ phân tích dạng import.meta.url
// và sẽ cố bundle file .wasm/.gz — khi đó require.resolve trả mã module thay vì đường dẫn file. Thư mục chạy
// (apps/web khi chạy Next, packages/backend khi test) đều khai báo zxing-wasm, tesseract.js, @tesseract.js-data/vie.
// Lấy createRequire qua process.getBuiltinModule (Node ≥ 22.3) để webpack không phân tích/cảnh báo lời gọi.
const nodeModule = (process as unknown as { getBuiltinModule(id: "node:module"): typeof import("node:module") }).getBuiltinModule("node:module");
const require = nodeModule.createRequire(path.join(process.cwd(), "package.json"));

let zxingReady: Promise<unknown> | undefined;
function ensureZxing() {
  zxingReady ??= readFile(require.resolve("zxing-wasm/reader/zxing_reader.wasm")).then((wasm) =>
    prepareZXingModule({ overrides: { wasmBinary: wasm.buffer as ArrayBuffer }, fireImmediately: true }),
  );
  return zxingReady;
}

const BARCODE_FORMATS = ["Code128", "Code39", "Code93", "EAN13", "ITF", "Codabar", "QRCode"] as const;

/** Nội dung các mã vạch hợp lệ trên ảnh; thử ảnh gốc, ảnh xám tăng tương phản, ảnh phóng to. */
export async function readBarcodeTexts(img: Buffer): Promise<string[]> {
  await ensureZxing();
  const meta = await sharp(img).metadata();
  const variants: (() => Promise<Buffer>)[] = [
    async () => sharp(img).greyscale().png().toBuffer(),
    async () => sharp(img).greyscale().normalise().sharpen().png().toBuffer(),
  ];
  if ((meta.width ?? 0) < 1600) variants.push(async () => sharp(img).resize({ width: 2000 }).greyscale().png().toBuffer());
  const found = new Set<string>();
  for (const make of variants) {
    const results = await readBarcodes(new Uint8Array(await make()), {
      tryHarder: true,
      tryRotate: true,
      formats: [...BARCODE_FORMATS],
      maxNumberOfSymbols: 3,
    });
    for (const r of results) if (r.isValid && r.text) found.add(r.text);
    if (found.size) break;
  }
  return [...found];
}

let worker: Promise<Worker> | undefined;
function ocrWorker() {
  worker ??= createWorker("vie", 1, {
    langPath: path.join(path.dirname(require.resolve("@tesseract.js-data/vie/package.json")), "4.0.0_best_int"),
    gzip: true,
    cacheMethod: "none",
  }).catch((e) => {
    worker = undefined; // lần sau thử khởi tạo lại
    throw e;
  });
  return worker;
}

/** Toàn bộ chữ OCR được trên ảnh thẻ (ảnh xám, tăng tương phản, cạnh dài ≥ 1600 px). */
export async function ocrText(img: Buffer): Promise<string> {
  const meta = await sharp(img).metadata();
  const prepared = await sharp(img)
    .resize((meta.width ?? 0) < 1600 ? { width: 1600 } : undefined)
    .greyscale()
    .normalise()
    .png()
    .toBuffer();
  const w = await ocrWorker();
  const { data } = await w.recognize(prepared);
  return data.text.normalize("NFC");
}

/** Giải phóng worker OCR (test, tắt instance). */
export async function closeOcr() {
  const w = worker;
  worker = undefined;
  if (w) await (await w).terminate();
}

/**
 * Đọc mã SV trên thẻ: mã vạch trước (tin cậy), không được thì lấy từ chữ OCR (method = "ocr").
 * Luôn trả kèm chữ OCR để so họ tên (nameAppearsIn).
 */
export async function decodeCard(img: Buffer): Promise<{ decoded: DecodedCode | null; text: string }> {
  const [barcodes, text] = await Promise.all([readBarcodeTexts(img), ocrText(img)]);
  const fromBarcode = pickBarcodeCode(barcodes);
  if (fromBarcode) return { decoded: { code: fromBarcode, method: "barcode" }, text };
  const fromText = extractStudentCode(text);
  return { decoded: fromText ? { code: fromText, method: "ocr" } : null, text };
}
