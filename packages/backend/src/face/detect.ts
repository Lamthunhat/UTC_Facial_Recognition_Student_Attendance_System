import "server-only";
import type { Point } from "./align";
import type { RgbImage } from "./image";
import { getDetector, ort } from "./sessions";

export interface FaceDetection {
  score: number;
  box: { x1: number; y1: number; x2: number; y2: number };
  kps: Point[]; // 5 điểm mốc
}

const INPUT = 640;
const STRIDES = [8, 16, 32] as const;
const ANCHORS_PER_CELL = 2;

/**
 * Phát hiện khuôn mặt bằng SCRFD-500M.
 * Ảnh được thu nhỏ giữ tỉ lệ, đặt ở góc trên-trái của khung 640×640 (giống InsightFace).
 */
export async function detectFaces(
  img: RgbImage,
  { scoreThreshold = 0.5, nmsThreshold = 0.4 } = {},
): Promise<FaceDetection[]> {
  const scale = Math.min(INPUT / img.width, INPUT / img.height);
  const nw = Math.round(img.width * scale);
  const nh = Math.round(img.height * scale);

  // Tensor NCHW, chuẩn hoá (x - 127.5) / 128
  const tensor = new Float32Array(3 * INPUT * INPUT);
  const plane = INPUT * INPUT;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const si = (sy * img.width + sx) * 3;
      const di = y * INPUT + x;
      tensor[di] = (img.data[si] - 127.5) / 128;
      tensor[plane + di] = (img.data[si + 1] - 127.5) / 128;
      tensor[2 * plane + di] = (img.data[si + 2] - 127.5) / 128;
    }
  }
  // InsightFace đệm pixel 0 trước khi chuẩn hoá → giá trị (0 - 127.5) / 128
  const padValue = -127.5 / 128;
  for (let y = 0; y < INPUT; y++) {
    for (let x = y < nh ? nw : 0; x < INPUT; x++) {
      const di = y * INPUT + x;
      tensor[di] = tensor[plane + di] = tensor[2 * plane + di] = padValue;
    }
  }

  const session = await getDetector();
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, INPUT, INPUT]) };
  const out = await session.run(feeds);
  const names = session.outputNames; // [scores×3, bbox×3, kps×3]

  const candidates: FaceDetection[] = [];
  STRIDES.forEach((stride, s) => {
    const scores = out[names[s]].data as Float32Array;
    const boxes = out[names[s + 3]].data as Float32Array;
    const kps = out[names[s + 6]].data as Float32Array;
    const fw = INPUT / stride;
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i];
      if (score < scoreThreshold) continue;
      const cell = Math.floor(i / ANCHORS_PER_CELL);
      const cx = (cell % fw) * stride;
      const cy = Math.floor(cell / fw) * stride;
      const b = i * 4;
      const box = {
        x1: (cx - boxes[b] * stride) / scale,
        y1: (cy - boxes[b + 1] * stride) / scale,
        x2: (cx + boxes[b + 2] * stride) / scale,
        y2: (cy + boxes[b + 3] * stride) / scale,
      };
      const k = i * 10;
      const points: Point[] = [];
      for (let p = 0; p < 5; p++) {
        points.push([
          (cx + kps[k + p * 2] * stride) / scale,
          (cy + kps[k + p * 2 + 1] * stride) / scale,
        ]);
      }
      candidates.push({ score, box, kps: points });
    }
  });

  return nms(candidates, nmsThreshold);
}

export function iou(a: FaceDetection["box"], b: FaceDetection["box"]) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const area = (r: FaceDetection["box"]) => Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

export function nms(dets: FaceDetection[], threshold: number): FaceDetection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: FaceDetection[] = [];
  for (const d of sorted) {
    if (keep.every((k) => iou(k.box, d.box) <= threshold)) keep.push(d);
  }
  return keep;
}
