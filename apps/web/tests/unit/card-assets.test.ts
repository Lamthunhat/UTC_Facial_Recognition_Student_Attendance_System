import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CARD_ASSETS, prepareCardAssets } from "../../../../scripts/card-assets.mjs";

/**
 * Dữ liệu đọc thẻ dùng lúc chạy (dữ liệu OCR vie, wasm zxing) được CHÉP vào apps/web/card-assets/ khi build,
 * kiểm sha256 đã ghim — code chạy chỉ đọc theo đường dẫn cố định, không phân giải package.json lúc chạy
 * (lỗi Vercel: Cannot find module '@tesseract.js-data/vie/package.json').
 */
const APP = path.resolve(__dirname, "../..");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let out = "";
beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), "card-assets-"));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe("prepareCardAssets", () => {
  it("chép đủ file vào thư mục đích, đúng sha256 đã ghim", async () => {
    const r = await prepareCardAssets({ appDir: APP, outDir: out });
    expect(r.map((x: { name: string }) => x.name).sort()).toEqual(["vie.traineddata.gz", "zxing_reader.wasm"]);
    for (const a of CARD_ASSETS as { name: string; sha256: string }[]) {
      expect(sha(await readFile(path.join(out, a.name))), a.name).toBe(a.sha256);
    }
  });

  it("sha256 nguồn khác bản ghim (gói đổi phiên bản / bị sửa) → lỗi nêu tên file, không chép", async () => {
    const bad = CARD_ASSETS.map((a) => (a.name === "vie.traineddata.gz" ? { ...a, sha256: "0".repeat(64) } : a));
    await expect(prepareCardAssets({ appDir: APP, outDir: out, assets: bad })).rejects.toThrow(/vie\.traineddata\.gz.*sha256/);
  });

  it("file đích bị hỏng → chép lại đè lên (không tin file cũ)", async () => {
    await prepareCardAssets({ appDir: APP, outDir: out });
    await writeFile(path.join(out, "zxing_reader.wasm"), "hong");
    await prepareCardAssets({ appDir: APP, outDir: out });
    const z = (CARD_ASSETS as { name: string; sha256: string }[]).find((a) => a.name === "zxing_reader.wasm")!;
    expect(sha(await readFile(path.join(out, "zxing_reader.wasm")))).toBe(z.sha256);
  });
});
