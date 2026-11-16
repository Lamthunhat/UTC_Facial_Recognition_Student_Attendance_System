import { describe, expect, it } from "vitest";
import { decideFromFacts, type Facts } from "../../../src/attendance/decide";
import { buildRecord, deviceInfo, ipPrefix, type RecordInput } from "../../../src/records/build";
import { attendanceRecordV1 } from "../../../src/records/schema";

/**
 * T069 — Hồ sơ `attendance-record.v1` (FR-112, FR-114) dựng từ kết quả từng bước, kể cả khi dừng sớm.
 * Không bao giờ chứa ảnh, vector khuôn mặt; toạ độ làm tròn 5 chữ số; luôn hợp lệ theo schema Zod.
 */
const T = { cardReject: 0.35, cardAccept: 0.5, duplicate: 0.45, checkinMatch: 0.55 };
const facts: Facts = {
  windowType: "check_in",
  windowOpen: true,
  enrolled: true,
  hasCheckin: false,
  checkoutSkipped: false,
  alreadyDone: false,
  rejectedCount: 0,
  location: { status: "ok", distanceM: 12.345, accuracyM: 15, radiusM: 50, anomalies: [] },
  live: { ok: true },
  cardSimilarity: 0.71234,
  checkinSimilarity: null,
  duplicates: [],
  thresholds: T,
};
const noEvidence = { imageStored: false, imagePurgeAfter: null };
const base = (over: Partial<RecordInput> = {}, f: Partial<Facts> = {}): RecordInput => ({
  ids: {
    session: "11111111-1111-4111-8111-111111111111",
    window: "22222222-2222-4222-8222-222222222222",
    windowType: "check_in",
    studentCode: "231230821",
    attempt: 1,
    scanSession: "33333333-3333-4333-8333-333333333333",
  },
  serverTime: new Date("2026-11-14T00:05:40Z"),
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
  ip: "113.190.12.34",
  location: { lat: 21.027412345, lng: 105.801234567, accuracyM: 15, distanceM: 12.345, radiusM: 50, address: "3 Cầu Giấy, Hà Nội", room: "301-A7-A7", anomalies: [] },
  liveness: { challenge: ["left", "right"], measuredYaw: [0.5521, -0.0934, -0.3211], passed: true, sameFace: 0.93123 },
  image: { facesDetected: [1, 1, 1], faceBoxPx: 212, sharpness: 0.81, frontalYaw: -0.0934, sha256: "a".repeat(64) },
  matching: { card: 0.71234, checkin: null, maxOther: null },
  thresholds: T,
  verdict: decideFromFacts({ ...facts, ...f }),
  evidence: { imageStored: true, imagePurgeAfter: new Date("2026-11-21T00:05:40Z") },
  ...over,
});

const deepKeys = (v: unknown): string[] =>
  v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...deepKeys(x)]) : [];
const arrayLengths = (v: unknown): number[] =>
  Array.isArray(v)
    ? [v.length, ...v.flatMap(arrayLengths)]
    : v && typeof v === "object"
      ? Object.values(v).flatMap(arrayLengths)
      : [];

