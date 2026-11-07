import "server-only";
import sharp from "sharp";
import { detectFaces } from "../face/detect";
import { embedFace } from "../face/embed";
import { decodeToRgb, imageQuality } from "../face/image";
import type { PortraitFace } from "./verify";

/**
 * T056/T058 — Phân tích chân dung trên ảnh thẻ bằng pipeline ONNX dùng chung (SCRFD-500M + MobileFaceNet,
 * nạp một lần/instance trong face/sessions.ts): phát hiện mặt + 5 điểm mốc, đo độ nét vùng mặt,
 * và (chỉ khi được gọi) trích vector 512 chiều đã căn chỉnh / cắt ảnh chân dung để lưu.
 */
export interface AnalyzedPortraits {
  faces: PortraitFace[];
  embed(index: number): Promise<number[]>;
  crop(index: number): Promise<Buffer>;
}

export async function analyzePortraits(jpeg: Buffer): Promise<AnalyzedPortraits> {
  const rgb = await decodeToRgb(jpeg, 1280);
  const dets = await detectFaces(rgb, { scoreThreshold: 0.5 });
  const faces: PortraitFace[] = dets.map((d) => ({ score: d.score, box: d.box, kps: d.kps, sharpness: imageQuality(rgb, d.box).sharpness }));
  return {
    faces,
    embed: async (i) => Array.from(await embedFace(rgb, dets[i].kps)),
    crop: async (i) => {
      // Khung mặt nới 35% mỗi phía để ảnh chân dung giống ảnh thẻ (giảng viên so trực quan).
      const { x1, y1, x2, y2 } = dets[i].box;
      const padX = (x2 - x1) * 0.35;
      const padY = (y2 - y1) * 0.35;
      const left = Math.max(0, Math.floor(x1 - padX));
      const top = Math.max(0, Math.floor(y1 - padY));
      const width = Math.min(rgb.width - left, Math.ceil(x2 - x1 + 2 * padX));
      const height = Math.min(rgb.height - top, Math.ceil(y2 - y1 + 2 * padY));
      return sharp(Buffer.from(rgb.data), { raw: { width: rgb.width, height: rgb.height, channels: 3 } })
        .extract({ left, top, width, height })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
    },
  };
}
