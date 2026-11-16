import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Worker } from "tesseract.js";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { HttpError } from "../http/errors";
import { log } from "../log";
import { cardAssetPath } from "./assets";
import { extractStudentCode, ocrNameLine, pickBarcodeCode, type DecodedCode } from "./verify";

/**
 * T057 — Đọc thẻ sinh viên ở server (Principle I, research R3), chạy hoàn toàn cục bộ:
 * - Mã vạch: zxing-wasm, file .wasm đọc từ card-assets/ (không tải từ CDN).
 * - OCR: tesseract.js + dữ liệu tiếng Việt (card-assets/vie.traineddata.gz, bản 4.0.0_best_int) — đọc mã khi mã vạch
 *   hỏng và so họ tên trên thẻ. Không ghi cache ra đĩa (filesystem serverless chỉ đọc).
 * Dữ liệu chạy nằm ở thư mục cố định card-assets/ (chép + kiểm sha256 khi build, xem ./assets.ts) — KHÔNG
 * require.resolve gói nào lúc chạy (function Vercel không có package.json của gói không được import).
 * tesseract.js chỉ được import khi thật sự cần OCR; lỗi nạp OCR không làm hỏng route khi mã vạch đã đọc được.
 * Worker OCR được giữ lại giữa các request trong cùng instance (khởi tạo ~0,3–0,5 s).
 */
let zxingReady: Promise<unknown> | undefined;
function ensureZxing() {
  zxingReady ??= readFile(cardAssetPath("zxing_reader.wasm"))
    .then((wasm) => prepareZXingModule({ overrides: { wasmBinary: wasm.buffer as ArrayBuffer }, fireImmediately: true }))
    .catch((e) => {
      zxingReady = undefined; // lần sau thử lại
      throw e;
    });
  return zxingReady;
}

const BARCODE_FORMATS = ["Code128", "Code39", "Code93", "EAN13", "ITF", "Codabar", "QRCode"] as const;

/**
 * Nội dung các mã vạch hợp lệ trên ảnh; thử ảnh xám, ảnh tăng tương phản, ảnh phóng to (theo cạnh dài).
 * Thẻ SV UTC là thẻ DỌC: mã vạch có thể nằm ngang hoặc dọc trong ảnh → tryRotate; tryInvert cho mã in sáng trên nền tối.
 */
export async function readBarcodeTexts(img: Buffer): Promise<string[]> {
  await ensureZxing();
  const meta = await sharp(img).metadata();
  const variants: (() => Promise<Buffer>)[] = [
    async () => sharp(img).greyscale().png().toBuffer(),
    async () => sharp(img).greyscale().normalise().sharpen().png().toBuffer(),
  ];
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longEdge < 1600) {
    const size = (meta.width ?? 0) >= (meta.height ?? 0) ? { width: 2000 } : { height: 2000 };
    variants.push(async () => sharp(img).resize(size).greyscale().png().toBuffer());
  }
  const found = new Set<string>();
  for (const make of variants) {
    const results = await readBarcodes(new Uint8Array(await make()), {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      formats: [...BARCODE_FORMATS],
      maxNumberOfSymbols: 3,
    });
    for (const r of results) if (r.isValid && r.text) found.add(r.text);
    if (found.size) break;
  }
  return [...found];
}

/** Nạp tesseract.js lười (chỉ khi cần OCR). Thay được trong test để giả lập lỗi nạp. */
type TesseractModule = Pick<typeof import("tesseract.js"), "createWorker">;
const defaultOcrLoader = (): Promise<TesseractModule> => import("tesseract.js");
let ocrLoader = defaultOcrLoader;
export function setOcrLoaderForTest(loader: () => Promise<TesseractModule>) {
  ocrLoader = loader;
}
export function resetOcrLoaderForTest() {
  ocrLoader = defaultOcrLoader;
}

let worker: Promise<Worker> | undefined;
function ocrWorker() {
  worker ??= (async () => {
    const { createWorker } = await ocrLoader();
    return createWorker("vie", 1, {
      langPath: path.dirname(cardAssetPath("vie.traineddata.gz")),
      gzip: true,
      cacheMethod: "none",
    });
  })().catch((e) => {
    worker = undefined; // lần sau thử khởi tạo lại
    throw e;
  });
  return worker;
}