describe("buildRecord", () => {
  it("lượt đủ bước: đủ trường, làm tròn, hợp lệ schema", () => {
    const r = buildRecord(base());
    expect(attendanceRecordV1.safeParse(r).success).toBe(true);
    expect(r.schema).toBe("attendance-record.v1");
    expect(r.location).toMatchObject({ lat: 21.02741, lng: 105.80123, distanceM: 12.3 });
    expect(r.matching?.card).toBe(0.712);
    expect(r.liveness?.measuredYaw).toEqual([0.552, -0.093, -0.321]);
    expect(r.decision).toEqual({ result: "valid", reason: "ok", flags: [] });
    expect(r.device).toEqual({ browser: "Safari 18.4", os: "iOS 18.4", ipPrefix: "113.190.x.x" });
    expect(r.serverTime).toBe("2026-11-14T00:05:40.000Z");
    expect(r.evidence).toEqual({ imageStored: true, imagePurgeAfter: "2026-11-21T00:05:40.000Z" });
    expect(r.versions.rules).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("dừng ở bước 2 (khung đóng): chưa có vị trí/liveness/ảnh/so khớp", () => {
    const r = buildRecord(
      base({ location: null, liveness: null, image: null, matching: null, evidence: noEvidence }, { windowOpen: false }),
    );
    expect(attendanceRecordV1.safeParse(r).success).toBe(true);
    expect(r.decision).toMatchObject({ result: "rejected", reason: "window_closed" });
    expect(r.steps).toEqual([{ step: "window_open", ok: false }]);
    expect(r.location).toBeNull();
  });

  it("dừng ở bước 3 (ngoài phạm vi): có vị trí, không có khuôn mặt", () => {
    const loc = { ...base().location!, distanceM: 512 };
    const r = buildRecord(
      base(
        { location: loc, liveness: null, image: null, matching: null, evidence: noEvidence },
        { location: { status: "out_of_range", distanceM: 512, accuracyM: 15, radiusM: 50, anomalies: [] } },
      ),
    );
    expect(attendanceRecordV1.safeParse(r).success).toBe(true);
    expect(r.decision.reason).toBe("out_of_range");
    expect(r.liveness).toBeNull();
    expect(r.steps.at(-1)).toEqual({ step: "distance", ok: false, detail: "512 m > 50 m" });
  });

  it("dừng ở bước 5 (liveness hỏng): có liveness, không có so thẻ", () => {
    const r = buildRecord(
      base(
        {
          liveness: { challenge: ["left", "right"], measuredYaw: [0.01, 0, -0.02], passed: false, sameFace: null },
          matching: null,
          evidence: noEvidence,
        },
        { live: { ok: false, error: "LIVENESS_FAILED" } },
      ),
    );
    expect(attendanceRecordV1.safeParse(r).success).toBe(true);
    expect(r.decision.reason).toBe("liveness_failed");
    expect(r.matching).toBeNull();
  });

  it("dừng ở bước 7 (trùng mặt): ghi mã + độ tương đồng cao nhất với mã khác", () => {
    const r = buildRecord(
      base(
        { matching: { card: 0.7, checkin: null, maxOther: { similarity: 0.8123, studentCode: "231230802" } } },
        { duplicates: [{ eventId: "e1", studentCode: "231230802", similarity: 0.8123 }] },
      ),
    );
    expect(r.decision).toMatchObject({ result: "suspect", reason: "duplicate_face" });
    expect(r.matching?.maxOther).toEqual({ similarity: 0.812, studentCode: "231230802" });
  });

  it("KHÔNG chứa ảnh hay vector khuôn mặt (FR-114)", () => {
    const r = buildRecord(base());
    expect(deepKeys(r).filter((k) => /embedding|vector|imageData|base64|jpeg|^frames?$/i.test(k))).toEqual([]);
    expect(Math.max(0, ...arrayLengths(r))).toBeLessThan(20);
    expect(JSON.stringify(r).length).toBeLessThan(4000);
  });

  it("schema từ chối trường lạ (strict), ví dụ vector", () => {
    const r = buildRecord(base()) as Record<string, unknown>;
    expect(attendanceRecordV1.safeParse({ ...r, embedding: [0.1, 0.2] }).success).toBe(false);
  });
});

describe("thông tin thiết bị rút gọn", () => {
  it.each([
    [
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      "Chrome 140",
      "Android 15",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
      "Chrome 140",
      "iOS 18.4",
    ],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0", "Firefox 145", "Windows"],
    ["curl/8.0", "khác", "khác"],
  ])("%s", (ua, browser, os) => {
    expect(deviceInfo(ua)).toEqual({ browser, os });
  });
  it("IP rút gọn", () => {
    expect(ipPrefix("113.190.12.34")).toBe("113.190.x.x");
    expect(ipPrefix("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:x");
    expect(ipPrefix(null)).toBeNull();
  });
});
