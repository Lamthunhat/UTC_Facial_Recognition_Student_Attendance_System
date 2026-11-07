/**
 * Căn chỉnh khuôn mặt về mẫu ArcFace 112×112 bằng phép biến đổi tương tự (Umeyama, không phản xạ).
 * Thuần toán học — có unit test.
 */
export type Point = [number, number];

/** 5 điểm mốc chuẩn ArcFace (mắt trái, mắt phải, mũi, khoé miệng trái, khoé miệng phải). */
export const ARCFACE_TEMPLATE: Point[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** Ma trận 2×3 [a, -b, tx; b, a, ty] ánh xạ src → dst. */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export function estimateSimilarity(src: Point[], dst: Point[]): Similarity {
  if (src.length !== dst.length || src.length < 2) throw new Error("Cần ≥ 2 cặp điểm");
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i][0];
    sy += src[i][1];
    dx += dst[i][0];
    dy += dst[i][1];
  }
  sx /= n; sy /= n; dx /= n; dy /= n;
  // Nghiệm bình phương tối thiểu cho phép đồng dạng (closed-form)
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx;
    const py = src[i][1] - sy;
    const qx = dst[i][0] - dx;
    const qy = dst[i][1] - dy;
    num1 += px * qx + py * qy;
    num2 += px * qy - py * qx;
    den += px * px + py * py;
  }
  if (den === 0) throw new Error("Các điểm nguồn trùng nhau");
  const a = num1 / den;
  const b = num2 / den;
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

export function applySimilarity(m: Similarity, p: Point): Point {
  return [m.a * p[0] - m.b * p[1] + m.tx, m.b * p[0] + m.a * p[1] + m.ty];
}

export function invertSimilarity(m: Similarity): Similarity {
  const s = m.a * m.a + m.b * m.b;
  const a = m.a / s;
  const b = -m.b / s;
  return { a, b, tx: -(a * m.tx - b * m.ty), ty: -(b * m.tx + a * m.ty) };
}

/**
 * Ước lượng góc quay đầu ngang (yaw, độ) từ 5 điểm mốc: âm = quay sang trái của người trong ảnh.
 * Chiếu độ lệch của mũi so với trung điểm hai mắt lên trục nối hai mắt (nên không bị ảnh hưởng khi
 * đầu/ảnh nghiêng), chuẩn hoá theo khoảng cách hai mắt.
 */
export function estimateYawDeg(kps: Point[]): number {
  const [le, re, nose] = kps;
  const ex = re[0] - le[0];
  const ey = re[1] - le[1];
  const eyeDist = Math.hypot(ex, ey);
  if (eyeDist === 0) return 0;
  const mid: Point = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2];
  const along = ((nose[0] - mid[0]) * ex + (nose[1] - mid[1]) * ey) / eyeDist;
  const ratio = Math.max(-1, Math.min(1, (along / eyeDist) * 2));
  return (Math.asin(ratio) * 180) / Math.PI;
}
