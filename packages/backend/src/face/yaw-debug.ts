import type { YawPose } from "@utc/shared/face-yaw";
import { CLIENT_YAW, SERVER_YAW, type YawThresholds } from "@utc/shared/face-yaw-thresholds";
import type { Point } from "./align";
import { classifyPose, expectedPoses, headYaw, LIVENESS_RULES, type Challenge, type LiveFrameError, type Pose } from "./liveness";

/**
 * Công cụ so sánh yaw client ↔ server — CHỈ preview/dev (hiệu chỉnh ngưỡng bằng mặt thật, research R2 / T011).
 * Bật: client gửi yaw lúc chụp từng khung (`clientYaw`), server trả yaw SCRFD từng khung + tư thế + lý do lỗi (`yawDebug`).
 * Production: TẮT hoàn toàn — nonce không báo, `clientYaw` bị bỏ qua, phản hồi không kèm, không ghi log.
 * Chỉ số tư thế đầu (không phải dữ liệu nhận dạng): không có embedding, ảnh hay độ tương đồng.
 */

/**
 * Bật khi: Vercel Preview (VERCEL_ENV=preview), `vercel dev` (VERCEL_ENV=development), hoặc `pnpm dev` cục bộ
 * (NODE_ENV=development, không trên Vercel). Mọi trường hợp khác — kể cả Vercel thiếu VERCEL_ENV — tắt (fail closed).
 */
export function yawDebugEnabled(src: Record<string, string | undefined> = process.env): boolean {
  if (src.VERCEL_ENV !== undefined) return src.VERCEL_ENV === "preview" || src.VERCEL_ENV === "development";
  if (src.VERCEL === "1") return false;
  return src.NODE_ENV === "development";
}

/** `clientYaw` = chuỗi JSON 3 phần tử (số trong [-1, 1] hoặc null). Sai định dạng → null (bỏ qua, không lỗi). */
export function parseClientYaw(raw: unknown): (number | null)[] | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length !== 3) return null;
  const ok = v.every((x) => x === null || (typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1));
  return ok ? (v as (number | null)[]) : null;
}

export type YawDebugReason = LiveFrameError | "SAME_PERSON_FAILED";

export interface YawFrameReport {
  frame: number;
  expected: Pose;
  /** Số mặt đủ lớn (≥ minFaceSide) — 0 / > 1 thì không tính yaw. */
  faces: number;
  serverYaw: number | null;
  serverPose: YawPose | "no_face" | "multiple_faces";
  clientYaw: number | null;
  ok: boolean;
}

export interface YawDebugReport {
  thresholds: { server: YawThresholds; client: YawThresholds };
  frames: YawFrameReport[];
  /** Lý do lỗi liveness (null = qua). SAME_PERSON_FAILED: tư thế đúng nhưng 3 khung không cùng một người. */
  reason: YawDebugReason | null;
}

type Face = { box: { x1: number; y1: number; x2: number; y2: number }; kps: Point[] };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Hàm thuần: cùng luật lọc mặt + phân loại tư thế với checkLiveFrames. */
export function yawDebugReport(
  frames: Face[][],
  challenge: Challenge,
  clientYaw: (number | null)[] | null,
  reason: YawDebugReason | null,
): YawDebugReport {
  const want = expectedPoses(challenge);
  return {
    thresholds: { server: SERVER_YAW, client: CLIENT_YAW },
    reason,
    frames: frames.slice(0, 3).map((fs, i) => {
      const faces = fs.filter((f) => Math.min(f.box.x2 - f.box.x1, f.box.y2 - f.box.y1) >= LIVENESS_RULES.minFaceSide);
      const base = { frame: i + 1, expected: want[i], faces: faces.length, clientYaw: clientYaw?.[i] ?? null };
      if (faces.length !== 1) return { ...base, serverYaw: null, serverPose: faces.length ? "multiple_faces" : "no_face", ok: false };
      const yaw = headYaw(faces[0].kps, faces[0].box);
      const pose = classifyPose(yaw);
      return { ...base, serverYaw: Number.isFinite(yaw) ? round3(yaw) : null, serverPose: pose, ok: pose === want[i] };
    }),
  };
}