/** Toàn bộ chữ OCR được trên ảnh thẻ (ảnh xám, tăng tương phản, cạnh dài ≥ 1600 px), tuỳ chọn xoay trước. */
export async function ocrText(img: Buffer, rotate: 0 | 90 | 270 = 0): Promise<string> {
  const rotated = rotate ? await sharp(img).rotate(rotate).toBuffer() : img;
  const meta = await sharp(rotated).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const prepared = await sharp(rotated)
    .resize(Math.max(w, h) < 1600 ? (w >= h ? { width: 1600 } : { height: 1600 }) : undefined)
    .greyscale()
    .normalise()
    .png()
    .toBuffer();
  const worker = await ocrWorker();
  const { data } = await worker.recognize(prepared);
  return data.text.normalize("NFC");
}

/** Chữ OCR có dùng được không: thấy mã SV hoặc nhãn họ tên. */
const usefulText = (text: string) => !!extractStudentCode(text) || ocrNameLine(text) !== null;

/**
 * OCR xoay thử (ảnh thẻ dọc có thể bị chụp/xoay nằm ngang): `first` (chữ lần đầu, ảnh gốc) không thấy mã hay họ tên
 * → xoay 90°, rồi 270°. Trả chữ của lần đầu tiên dùng được (không được thì `first`) + số lần đã xoay.
 */
export async function ocrRotateRetry(img: Buffer, first: string): Promise<{ text: string; rotations: number }> {
  if (usefulText(first)) return { text: first, rotations: 0 };
  let rotations = 0;
  for (const angle of [90, 270] as const) {
    rotations++;
    const t = await ocrText(img, angle);
    if (usefulText(t)) return { text: t, rotations };
  }
  return { text: first, rotations };
}

export interface DecodeStats {
  barcodeMs: number;
  ocrMs: number;
  /** OCR không chạy được (nạp tesseract / dữ liệu lỗi) — họ tên chưa được kiểm. */
  ocrFailed?: boolean;
  /** Số lần OCR lại với ảnh xoay (chỉ khi KHÔNG đọc được mã vạch). */
  ocrRotations: number;
}

/** Giải phóng worker OCR (test, tắt instance). */
export async function closeOcr() {
  const w = worker;
  worker = undefined;
  if (w) await (await w).terminate();
}

/**
 * Đọc mã SV trên thẻ: mã vạch trước (tin cậy), không được thì lấy từ chữ OCR (method = "ocr").
 * Mã vạch và OCR lần đầu chạy song song; OCR xoay ảnh CHỈ chạy khi không đọc được mã vạch (tiết kiệm thời gian).
 * Luôn trả kèm chữ OCR để so họ tên (nameAppearsIn) + thời gian từng bước.
 */
export async function decodeCard(img: Buffer): Promise<{ decoded: DecodedCode | null; text: string; stats: DecodeStats }> {
  const t0 = performance.now();
  let barcodeMs = 0;
  let ocrMs = 0;
  let ocrError: unknown = null;
  const [barcodes, first] = await Promise.all([
    readBarcodeTexts(img).finally(() => (barcodeMs = Math.round(performance.now() - t0))),
    ocrText(img)
      .catch((e) => {
        ocrError = e;
        return "";
      })
      .finally(() => (ocrMs = Math.round(performance.now() - t0))),
  ]);
  if (ocrError) log.error("card_ocr_unavailable", { err: String(ocrError).slice(0, 300) });
  const fromBarcode = pickBarcodeCode(barcodes);
  if (fromBarcode) {
    return { decoded: { code: fromBarcode, method: "barcode" }, text: first, stats: { barcodeMs, ocrMs, ocrRotations: 0, ocrFailed: !!ocrError } };
  }
  // Không có mã vạch mà OCR cũng không chạy được → lỗi máy chủ (không phải ảnh của SV hỏng)
  if (ocrError) throw new HttpError(503, "OCR_UNAVAILABLE", "Tạm thời không đọc được thẻ. Vui lòng thử lại sau ít phút.");
  const t1 = performance.now();
  const { text, rotations } = await ocrRotateRetry(img, first);
  ocrMs += Math.round(performance.now() - t1);
  const fromText = extractStudentCode(text);
  return { decoded: fromText ? { code: fromText, method: "ocr" } : null, text, stats: { barcodeMs, ocrMs, ocrRotations: rotations } };
}
