import { describe, expect, it } from "vitest";
import { narrate } from "../../../src/records/narrative";
import type { AttendanceRecordV1 } from "../../../src/records/schema";

/** T070 — Diễn giải tiếng Việt theo mẫu cố định (FR-113, không AI) cho mỗi `reason`. Giờ hiển thị theo giờ VN. */
const T = { cardReject: 0.35, cardAccept: 0.5, duplicate: 0.45, checkinMatch: 0.55 };
const LOC = { lat: 21.02741, lng: 105.80123, accuracyM: 18, distanceM: 128, radiusM: 50, address: null, room: "301-A7-A7", anomalies: [] };
const IDS = { session: "s", window: "w", windowType: "check_in" as const, studentCode: "231230821", attempt: 1, scanSession: null };
const rec = (over: Partial<AttendanceRecordV1>): AttendanceRecordV1 => ({
  schema: "attendance-record.v1",
  ids: IDS,
  serverTime: "2026-11-14T00:05:40.000Z",
  device: null,
  location: LOC,
  liveness: { challenge: ["left", "right"], measuredYaw: [0.5, 0, -0.4], passed: true, sameFace: 0.93 },
  image: { facesDetected: [1, 1, 1], faceBoxPx: 200, sharpness: 0.8, frontalYaw: 0, sha256: null },
  matching: { card: 0.71, checkin: null, maxOther: null, thresholds: T },
  steps: [],
  decision: { result: "valid", reason: "ok", flags: [] },
  versions: { faceModel: "w600k_mbf", detector: "scrfd-500m", rules: "2026-11-17" },
  evidence: { imageStored: true, imagePurgeAfter: null },
  ...over,
});
const early = { location: null, liveness: null, image: null, matching: null };

describe("narrate", () => {
  it("hợp lệ: giờ VN, loại khung, lượt, các số đo, kết luận", () => {
    expect(narrate(rec({ location: { ...LOC, distanceM: 12 } }))).toBe(
      "07:05:40 · Check-in lượt 1 · Cách tâm 12 m (sai số 18 m, bán kính 50 m) · liveness đạt (trái → phải) · khớp thẻ 0.71 (đạt ≥ 0.50) → Hợp lệ.",
    );
  });

  it.each<[string, Partial<AttendanceRecordV1>, RegExp]>([
    [
      "out_of_range",
      { decision: { result: "rejected", reason: "out_of_range", flags: [] }, liveness: null, matching: null },
      /Cách tâm 128 m \(sai số 18 m\) > bán kính 50 m → Từ chối: ngoài phạm vi\.$/,
    ],
    [
      "low_accuracy",
      { decision: { result: "retry", reason: "low_accuracy", flags: [] }, location: { ...LOC, accuracyM: 150 }, liveness: null, matching: null },
      /sai số vị trí 150 m > 100 m → Yêu cầu thử lại: vị trí chưa đủ chính xác\.$/,
    ],
    ["no_face", { decision: { result: "retry", reason: "no_face", flags: [] }, matching: null }, /→ Yêu cầu chụp lại: không thấy khuôn mặt\.$/],
    [
      "multiple_faces",
      { decision: { result: "retry", reason: "multiple_faces", flags: [] }, matching: null },
      /→ Yêu cầu chụp lại: có nhiều khuôn mặt\.$/,
    ],
    [
      "liveness_failed",
      {
        decision: { result: "rejected", reason: "liveness_failed", flags: [] },
        liveness: { challenge: ["left", "right"], measuredYaw: [0, 0, 0], passed: false, sameFace: null },
        matching: null,
      },
      /liveness KHÔNG đạt \(trái → phải\) → Từ chối: chưa chứng minh được người thật\.$/,
    ],
    [
      "card_mismatch",
      { decision: { result: "rejected", reason: "card_mismatch", flags: [] }, matching: { card: 0.2, checkin: null, maxOther: null, thresholds: T } },
      /khớp thẻ 0\.20 \(< 0\.35\) → Từ chối: khuôn mặt không khớp ảnh thẻ\.$/,
    ],
    [
      "card_borderline",
      {
        decision: { result: "suspect", reason: "card_borderline", flags: ["card_borderline"] },
        matching: { card: 0.42, checkin: null, maxOther: null, thresholds: T },
      },
      /khớp thẻ 0\.42 \(vùng biên 0\.35–0\.50\) → Nghi vấn: khớp thẻ ở vùng biên\.$/,
    ],
    [
      "duplicate_face",
      {
        decision: { result: "suspect", reason: "duplicate_face", flags: ["duplicate_face"] },
        matching: { card: 0.7, checkin: null, maxOther: { similarity: 0.81, studentCode: "231230802" }, thresholds: T },
      },
      /trùng mặt mã 231230802 \(0\.81 ≥ 0\.45\) → Nghi vấn: khuôn mặt trùng mã khác trong khung\.$/,
    ],
    [
      "checkin_mismatch",
      {
        ids: { ...IDS, windowType: "check_out" },
        decision: { result: "suspect", reason: "checkin_mismatch", flags: ["checkin_mismatch"] },
        matching: { card: 0.7, checkin: 0.3, maxOther: null, thresholds: T },
      },
      /^07:05:40 · Check-out lượt 1 .*so lượt check-in 0\.30 \(< 0\.55\) → Nghi vấn: khuôn mặt khác lượt check-in\.$/,
    ],
    [
      "gps_anomaly",
      {
        decision: { result: "suspect", reason: "gps_anomaly", flags: ["gps_anomaly"] },
        location: { ...LOC, distanceM: 10, accuracyM: 0.5, anomalies: ["implausible_accuracy"] },
      },
      /vị trí bất thường: độ chính xác phi thực tế → Nghi vấn: vị trí bất thường\.$/,
    ],
    [
      "window_closed",
      { decision: { result: "rejected", reason: "window_closed", flags: [] }, ...early },
      /^07:05:40 · Check-in lượt 1 → Từ chối: hết giờ điểm danh\.$/,
    ],
    ["not_enrolled", { decision: { result: "rejected", reason: "not_enrolled", flags: [] }, ...early }, /→ Từ chối: không có trong danh sách lớp\.$/],
    [
      "no_checkin",
      { ids: { ...IDS, windowType: "spot_check" }, decision: { result: "rejected", reason: "no_checkin", flags: [] }, ...early },
      /^07:05:40 · Kiểm tra đột xuất lượt 1 → Từ chối: chưa check-in hợp lệ trong buổi\.$/,
    ],
    ["already_done", { decision: { result: "rejected", reason: "already_done", flags: [] }, ...early }, /→ Từ chối: đã điểm danh trong khung này\.$/],
    [
      "attempts_exhausted",
      { decision: { result: "rejected", reason: "attempts_exhausted", flags: [] }, ...early },
      /→ Từ chối: hết lượt thử trong khung\.$/,
    ],
  ])("%s", (_r, over, re) => {
    expect(narrate(rec(over))).toMatch(re);
  });

  it("nhiều cờ: kết luận theo lý do chính, liệt kê cờ phụ", () => {
    const s = narrate(
      rec({
        decision: { result: "suspect", reason: "duplicate_face", flags: ["card_borderline", "duplicate_face"] },
        matching: { card: 0.42, checkin: null, maxOther: { similarity: 0.81, studentCode: "231230802" }, thresholds: T },
      }),
    );
    expect(s).toMatch(/→ Nghi vấn: khuôn mặt trùng mã khác trong khung; kèm: khớp thẻ ở vùng biên\.$/);
  });
});
