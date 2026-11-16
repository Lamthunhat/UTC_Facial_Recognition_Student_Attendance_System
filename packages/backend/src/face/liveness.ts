import { classifyFaceYaw, faceYaw, type YawPose } from "@utc/shared/face-yaw";
import { SERVER_YAW } from "@utc/shared/face-yaw-thresholds";
import type { Point } from "./align";
import { cosine } from "./similarity";

/**
 * Liveness bằng thử thách quay đầu do server cấp kèm nonce (research R2, Principle I). Hàm thuần.
 * Yaw từ 5 điểm mốc SCRFD [mắt, mắt, mũi, mép, mép] + bbox mặt, CÙNG công thức với client (@utc/shared/face-yaw):
 * kẹp(5 × (mũi.x − tâm 2 mắt.x) / bề rộng bbox, ±1) — không chia cho khoảng cách 2 mắt (→ 0 khi quay mạnh, ra -41 và
 * đổi dấu khi thử thật). Ảnh camera trước KHÔNG lật: SV quay sang TRÁI của mình → mũi lệch PHẢI ảnh → yaw > 0.
 * Ngưỡng SERVER_YAW (thẳng ≤ 0,18 · quay 0,22–0,80; > 0,80 = quay quá mạnh, KHÔNG phải khung quay hợp lệ).
 * Dùng chung cho đăng ký thẻ (FR-045a) và điểm danh (Phase 5).
 */
export type Pose = "left" | "right" | "center";
export type Challenge = [Exclude<Pose, "center">, Exclude<Pose, "center">];

/** Ngưỡng yaw: SERVER_YAW trong @utc/shared/face-yaw-thresholds. Ngưỡng khác — hiệu chỉnh cùng bộ ảnh thử (T011). */
export const LIVENESS_RULES = {
  /** Cosine tối thiểu giữa khung nhìn thẳng và mỗi khung quay đầu (cùng một người). */
  samePersonMin: 0.5,
  /** Cạnh ngắn tối thiểu của khung mặt (px); mặt nhỏ hơn (người phía sau) không tính. */
  minFaceSide: 40,
} as const;

type Box = { x1: number; y1: number; x2: number; y2: number };

/** Yaw thang mới [-1, 1]; điểm mốc / bbox hỏng → NaN. */
export function headYaw(kps: Point[], box: Box): number {
  const [a, b, nose] = kps;
  if (!a || !b || !nose) return Number.NaN;
  const y = faceYaw({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, { x: nose[0], y: nose[1] }, box.x2 - box.x1);
  return y ?? Number.NaN;
}

export function classifyPose(yaw: number): YawPose {
  return classifyFaceYaw(Number.isFinite(yaw) ? yaw : null, SERVER_YAW);
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
  // "too_far" / "unclear" không bao giờ khớp tư thế mong đợi → LIVENESS_FAILED
  const poses = faces.map(([f]) => classifyPose(headYaw(f.kps, f.box)));
  if (poses.some((p, i) => p !== want[i])) return { ok: false, error: "LIVENESS_FAILED" };
  return { ok: true, centerIndex: 1 };
}

/** Mọi khung cùng một người: cosine giữa khung nhìn thẳng và từng khung khác ≥ min. */
export function samePerson(embeddings: number[][], centerIndex: number, min: number): boolean {
  const c = embeddings[centerIndex];
  return embeddings.every((e, i) => i === centerIndex || cosine(c, e) >= min);
}
