import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp, { type OverlayOptions } from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { closeOcr, decodeCard, ocrText, readBarcodeTexts, resetOcrLoaderForTest, setOcrLoaderForTest } from "../../../src/card/decode";
import { nameAppearsIn } from "../../../src/card/verify";

/**
 * T057 — Đọc mã vạch (zxing-wasm) + OCR (tesseract.js) chạy cục bộ trên thẻ GIẢ sinh trong test
 * (không dùng ảnh thẻ thật). Mã vạch Code128 sinh bằng zxing-wasm/writer, chữ vẽ bằng SVG qua sharp.
 */
const require = createRequire(import.meta.url);

async function syntheticCard(opts: { code: string; name: string; barcode?: boolean; blurBarcode?: boolean }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630">
    <rect width="100%" height="100%" fill="#f4f7fb"/>
    <rect x="40" y="150" width="240" height="300" fill="#cfd8e3"/>
    <text x="320" y="70" font-family="Arial" font-size="34" font-weight="bold">TRƯỜNG ĐẠI HỌC GIAO THÔNG VẬN TẢI</text>
    <text x="320" y="200" font-family="Arial" font-size="38">Họ tên: ${opts.name}</text>
    <text x="320" y="270" font-family="Arial" font-size="38">MSSV: ${opts.code}</text>
    <text x="320" y="340" font-family="Arial" font-size="32">Ngày sinh: 12/05/2005</text>
  </svg>`;
  const layers: OverlayOptions[] = [];
  if (opts.barcode !== false) {
    const bc = await writeBarcode(opts.code, { format: "Code128", scale: 3 });
    let png = Buffer.from(await bc.image!.arrayBuffer());
    if (opts.blurBarcode) png = await sharp(png).blur(12).toBuffer();
    layers.push({ input: png, left: 320, top: 400 });
  }
  return sharp(Buffer.from(svg)).composite(layers).jpeg({ quality: 85 }).toBuffer();
}

/** Thẻ GIẢ DỌC kiểu thẻ SV UTC (CR80 54 × 85,6 → 630 × 1000 px): ảnh chân dung trên, chữ ngang, mã vạch ngang hoặc dọc. */
async function portraitCard(opts: { code: string; name: string; barcode: "horizontal" | "vertical" | "none" | "blurred" }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="630" height="1000">
    <rect width="100%" height="100%" fill="#f4f7fb"/>
    <text x="40" y="60" font-family="Arial" font-size="26" font-weight="bold">TRƯỜNG ĐH GIAO THÔNG VẬN TẢI</text>
    <rect x="195" y="100" width="240" height="300" fill="#cfd8e3"/>
    <text x="40" y="470" font-family="Arial" font-size="32">Họ tên: ${opts.name}</text>
    <text x="40" y="530" font-family="Arial" font-size="32">MSSV: ${opts.code}</text>
  </svg>`;
  const layers: OverlayOptions[] = [];
  if (opts.barcode !== "none") {
    const bc = await writeBarcode(opts.code, { format: "Code128", scale: 3 });
    let png = Buffer.from(await bc.image!.arrayBuffer());
    if (opts.barcode === "blurred") png = await sharp(png).blur(12).toBuffer();
    if (opts.barcode === "vertical") png = await sharp(png).rotate(90).toBuffer();
    const m = await sharp(png).metadata();
    // ngang: dưới chữ; dọc: sát mép phải, nửa dưới thẻ
    layers.push(opts.barcode === "vertical" ? { input: png, left: 630 - (m.width ?? 0) - 20, top: 560 } : { input: png, left: Math.round((630 - (m.width ?? 0)) / 2), top: 600 });
  }
  return sharp(Buffer.from(svg)).composite(layers).jpeg({ quality: 88 }).toBuffer();
}

beforeAll(async () => {
  const wasm = await readFile(require.resolve("zxing-wasm/writer/zxing_writer.wasm"));
  await prepareZXingModule({ overrides: { wasmBinary: wasm.buffer as ArrayBuffer }, fireImmediately: true });
}, 60_000);
afterAll(() => closeOcr());

