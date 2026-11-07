/**
 * T010 — Thử đọc mã vạch trên ảnh thẻ sinh viên UTC (zxing-wasm).
 * Chạy: pnpm --filter @utc/backend spike:card <ảnh thẻ> [...]
 * Không commit ảnh thẻ thật vào repo.
 */
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { createRequire } from "node:module";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const require = createRequire(import.meta.url);

async function main() {
  // Nạp wasm từ node_modules thay vì CDN (môi trường server không gọi ra ngoài)
  const wasmBinary = (await readFile(require.resolve("zxing-wasm/reader/zxing_reader.wasm"))).buffer;
  await prepareZXingModule({ overrides: { wasmBinary: wasmBinary as ArrayBuffer }, fireImmediately: true });
  for (const file of process.argv.slice(2)) {
    const buf = await readFile(file);
    const variants: [string, Buffer][] = [
      ["gốc", buf],
      ["xám+tăng tương phản", await sharp(buf).rotate().greyscale().normalise().png().toBuffer()],
      ["phóng 2x", await sharp(buf).rotate().resize({ width: 2400 }).greyscale().png().toBuffer()],
    ];
    for (const [label, data] of variants) {
      const t = performance.now();
      const results = await readBarcodes(new Uint8Array(data), {
        tryHarder: true,
        tryRotate: true,
        formats: ["Code128", "Code39", "Code93", "EAN13", "ITF", "Codabar", "QRCode"],
        maxNumberOfSymbols: 3,
      });
      const ms = (performance.now() - t).toFixed(0);
      console.log(`${file} [${label}] ${ms} ms →`, results.filter((r) => r.isValid).map((r) => `${r.format}: "${r.text}"`));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
