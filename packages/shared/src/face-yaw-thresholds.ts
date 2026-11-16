/**
 * Ngưỡng yaw client ↔ server — NGUỒN DUY NHẤT (client `@/lib/student/face-pose`, server `face/liveness.ts`, công cụ
 * yaw-debug và trang chẩn đoán đều import từ đây). Thang yaw: `faceYaw` trong ./face-yaw.ts.
 *
 * Hiệu chỉnh 2026-11-17 theo số đo iPhone thật ("Thử liveness", Vercel Preview), client C (MediaPipe) / server S (SCRFD):
 *   trái C 0,501 / S 0,552 · thẳng C −0,088 / S −0,093 · phải C −0,410 / S −0,321
 * → ở chiều quay, |S| có thể thấp hơn |C| ~0,09. Ngưỡng quay server cũ 0,30 chỉ chừa biên 0,10 dưới mốc client 0,40:
 * SV quay vừa đủ theo client (0,40) mà server đo thấp hơn 0,09 → 0,31, sát mép → dễ `LIVENESS_FAILED` oan.
 * Chọn server.turnMin = 0,22: biên 0,18 (~2× độ lệch đo được) mà vẫn cách vùng thẳng (≤ 0,18) một vùng đệm 0,04.
 *
 * Biên an toàn (YAW_MARGINS, test bất biến trong tests/face-yaw-thresholds.test.ts):
 *   client.turnMin − server.turnMin ≥ 0,15 · server.centerMax − client.centerMax ≥ 0,05 ·
 *   server.turnMax − client.turnMax ≥ 0,10 · server.centerMax < server.turnMin (không chồng lấn).
 * Client CHẶT HƠN server ở cả ba mốc: client chụp ở đâu thì server (đo lệch tới ~biên) vẫn chấp nhận.
 */
export interface YawThresholds {
  /** |yaw| ≤ centerMax → nhìn thẳng ("thẳng tối đa"). */
  centerMax: number;
  /** turnMin ≤ |yaw| ≤ turnMax → quay hợp lệ (dấu cho biết hướng). */
  turnMin: number;
  /** |yaw| > turnMax → quay quá mạnh: KHÔNG phải khung quay hợp lệ. */
  turnMax: number;
}

/** SERVER (quyết định liveness). Góc theo mô hình đầu: thẳng ~10° · quay ~13°–72°. Chờ hiệu chỉnh tiếp T011. */
export const SERVER_YAW: YawThresholds = { centerMax: 0.18, turnMin: 0.22, turnMax: 0.8 };
/** CLIENT (chỉ hướng dẫn + tự chụp): thẳng ~7° · quay ~25°–48°. */
export const CLIENT_YAW: YawThresholds = { centerMax: 0.12, turnMin: 0.4, turnMax: 0.65 };

/** Biên tối thiểu bắt buộc giữa ngưỡng client và server. */
export const YAW_MARGINS = { turnMin: 0.15, centerMax: 0.05, turnMax: 0.1 } as const;

export type YawMarginViolation = "turnMin" | "centerMax" | "turnMax" | "serverOverlap";

const EPS = 1e-9; // sai số dấu phẩy động (0,40 − 0,25 = 0,15000000000000002)

/** Danh sách biên bị vi phạm (rỗng = hợp lệ). */
export function yawMarginViolations(server: YawThresholds, client: YawThresholds): YawMarginViolation[] {
  const v: YawMarginViolation[] = [];
  if (client.turnMin - server.turnMin < YAW_MARGINS.turnMin - EPS) v.push("turnMin");
  if (server.centerMax - client.centerMax < YAW_MARGINS.centerMax - EPS) v.push("centerMax");
  if (server.turnMax - client.turnMax < YAW_MARGINS.turnMax - EPS) v.push("turnMax");
  if (!(server.centerMax < server.turnMin && server.turnMin < server.turnMax)) v.push("serverOverlap");
  return v;
}
