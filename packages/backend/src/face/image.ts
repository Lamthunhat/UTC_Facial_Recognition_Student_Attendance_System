import "server-only";
import sharp from "sharp";

/** Ảnh RGB 8-bit dạng mảng phẳng (HWC). */
export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array; // length = width * height * 3
}

/** Giải mã JPEG/PNG/WebP/HEIC → RGB, xoay theo EXIF, giới hạn cạnh dài để tiết kiệm CPU. */
export async function decodeToRgb(input: Buffer, maxSide = 1280): Promise<RgbImage> {
  const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** Lấy mẫu song tuyến tính tại toạ độ thực (x, y); ngoài biên trả 0. */
export function sampleBilinear(img: RgbImage, x: number, y: number, out: Float32Array, o: number) {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) {
    out[o] = out[o + 1] = out[o + 2] = 0;
    return;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const a = data[(y0 * w + x0) * 3 + c];
    const b = data[(y0 * w + x1) * 3 + c];
    const d = data[(y1 * w + x0) * 3 + c];
    const e = data[(y1 * w + x1) * 3 + c];
    out[o + c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
  }
}

/** Độ sáng trung bình (0..1) và độ nét (phương sai Laplacian chuẩn hoá) của một vùng — dùng cho hồ sơ (FR-112). */
export function imageQuality(img: RgbImage, box?: { x1: number; y1: number; x2: number; y2: number }) {
  const { width: w, data } = img;
  const x1 = Math.max(1, Math.floor(box?.x1 ?? 1));
  const y1 = Math.max(1, Math.floor(box?.y1 ?? 1));
  const x2 = Math.min(img.width - 2, Math.ceil(box?.x2 ?? img.width - 2));
  const y2 = Math.min(img.height - 2, Math.ceil(box?.y2 ?? img.height - 2));
  const gray = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let sum = 0;
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = y1; y <= y2; y += 2) {
    for (let x = x1; x <= x2; x += 2) {
      const g = gray(x, y);
      const lap = gray(x - 1, y) + gray(x + 1, y) + gray(x, y - 1) + gray(x, y + 1) - 4 * g;
      sum += g;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return { brightness: 0, sharpness: 0 };
  const variance = lapSq / n - (lapSum / n) ** 2;
  return {
    brightness: sum / n / 255,
    // ~1000 là ảnh rất nét; chuẩn hoá về 0..1
    sharpness: Math.min(1, variance / 1000),
  };
}
