/**
 * Yaw (quay đầu trái/phải) DÙNG CHUNG cho client (MediaPipe BlazeFace, 6 keypoint) và server (SCRFD, 5 keypoint).
 * Trên ảnh KHÔNG lật: yaw = kẹp(YAW_SCALE × (mũi.x − tâm 2 mắt.x) / bề rộng bbox mặt, −1, 1).
 * SV quay sang TRÁI của mình → mũi lệch PHẢI ảnh → yaw > 0.
 *
 * Vì sao không chia cho khoảng cách 2 mắt (công thức cũ): quay θ thì khoảng cách mắt ≈ cos θ → 0, thương số phình ra
 * (thử thật iPhone: -3,95 / 7,06 / -41,12) và đổi dấu khi điểm mắt "chéo" nhau. Hiệu mũi − tâm mắt ≈ (d_mũi − d_mắt)·sin θ
 * đơn điệu, không đổi dấu; bề rộng bbox gần như không đổi khi quay → thương số ổn định (test với mô hình đầu -80°…80°).
 * YAW_SCALE = 5 → yaw ≈ sin θ ở góc nhỏ (theo mô hình đầu head-model.ts) — hiệu chỉnh bằng mặt thật ở /sv/the-sinh-vien/debug.
 * Ngưỡng client/server: ./face-yaw-thresholds.ts (nguồn duy nhất).
 */
import type { YawThresholds } from "./face-yaw-thresholds";

export interface XY {
  x: number;
  y: number;
}

export const YAW_SCALE = 5;

export function faceYaw(eyeA: XY, eyeB: XY, nose: XY, boxWidth: number): number | null {
  if (!(boxWidth > 0) || ![eyeA.x, eyeB.x, nose.x].every(Number.isFinite)) return null;
  const raw = (YAW_SCALE * (nose.x - (eyeA.x + eyeB.x) / 2)) / boxWidth;
  return Math.max(-1, Math.min(1, raw));
}

export type YawPose = "left" | "right" | "center" | "too_far" | "unclear";

export function classifyFaceYaw(yaw: number | null, t: YawThresholds): YawPose {
  if (yaw === null || !Number.isFinite(yaw)) return "unclear";
  const a = Math.abs(yaw);
  if (a <= t.centerMax) return "center";
  if (a > t.turnMax) return "too_far";
  if (a >= t.turnMin) return yaw > 0 ? "left" : "right";
  return "unclear";
}
