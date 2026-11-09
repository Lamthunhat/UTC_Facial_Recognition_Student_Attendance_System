/**
 * Nén ảnh ở trình duyệt trước khi gửi (thuần — bộ mã hoá JPEG được truyền vào; trình duyệt dùng canvas,
 * xem image-browser.ts). Giới hạn server: ảnh thẻ ≤ 1 MB, mỗi khung mặt ≤ 1 MB, tổng request ≤ 4 MB (FR-100, R14).
 */
export interface CompressSpec {
  maxEdge: number;
  maxBytes: number;
  startQuality: number;
  minQuality: number;
}

/** Ảnh thẻ: cạnh dài ~1600 px đủ cho mã vạch + OCR. */
export const CARD_IMAGE: CompressSpec = { maxEdge: 1600, maxBytes: 1_000_000, startQuality: 0.85, minQuality: 0.5 };
/** Khung mặt trực tiếp: ~720p; ngân sách nhỏ hơn 1 MB để 1 thẻ + 3 khung luôn ≤ 4 MB. */
export const FACE_FRAME: CompressSpec = { maxEdge: 1280, maxBytes: 900_000, startQuality: 0.85, minQuality: 0.5 };

export const REQUEST_MAX_BYTES = 4 * 1024 * 1024;
/** Phần dư cho ranh giới multipart + trường nonce. */
const MULTIPART_OVERHEAD = 16 * 1024;

export type Encoder = (width: number, height: number, quality: number) => Promise<Blob>;

export function fitWithin(width: number, height: number, maxEdge: number) {
  const k = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/** Thử giảm chất lượng trước, rồi thu nhỏ 20 % mỗi vòng; không vừa sau 5 vòng → IMAGE_TOO_LARGE. */
export async function compressImage(
  source: { width: number; height: number },
  spec: CompressSpec,
  encode: Encoder,
): Promise<{ blob: Blob; width: number; height: number; quality: number }> {
  const qualities: number[] = [];
  for (let q = spec.startQuality; q >= spec.minQuality - 1e-9; q -= 0.1) qualities.push(Math.round(q * 100) / 100);
  let edge = spec.maxEdge;
  for (let round = 0; round < 5; round++) {
    const { width, height } = fitWithin(source.width, source.height, edge);
    for (const quality of qualities) {
      const blob = await encode(width, height, quality);
      if (blob.size <= spec.maxBytes) return { blob, width, height, quality };
    }
    edge = Math.round(edge * 0.8);
  }
  throw new Error("IMAGE_TOO_LARGE");
}

export function requestFits(sizes: number[]): boolean {
  return sizes.reduce((a, b) => a + b, 0) + MULTIPART_OVERHEAD <= REQUEST_MAX_BYTES;
}

/**
 * Khung hướng dẫn vẽ trên màn hình (video `object-fit: cover`) → vùng cắt tương ứng trên ảnh gốc của video,
 * nới thêm `margin` (tỉ lệ) mỗi phía để không cắt sát mép thẻ; kẹp trong ảnh.
 */
export function guideCrop(
  v: { videoW: number; videoH: number; viewW: number; viewH: number },
  rect: { x: number; y: number; width: number; height: number },
  margin = 0.06,
) {
  const scale = Math.max(v.viewW / v.videoW, v.viewH / v.videoH);
  const offX = (v.videoW * scale - v.viewW) / 2;
  const offY = (v.videoH * scale - v.viewH) / 2;
  const mx = rect.width * margin;
  const my = rect.height * margin;
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
  const x1 = clamp((rect.x - mx + offX) / scale, v.videoW);
  const y1 = clamp((rect.y - my + offY) / scale, v.videoH);
  const x2 = clamp((rect.x + rect.width + mx + offX) / scale, v.videoW);
  const y2 = clamp((rect.y + rect.height + my + offY) / scale, v.videoH);
  return { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
}
