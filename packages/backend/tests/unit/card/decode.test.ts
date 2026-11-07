import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp, { type OverlayOptions } from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { closeOcr, decodeCard, ocrText, readBarcodeTexts } from "../../../src/card/decode";

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
    expect(text.toUpperCase()).toMatch(/NGUY.N V.N AN/);
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

  it("ảnh không có chữ hay mã vạch → decoded null", async () => {
    const blank = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#888" } }).jpeg().toBuffer();
    expect((await decodeCard(blank)).decoded).toBeNull();
  }, 60_000);
});
