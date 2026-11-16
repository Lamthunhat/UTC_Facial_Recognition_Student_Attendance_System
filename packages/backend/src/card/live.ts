import "server-only";
import { checkLiveFrames, LIVENESS_RULES, samePerson, type Challenge, type LiveFrameError } from "../face/liveness";
import type { Point } from "../face/align";
import type { YawDebugReason } from "../face/yaw-debug";
import { HttpError } from "../http/errors";
import { sanitizeImage, UploadError, type ImageMime } from "../security/upload";
import type { AnalyzedPortraits } from "./portrait";

/**
 * Pipeline liveness 3 khung mặt trực tiếp (FR-045a) — DÙNG CHUNG cho đăng ký thẻ (register.ts) và công cụ thử liveness
 * (liveness-probe.ts, chỉ preview/dev): sanitize → phân tích từng khung → đúng thử thách quay đầu → cùng một người.
 * Không lưu gì: khung mặt trực tiếp không bao giờ được lưu (FR-051).
 */
export const LIVE_FRAME_MAX_BYTES = 1024 * 1024; // FR-090: mỗi khung mặt trực tiếp ≤ 1 MB
export const LIVE_FRAME_COUNT = 3;
export const ALLOWED_IMAGE_TYPES: ImageMime[] = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export function uploadErrorToHttp(e: UploadError) {
  return e.code === "FILE_TOO_LARGE"
    ? new HttpError(413, "PAYLOAD_TOO_LARGE", "Ảnh vượt quá 1 MB.")
    : new HttpError(422, e.code, e.code === "UNSUPPORTED_TYPE" ? "Ảnh không đúng định dạng (chỉ nhận JPEG/PNG/WebP/HEIC)." : "Không đọc được ảnh. Vui lòng chụp lại.");
}

/** Bỏ EXIF, chuẩn hoá JPEG ≤ 1280 px. Lỗi ảnh → HttpError 413/422. */
export async function sanitizeLiveFrames(frames: Buffer[]): Promise<Buffer[]> {
  if (frames.length !== LIVE_FRAME_COUNT) {
    throw new HttpError(422, "VALIDATION_ERROR", "Cần đúng 3 khung hình khuôn mặt theo hướng dẫn.");
  }
  try {
    return await Promise.all(
      frames.map(async (f) => (await sanitizeImage(f, { maxBytes: LIVE_FRAME_MAX_BYTES, allowed: ALLOWED_IMAGE_TYPES, maxSide: 1280, quality: 85 })).buffer),
    );
  } catch (e) {
    if (e instanceof UploadError) throw uploadErrorToHttp(e);
    throw e;
  }
}

export type LiveFaces = { box: { x1: number; y1: number; x2: number; y2: number }; kps: Point[] }[][];

export type LiveResult =
  | { ok: true; centerIndex: number; embeddings: number[][]; faces: LiveFaces }
  | { ok: false; error: LiveFrameError; reason: YawDebugReason; faces: LiveFaces };

/** Phân tích 3 khung ĐÃ sanitize theo thử thách. `reason` tách "sai tư thế" khỏi "không cùng một người" (cho yawDebug). */
export async function evaluateLiveFrames(
  frames: Buffer[],
  challenge: Challenge,
  analyze: (jpeg: Buffer) => Promise<AnalyzedPortraits>,
): Promise<LiveResult> {
  const live = await Promise.all(frames.map((f) => analyze(f)));
  const faces: LiveFaces = live.map((l) => l.faces.filter((f) => f.kps).map((f) => ({ box: f.box, kps: f.kps! })));
  const check = checkLiveFrames(faces, challenge);
  if (!check.ok) return { ok: false, error: check.error, reason: check.error, faces };
  const embeddings = await Promise.all(live.map((l) => l.embed(0)));
  if (!samePerson(embeddings, check.centerIndex, LIVENESS_RULES.samePersonMin)) {
    return { ok: false, error: "LIVENESS_FAILED", reason: "SAME_PERSON_FAILED", faces };
  }
  return { ok: true, centerIndex: check.centerIndex, embeddings, faces };
}
