/**
 * Hướng dẫn quay đầu ở trình duyệt từ điểm mốc MediaPipe Face Landmarker — CHỈ để hướng dẫn và tự chụp; server vẫn
 * quyết định liveness (face/liveness.ts). Thuần, test được.
 * Yaw cùng quy ước server: trên ảnh KHÔNG lật (khung video gốc), yaw = (mũi.x − trung điểm hai mắt.x) / khoảng cách hai
 * mắt (điểm ảnh). SV quay sang TRÁI của mình → mũi lệch phải ảnh → yaw > 0.
 * Ngưỡng client CHẶT HƠN server (nhìn thẳng ≤ 0,08 so với 0,12; quay ≥ 0,28 so với 0,2) để có biên an toàn — hai mô
 * hình (MediaPipe ở client, SCRFD ở server) ước lượng điểm mốc hơi khác nhau.
 */
export type Pt = { x: number; y: number };
export type Pose = "left" | "right" | "center";

export const CLIENT_POSE = { centerMaxYaw: 0.08, turnMinYaw: 0.28, holdMs: 300, stepTimeoutMs: 10_000 } as const;

// Chỉ số điểm mốc Face Landmarker (478 điểm): mũi, tâm mống mắt, khoé mắt
const NOSE_TIP = 1;
const IRIS = [468, 473] as const;
const EYE_CORNERS = [
  [33, 133],
  [362, 263],
] as const;

const avg = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Yaw từ điểm mốc chuẩn hoá (0–1) của khung rộng w × cao h; thiếu điểm → null. */
export function yawFromLandmarks(lm: Pt[], w: number, h: number): number | null {
  const nose = lm[NOSE_TIP];
  if (!nose) return null;
  let e1: Pt | undefined;
  let e2: Pt | undefined;
  if (lm[IRIS[0]] && lm[IRIS[1]]) {
    e1 = lm[IRIS[0]];
    e2 = lm[IRIS[1]];
  } else if (EYE_CORNERS.flat().every((i) => lm[i])) {
    e1 = avg(lm[EYE_CORNERS[0][0]], lm[EYE_CORNERS[0][1]]);
    e2 = avg(lm[EYE_CORNERS[1][0]], lm[EYE_CORNERS[1][1]]);
  }
  if (!e1 || !e2) return null;
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
