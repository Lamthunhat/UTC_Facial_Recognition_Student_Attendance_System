import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardAssetPath, cardAssetsDir } from "../../../src/card/assets";

/** Đường dẫn dữ liệu đọc thẻ lúc chạy: thư mục cố định (CARD_ASSETS_DIR hoặc <cwd>/card-assets) — không require.resolve. */
const saved = process.env.CARD_ASSETS_DIR;
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "assets-"));
});
afterEach(async () => {
  if (saved === undefined) delete process.env.CARD_ASSETS_DIR;
  else process.env.CARD_ASSETS_DIR = saved;
  await rm(dir, { recursive: true, force: true });
});

describe("cardAssetPath", () => {
  it("mặc định <cwd>/card-assets", () => {
    delete process.env.CARD_ASSETS_DIR;
    expect(cardAssetsDir()).toBe(path.join(process.cwd(), "card-assets"));
  });

  it("CARD_ASSETS_DIR → đường dẫn file trong thư mục đó", async () => {
    process.env.CARD_ASSETS_DIR = dir;
    await writeFile(path.join(dir, "zxing_reader.wasm"), "x");
    expect(cardAssetPath("zxing_reader.wasm")).toBe(path.join(dir, "zxing_reader.wasm"));
  });

  it("thiếu file → lỗi rõ ràng nêu tên file + cách tạo", () => {
    process.env.CARD_ASSETS_DIR = dir;
    expect(() => cardAssetPath("vie.traineddata.gz")).toThrow(/vie\.traineddata\.gz.*card-assets\.mjs/);
  });
});
