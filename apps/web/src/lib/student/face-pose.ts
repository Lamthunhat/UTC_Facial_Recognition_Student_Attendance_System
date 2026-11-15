import { classifyFaceYaw, CLIENT_YAW, faceYaw, type YawPose, type YawThresholds } from "@utc/shared/face-yaw";

/**
 * Hướng dẫn quay đầu ở trình duyệt từ MediaPipe Face Detector (BlazeFace short-range) — CHỈ để hướng dẫn và tự chụp;
 * server vẫn quyết định liveness (face/liveness.ts). Thuần, test được.
 * Yaw CÙNG công thức server (@utc/shared/face-yaw): kẹp(5 × (mũi.x − tâm 2 mắt.x) / bề rộng bbox, ±1), ảnh KHÔNG lật;
 * SV quay sang TRÁI của mình → yaw > 0. Ngưỡng CLIENT_YAW (thẳng ≤ 0,12 · quay 0,40–0,65; > 0,65 = "Quay vừa phải")
 * chặt hơn server ở cả ba mốc — BlazeFace (client) và SCRFD (server) đặt keypoint hơi khác nhau.
 * Hiệu chỉnh bằng mặt thật ở /sv/the-sinh-vien/debug.
 */
export type Pt = { x: number; y: number };
export type Pose = "left" | "right" | "center";

export const CLIENT_POSE = { ...CLIENT_YAW, holdMs: 300, stepTimeoutMs: 10_000 } as const;

/** Keypoint BlazeFace (chuẩn hoá 0–1): [0] mắt phải, [1] mắt trái, [2] chóp mũi, [3] miệng, [4] tai phải, [5] tai trái. */
const EYE_A = 0;
const EYE_B = 1;
const NOSE = 2;

/** Yaw từ keypoint chuẩn hoá + bề rộng bbox (điểm ảnh) của khung rộng w × cao h; thiếu điểm / bbox rỗng → null. */
export function yawFromKeypoints(kps: Pt[], boxWidthPx: number, w: number, h: number): number | null {
  const [a, b, nose] = [kps[EYE_A], kps[EYE_B], kps[NOSE]];
  if (!a || !b || !nose) return null;
  const px = (p: Pt) => ({ x: p.x * w, y: p.y * h });
  return faceYaw(px(a), px(b), px(nose), boxWidthPx);
}

/** Phân loại yaw theo một bộ ngưỡng — cùng ngữ nghĩa server (thẳng / trái / phải / quá mạnh / chưa rõ). */
export function classifyYaw(yaw: number | null, t: YawThresholds): YawPose {
  return classifyFaceYaw(yaw, t);
}

const TURN_MSG: Record<Exclude<Pose, "center">, string> = { left: "Quay thêm sang trái", right: "Quay thêm sang phải" };

export function poseGuidance(target: Pose, faces: number, yaw: number | null): { ok: boolean; message: string } {
  if (faces === 0 || yaw === null) return { ok: false, message: "Không thấy khuôn mặt" };
  if (faces > 1) return { ok: false, message: "Chỉ một người trong khung" };
  const pose = classifyFaceYaw(yaw, CLIENT_YAW);
  if (target === "center") return pose === "center" ? { ok: true, message: "Giữ yên" } : { ok: false, message: "Nhìn thẳng" };
  // Đúng hướng nhưng quá mạnh → server không nhận là khung quay hợp lệ
  if (pose === "too_far" && Math.sign(yaw) === (target === "left" ? 1 : -1)) return { ok: false, message: "Quay vừa phải" };
  return pose === target ? { ok: true, message: "Giữ yên" } : { ok: false, message: TURN_MSG[target] };
}

export type TrackStatus = "searching" | "adjust" | "hold" | "capture" | "timeout";

/**
 * Theo dõi một khung: đạt góc liên tục ≥ holdMs → "capture"; quá stepTimeoutMs chưa chụp → "timeout" (nhắc lại) rồi
 * tự đếm lại thời gian từ thời điểm đó.
 */
export function createPoseTracker(target: Pose, startMs: number) {
  let start = startMs;
  let holdStart: number | null = null;
  return {
    feed(now: number, faces: number, yaw: number | null): { status: TrackStatus; message: string } {
      const g = poseGuidance(target, faces, yaw);
      if (now - start >= CLIENT_POSE.stepTimeoutMs) {
        start = now;
        holdStart = null;
        return { status: "timeout", message: `Chưa đạt tư thế — ${g.message}` };
      }
      if (faces === 0 || yaw === null) {
        holdStart = null;
        return { status: "searching", message: g.message };
      }
      if (!g.ok) {
        holdStart = null;
        return { status: "adjust", message: g.message };
      }
      holdStart ??= now;
      return now - holdStart >= CLIENT_POSE.holdMs ? { status: "capture", message: g.message } : { status: "hold", message: g.message };
    },
  };
}
