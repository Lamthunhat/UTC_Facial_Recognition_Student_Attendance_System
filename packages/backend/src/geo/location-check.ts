import { haversineMeters, type LatLng } from "./haversine";

/**
 * Kiểm GPS của một lượt điểm danh (FR-034, research R17). Toạ độ do thiết bị gửi — KHÔNG thể chứng minh là thật ở
 * server (app giả vị trí trên Android, công cụ dev trên máy tính). Lớp bảo vệ chính là khuôn mặt + thẻ; GPS chỉ chặn
 * người ở xa một cách "trung thực". Vì vậy:
 *  - sai số > 100 m → thử lại (không tính lượt); ngoài bán kính → từ chối;
 *  - dấu hiệu giả mạo KHÔNG tự từ chối, chỉ gắn cờ → lượt thành "nghi vấn" để GV quyết (Constitution III):
 *      · `implausible_accuracy`: độ chính xác < 1 m (GPS điện thoại thật không đạt; app giả hay báo 0–1 m);
 *      · `impossible_speed`: so với lượt trước của chính SV trong cùng khung, tốc độ di chuyển > 50 m/s sau khi đã
 *        trừ sai số của cả hai lần đo (đứng trong lớp rồi "nhảy" tới chỗ khác hoặc ngược lại).
 */
export const GPS_RULES = {
  /** FR-034: sai số vượt ngưỡng → yêu cầu thử lại thay vì từ chối. */
  accuracyMaxM: 100,
  /** Giới hạn trên của trường accuracyM (đầu vào vô lý → 422). */
  accuracyInputMaxM: 100_000,
  implausibleAccuracyBelowM: 1,
  maxSpeedMps: 50,
} as const;

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

const NUM_RE = /^-?\d+(\.\d+)?(e-?\d+)?$/i;
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !NUM_RE.test(v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Đọc lat/lng/accuracyM từ form (chuỗi) — sai → null (API trả 422 trước khi xử lý ảnh). */
export function parseGpsFix(src: Record<string, unknown>): GpsFix | null {
  const lat = num(src.lat);
  const lng = num(src.lng);
  const accuracyM = num(src.accuracyM);
  if (lat === null || lng === null || accuracyM === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (!(accuracyM > 0) || accuracyM > GPS_RULES.accuracyInputMaxM) return null;
  return { lat, lng, accuracyM };
}

export type GpsAnomaly = "implausible_accuracy" | "impossible_speed";
export type LocationStatus = "ok" | "retry_low_accuracy" | "out_of_range";

export interface LocationAssessment {
  status: LocationStatus;
  distanceM: number;
  accuracyM: number;
  radiusM: number;
  anomalies: GpsAnomaly[];
}

export function assessLocation(
  fix: GpsFix,
  center: LatLng,
  radiusM: number,
  opts: { now: Date; prior?: (GpsFix & { at: Date }) | null },
): LocationAssessment {
  const distanceM = haversineMeters(center, fix);
  const anomalies: GpsAnomaly[] = [];
  if (fix.accuracyM < GPS_RULES.implausibleAccuracyBelowM) anomalies.push("implausible_accuracy");
  if (opts.prior) {
    const moved = haversineMeters(opts.prior, fix) - fix.accuracyM - opts.prior.accuracyM;
    const dt = Math.max(1, (opts.now.getTime() - opts.prior.at.getTime()) / 1000);
    if (moved > 0 && moved / dt > GPS_RULES.maxSpeedMps) anomalies.push("impossible_speed");
  }
  const status: LocationStatus =
    fix.accuracyM > GPS_RULES.accuracyMaxM ? "retry_low_accuracy" : distanceM > radiusM ? "out_of_range" : "ok";
  return { status, distanceM, accuracyM: fix.accuracyM, radiusM, anomalies };
}
