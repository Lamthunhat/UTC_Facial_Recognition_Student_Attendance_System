import type { Point } from "./align";
import { cosine } from "./similarity";

/**
 * Liveness bằng thử thách quay đầu do server cấp kèm nonce (research R2, Principle I). Hàm thuần.
 * Yaw ước lượng từ 5 điểm mốc SCRFD [mắt, mắt, mũi, mép, mép]: độ lệch ngang của mũi so với trung điểm
 * hai mắt, chia cho khoảng cách hai mắt. Quy ước ảnh camera trước KHÔNG lật (ảnh gốc gửi lên server):
 * SV quay đầu sang TRÁI của mình → mũi lệch sang PHẢI ảnh → yaw > 0.
 * Dùng chung cho đăng ký thẻ (FR-045a) và điểm danh (Phase 5).
 */
export type Pose = "left" | "right" | "center";
export type Challenge = [Exclude<Pose, "center">, Exclude<Pose, "center">];

/** Ngưỡng sơ bộ — hiệu chỉnh cùng bộ ảnh thử (T011 / scripts/calibrate). */
export const LIVENESS_RULES = {
  centerMaxYaw: 0.12,
  turnMinYaw: 0.2,
  /** Cosine tối thiểu giữa khung nhìn thẳng và mỗi khung quay đầu (cùng một người). */
  samePersonMin: 0.5,
  /** Cạnh ngắn tối thiểu của khung mặt (px); mặt nhỏ hơn (người phía sau) không tính. */
  minFaceSide: 40,
} as const;

export function headYaw(kps: Point[]): number {
  const [le, re, nose] = kps;
  const eyeDist = Math.hypot(re[0] - le[0], re[1] - le[1]);
  if (!(eyeDist > 0)) return Number.NaN;
  return (nose[0] - (le[0] + re[0]) / 2) / eyeDist;
}

export function classifyPose(yaw: number): Pose | "unclear" {
  if (!Number.isFinite(yaw)) return "unclear";
  if (Math.abs(yaw) <= LIVENESS_RULES.centerMaxYaw) return "center";
  if (yaw >= LIVENESS_RULES.turnMinYaw) return "left";
  if (yaw <= -LIVENESS_RULES.turnMinYaw) return "right";
  return "unclear";
}

/** Thứ tự khung mong đợi: [hướng 1, nhìn thẳng, hướng 2] — khung giữa dùng để so với ảnh tham chiếu. */
export function expectedPoses(challenge: Challenge): [Pose, Pose, Pose] {
  return [challenge[0], "center", challenge[1]];
}

export function isChallenge(v: unknown): v is Challenge {
  return Array.isArray(v) && v.length === 2 && v.every((p) => p === "left" || p === "right") && v[0] !== v[1];
}

export type LiveFrameError = "LIVE_NO_FACE" | "LIVE_MULTIPLE_FACES" | "LIVENESS_FAILED";

/** Mỗi khung đúng một khuôn mặt đủ lớn, tư thế đúng chuỗi thử thách. Trả chỉ số khung nhìn thẳng. */
export function checkLiveFrames(
  frames: { box: { x1: number; y1: number; x2: number; y2: number }; kps: Point[] }[][],
  challenge: Challenge,
): { ok: true; centerIndex: number } | { ok: false; error: LiveFrameError } {
  if (frames.length !== 3) return { ok: false, error: "LIVENESS_FAILED" };
  const want = expectedPoses(challenge);
  const faces = frames.map((fs) => fs.filter((f) => Math.min(f.box.x2 - f.box.x1, f.box.y2 - f.box.y1) >= LIVENESS_RULES.minFaceSide));
  if (faces.some((fs) => fs.length === 0)) return { ok: false, error: "LIVE_NO_FACE" };
  if (faces.some((fs) => fs.length > 1)) return { ok: false, error: "LIVE_MULTIPLE_FACES" };
  const poses = faces.map(([f]) => classifyPose(headYaw(f.kps)));
  if (poses.some((p, i) => p !== want[i])) return { ok: false, error: "LIVENESS_FAILED" };
  return { ok: true, centerIndex: 1 };
}

/** Mọi khung cùng một người: cosine giữa khung nhìn thẳng và từng khung khác ≥ min. */
export function samePerson(embeddings: number[][], centerIndex: number, min: number): boolean {
  const c = embeddings[centerIndex];
  return embeddings.every((e, i) => i === centerIndex || cosine(c, e) >= min);
}
