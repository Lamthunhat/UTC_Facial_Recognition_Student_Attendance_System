import type { FaceThresholds } from "./decide";

/**
 * Ngưỡng so khuôn mặt khi điểm danh (FR-035a, FR-036, FR-043) — đọc từ biến môi trường lúc dùng, mặc định theo env.ts.
 * CHỜ HIỆU CHỈNH T011 (bộ ảnh thử ≥ 20 người). Ngưỡng thấp ≥ ngưỡng cao (cấu hình sai) → dùng mặc định cả hai.
 */
export const DEFAULT_FACE_THRESHOLDS: FaceThresholds = { cardReject: 0.35, cardAccept: 0.5, duplicate: 0.45, checkinMatch: 0.55 };

const read = (name: string, fallback: number) => {
  const v = Number(process.env[name] ?? fallback);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
};

export function faceThresholds(): FaceThresholds {
  const d = DEFAULT_FACE_THRESHOLDS;
  let cardReject = read("CARD_REJECT_BELOW", d.cardReject);
  let cardAccept = read("CARD_ACCEPT_ABOVE", d.cardAccept);
  if (cardReject >= cardAccept) [cardReject, cardAccept] = [d.cardReject, d.cardAccept];
  return { cardReject, cardAccept, duplicate: read("DUPLICATE_ABOVE", d.duplicate), checkinMatch: read("CHECKIN_MATCH_ABOVE", d.checkinMatch) };
}