describe("decode thẻ (chạy thật, cục bộ)", () => {
  it("đọc mã vạch Code128 trên thẻ", async () => {
    const card = await syntheticCard({ code: "231230801", name: "NGUYỄN VĂN AN" });
    expect(await readBarcodeTexts(card)).toContain("231230801");
  });

  it("OCR đọc được dòng MSSV và họ tên", async () => {
    const card = await syntheticCard({ code: "231230801", name: "NGUYỄN VĂN AN", barcode: false });
    const text = await ocrText(card);
    expect(text).toMatch(/231230801/);
    // Dấu đọc ra phụ thuộc font hệ thống (Linux CI không có Arial: "NGUYẾỄN") → kiểm bằng đúng bước so tên của nghiệp vụ.
    expect(nameAppearsIn(text, "Nguyễn Văn An"), text).toBe(true);
  }, 60_000);

  it("decodeCard: ưu tiên mã vạch (method=barcode), kèm chữ OCR để so họ tên", async () => {
    const r = await decodeCard(await syntheticCard({ code: "231230801", name: "NGUYỄN VĂN AN" }));
    expect(r.decoded).toEqual({ code: "231230801", method: "barcode" });
    expect(r.text).toMatch(/MSSV/);
  }, 60_000);

  it("decodeCard: mã vạch mờ không đọc được → dùng OCR (method=ocr)", async () => {
    const r = await decodeCard(await syntheticCard({ code: "231230802", name: "TRẦN THỊ BÌNH", blurBarcode: true }));
    expect(r.decoded).toEqual({ code: "231230802", method: "ocr" });
  }, 60_000);

  it("thẻ DỌC: mã vạch nằm ngang đọc được", async () => {
    expect(await readBarcodeTexts(await portraitCard({ code: "231230811", name: "LÊ VĂN LÂM", barcode: "horizontal" }))).toContain("231230811");
  }, 60_000);

  it("thẻ DỌC: mã vạch nằm dọc (xoay 90°) vẫn đọc được (tryRotate)", async () => {
    expect(await readBarcodeTexts(await portraitCard({ code: "231230812", name: "PHAN THỊ PHƯƠNG", barcode: "vertical" }))).toContain("231230812");
  }, 60_000);

  it("ảnh thẻ DỌC bị xoay nằm ngang cả thẻ: mã vạch vẫn đọc được", async () => {
    const card = await sharp(await portraitCard({ code: "231230813", name: "NGÔ THỊ LINH", barcode: "horizontal" })).rotate(90).jpeg().toBuffer();
    expect(await readBarcodeTexts(card)).toContain("231230813");
  }, 60_000);

  it("thẻ DỌC xoay 90° + mã vạch mờ → OCR xoay ảnh thử lại, đọc được mã và họ tên (method=ocr)", async () => {
    const card = await sharp(await portraitCard({ code: "231230814", name: "NGUYỄN VĂN AN", barcode: "blurred" })).rotate(90).jpeg().toBuffer();
    const r = await decodeCard(card);
    expect(r.decoded).toEqual({ code: "231230814", method: "ocr" });
    expect(nameAppearsIn(r.text, "Nguyễn Văn An"), r.text).toBe(true);
    expect(r.stats.ocrRotations).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("mã vạch đọc được → KHÔNG chạy OCR xoay (kể cả thẻ nằm ngang, chữ OCR lần đầu vô dụng); có thời gian từng bước", async () => {
    const card = await sharp(await portraitCard({ code: "231230815", name: "ĐỖ HỮU KHÁNH", barcode: "horizontal" })).rotate(90).jpeg().toBuffer();
    const r = await decodeCard(card);
    expect(r.decoded).toEqual({ code: "231230815", method: "barcode" });
    expect(r.stats.ocrRotations).toBe(0);
    expect(r.stats.barcodeMs).toBeGreaterThanOrEqual(0);
    expect(r.stats.ocrMs).toBeGreaterThanOrEqual(0);
  }, 120_000);

  describe("tesseract nạp lười — lỗi nạp OCR không làm hỏng cả route", () => {
    afterEach(async () => {
      await closeOcr();
      resetOcrLoaderForTest();
    });

    it("OCR không nạp được + mã vạch đọc được → vẫn trả mã (method=barcode), text rỗng, cờ ocrFailed", async () => {
      await closeOcr();
      setOcrLoaderForTest(() => Promise.reject(new Error("Cannot find module '@tesseract.js-data/vie/package.json'")));
      const r = await decodeCard(await portraitCard({ code: "231230816", name: "VŨ MINH QUÂN", barcode: "horizontal" }));
      expect(r.decoded).toEqual({ code: "231230816", method: "barcode" });
      expect(r.text).toBe("");
      expect(r.stats.ocrFailed).toBe(true);
    }, 60_000);

    it("OCR không nạp được + KHÔNG có mã vạch → 503 OCR_UNAVAILABLE (lỗi máy chủ, không phải lỗi của SV)", async () => {
      await closeOcr();
      setOcrLoaderForTest(() => Promise.reject(new Error("boom")));
      await expect(decodeCard(await portraitCard({ code: "231230817", name: "TRỊNH VĂN SƠN", barcode: "blurred" }))).rejects.toMatchObject({
        status: 503,
        code: "OCR_UNAVAILABLE",
      });
    }, 60_000);
  });

  it("ảnh không có chữ hay mã vạch → decoded null", async () => {
    const blank = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#888" } }).jpeg().toBuffer();
    expect((await decodeCard(blank)).decoded).toBeNull();
  }, 60_000);
});
