/**
 * Hướng dẫn quay đầu ở trình duyệt từ keypoint MediaPipe Face Detector (BlazeFace short-range) — CHỈ để hướng dẫn và
 * tự chụp; server vẫn quyết định liveness (face/liveness.ts). Thuần, test được.
 * Yaw tính GIỐNG server với 5 điểm SCRFD (headYaw): trên ảnh KHÔNG lật (khung video gốc),
 * yaw = (mũi.x − trung điểm hai mắt.x) / khoảng cách hai mắt (điểm ảnh). SV quay sang TRÁI của mình → yaw > 0.
 * Ngưỡng client CHẶT HƠN server (nhìn thẳng ≤ 0,08 so với 0,12; quay ≥ 0,28 so với 0,2) để có biên an toàn — BlazeFace
 * (client) và SCRFD (server) đặt keypoint hơi khác nhau. Hiệu chỉnh bằng mặt thật ở /sv/the-sinh-vien/debug.
 */
export type Pt = { x: number; y: number };
export type Pose = "left" | "right" | "center";

export const CLIENT_POSE = { centerMaxYaw: 0.08, turnMinYaw: 0.28, holdMs: 300, stepTimeoutMs: 10_000 } as const;
/** Ngưỡng của SERVER (face/liveness.ts LIVENESS_RULES — có test đối chiếu); chỉ để hiển thị khi hiệu chỉnh. */
export const SERVER_POSE = { centerMaxYaw: 0.12, turnMinYaw: 0.2 } as const;

/** Phân loại yaw theo một bộ ngưỡng — cùng ngữ nghĩa classifyPose của server. */
export function classifyYaw(yaw: number | null, t: { centerMaxYaw: number; turnMinYaw: number }): Pose | "unclear" {
  if (yaw === null || !Number.isFinite(yaw)) return "unclear";
  if (Math.abs(yaw) <= t.centerMaxYaw) return "center";
  if (yaw >= t.turnMinYaw) return "left";
  if (yaw <= -t.turnMinYaw) return "right";
  return "unclear";
}

/** Keypoint BlazeFace (chuẩn hoá 0–1): [0] mắt phải, [1] mắt trái, [2] chóp mũi, [3] miệng, [4] tai phải, [5] tai trái. */
const EYE_A = 0;
const EYE_B = 1;
const NOSE = 2;

/** Yaw từ keypoint chuẩn hoá của khung rộng w × cao h; thiếu điểm / hai mắt trùng → null. */
export function yawFromKeypoints(kps: Pt[], w: number, h: number): number | null {
  const e1 = kps[EYE_A];
  const e2 = kps[EYE_B];
  const nose = kps[NOSE];
  if (!e1 || !e2 || !nose) return null;
  const dist = Math.hypot((e2.x - e1.x) * w, (e2.y - e1.y) * h);
  if (!(dist > 0)) return null;
  return ((nose.x - (e1.x + e2.x) / 2) * w) / dist;
}

const TURN_MSG: Record<Exclude<Pose, "center">, string> = { left: "Quay thêm sang trái", right: "Quay thêm sang phải" };

export function poseGuidance(target: Pose, faces: number, yaw: number | null): { ok: boolean; message: string } {
  if (faces === 0 || yaw === null) return { ok: false, message: "Không thấy khuôn mặt" };
  if (faces > 1) return { ok: false, message: "Chỉ một người trong khung" };
  if (target === "center") return Math.abs(yaw) <= CLIENT_POSE.centerMaxYaw ? { ok: true, message: "Giữ yên" } : { ok: false, message: "Nhìn thẳng" };
  const ok = target === "left" ? yaw >= CLIENT_POSE.turnMinYaw : yaw <= -CLIENT_POSE.turnMinYaw;
  return ok ? { ok: true, message: "Giữ yên" } : { ok: false, message: TURN_MSG[target] };
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
