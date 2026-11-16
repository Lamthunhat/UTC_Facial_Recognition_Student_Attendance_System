/**
 * Mô hình đầu tổng hợp (cho TEST yaw ở client + server — không dùng ảnh mặt thật): đầu là elip (rộng 1, sâu 1,2 đơn vị),
 * quay quanh trục dọc góc θ (θ > 0 = SV quay sang TRÁI của mình), chiếu trực giao lên ảnh KHÔNG lật (trục x sang phải).
 * Trả keypoint kiểu SCRFD (5 điểm: 2 mắt, mũi, 2 mép) và BlazeFace (6 điểm: 2 mắt, mũi, miệng, 2 tai) + bbox mặt.
 */
type P3 = [number, number, number];
const RX = 0.5; // nửa bề rộng đầu
const RZ = 0.6; // nửa chiều sâu đầu
const PTS: Record<string, P3> = {
  eyeA: [-0.17, -0.05, 0.42],
  eyeB: [0.17, -0.05, 0.42],
  nose: [0, 0.1, 0.62],
  mouthA: [-0.13, 0.3, 0.42],
  mouthB: [0.13, 0.3, 0.42],
  mouth: [0, 0.3, 0.45],
  earA: [-0.48, 0.05, 0],
  earB: [0.48, 0.05, 0],
};

export interface HeadView {
  box: { x1: number; y1: number; x2: number; y2: number };
  scrfd: { eyeA: { x: number; y: number }; eyeB: { x: number; y: number }; nose: { x: number; y: number }; kps: [number, number][] };
  blaze: { eyeA: { x: number; y: number }; eyeB: { x: number; y: number }; nose: { x: number; y: number }; kps: { x: number; y: number }[] };
}

export function syntheticHead(deg: number, o: { scale?: number; cx?: number; cy?: number } = {}): HeadView {
  const s = o.scale ?? 300;
  const cx = o.cx ?? 640;
  const cy = o.cy ?? 360;
  const t = (deg * Math.PI) / 180;
  const proj = ([X, Y, Z]: P3) => ({ x: cx + s * (X * Math.cos(t) + Z * Math.sin(t)), y: cy + s * Y });
  const p = Object.fromEntries(Object.entries(PTS).map(([k, v]) => [k, proj(v)])) as Record<keyof typeof PTS, { x: number; y: number }>;
  const half = s * Math.sqrt(RX * RX * Math.cos(t) ** 2 + RZ * RZ * Math.sin(t) ** 2); // bề rộng hình chiếu của elip đầu
  return {
    box: { x1: cx - half, y1: cy - 0.45 * s, x2: cx + half, y2: cy + 0.5 * s },
    scrfd: { eyeA: p.eyeA, eyeB: p.eyeB, nose: p.nose, kps: [p.eyeA, p.eyeB, p.nose, p.mouthA, p.mouthB].map((q) => [q.x, q.y]) },
    blaze: { eyeA: p.eyeA, eyeB: p.eyeB, nose: p.nose, kps: [p.eyeA, p.eyeB, p.nose, p.mouth, p.earA, p.earB] },
  };
}
