import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Dữ liệu đọc thẻ lúc chạy (dữ liệu OCR vie, wasm zxing) nằm ở thư mục CỐ ĐỊNH, được chép + kiểm sha256 khi build
 * (scripts/card-assets.mjs) và khai báo trong outputFileTracingIncludes. Không require.resolve gói nào lúc chạy:
 * function Vercel chỉ chứa file trong trace (không có package.json của gói không được import).
 * Thư mục: CARD_ASSETS_DIR, mặc định <cwd>/card-assets (cwd = apps/web khi chạy Next, kể cả trên Vercel).
 */
export function cardAssetsDir(): string {
  return process.env.CARD_ASSETS_DIR || path.join(process.cwd(), "card-assets");
}

export function cardAssetPath(name: "vie.traineddata.gz" | "zxing_reader.wasm"): string {
  const file = path.join(cardAssetsDir(), name);
  if (!existsSync(file)) throw new Error(`Thiếu dữ liệu đọc thẻ ${name} trong ${cardAssetsDir()} — chạy: node scripts/card-assets.mjs`);
  return file;
}
