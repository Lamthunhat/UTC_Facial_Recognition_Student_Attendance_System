import { describe, expect, it } from "vitest";
import { attemptsLeft, decideFromFacts, type Facts } from "../../../src/attendance/decide";

/**
 * T066 — Pipeline quyết định một lượt điểm danh (plan.md "Luồng quyết định"): bảng kịch bản.
 * Thứ tự: điều kiện khung/ghi danh/lượt → GPS (sai số, khoảng cách) → khuôn mặt (số mặt, liveness)
 * → so thẻ (2 ngưỡng) → so lượt check-in (check-out/đột xuất) → trùng mặt trong khung → GPS bất thường.
 * Dừng ở bước đầu tiên có kết luận cuối (retry/rejected); các cờ nghi vấn được gom và lượt thành `suspect`.
 */
const T = { cardReject: 0.35, cardAccept: 0.5, duplicate: 0.45, checkinMatch: 0.55 };
const ok: Facts = {
  windowType: "check_in",
  windowOpen: true,
  enrolled: true,
  hasCheckin: false,
  checkoutSkipped: false,
  alreadyDone: false,
  rejectedCount: 0,
  location: { status: "ok", distanceM: 12, accuracyM: 15, radiusM: 50, anomalies: [] },
  live: { ok: true },
  cardSimilarity: 0.72,
  checkinSimilarity: null,
  duplicates: [],
  thresholds: T,
};
const run = (over: Partial<Facts>) => decideFromFacts({ ...ok, ...over });

describe("kết quả cuối theo kịch bản", () => {
  it.each<[string, Partial<Facts>, string, string]>([
    ["mọi bước đạt", {}, "valid", "ok"],
    ["khung đã đóng", { windowOpen: false }, "rejected", "window_closed"],
    ["chưa ghi danh (bị rút giữa chừng)", { enrolled: false }, "rejected", "not_enrolled"],
    ["đã có lượt hợp lệ/nghi vấn trong khung", { alreadyDone: true }, "rejected", "already_done"],
    ["hết 3 lượt thử", { rejectedCount: 3 }, "rejected", "attempts_exhausted"],
    ["check-out khi chưa check-in", { windowType: "check_out", hasCheckin: false }, "rejected", "no_checkin"],
    ["đột xuất khi chưa check-in", { windowType: "spot_check", hasCheckin: false }, "rejected", "no_checkin"],
    ["check-out khi GV đã bỏ check-out", { windowType: "check_out", hasCheckin: true, checkoutSkipped: true }, "rejected", "window_closed"],
    ["sai số GPS > 100 m → thử lại", { location: { ...ok.location!, status: "retry_low_accuracy", accuracyM: 150 } }, "retry", "low_accuracy"],
    ["ngoài phạm vi", { location: { ...ok.location!, status: "out_of_range", distanceM: 500 } }, "rejected", "out_of_range"],
    ["không thấy mặt → thử lại", { live: { ok: false, error: "LIVE_NO_FACE" } }, "retry", "no_face"],
    ["nhiều mặt → thử lại", { live: { ok: false, error: "LIVE_MULTIPLE_FACES" } }, "retry", "multiple_faces"],
    ["sai thử thách quay đầu / ảnh tĩnh", { live: { ok: false, error: "LIVENESS_FAILED" } }, "rejected", "liveness_failed"],
    ["thẻ dưới ngưỡng thấp", { cardSimilarity: 0.2 }, "rejected", "card_mismatch"],
    ["thẻ vùng biên", { cardSimilarity: 0.42 }, "suspect", "card_borderline"],
    ["đúng ngưỡng cao → đạt", { cardSimilarity: 0.5 }, "valid", "ok"],
    ["đúng ngưỡng thấp → vùng biên (không từ chối)", { cardSimilarity: 0.35 }, "suspect", "card_borderline"],
    ["trùng mặt mã khác trong khung", { duplicates: [{ eventId: "e1", studentCode: "231230802", similarity: 0.8 }] }, "suspect", "duplicate_face"],
    ["trùng dưới ngưỡng → không tính", { duplicates: [{ eventId: "e1", studentCode: "231230802", similarity: 0.3 }] }, "valid", "ok"],
    ["check-out mặt khác lượt check-in", { windowType: "check_out", hasCheckin: true, checkinSimilarity: 0.3 }, "suspect", "checkin_mismatch"],
    ["check-out khớp check-in", { windowType: "check_out", hasCheckin: true, checkinSimilarity: 0.8 }, "valid", "ok"],
    ["GPS bất thường", { location: { ...ok.location!, anomalies: ["implausible_accuracy"] } }, "suspect", "gps_anomaly"],
  ])("%s → %s/%s", (_n, over, result, reason) => {
    const v = run(over);
    expect([v.result, v.reason]).toEqual([result, reason]);
  });
});

describe("dừng sớm — không chạy bước sau khi đã có kết luận (không tốn CPU nhận diện)", () => {
  it("ngoài phạm vi: không có bước khuôn mặt", () => {
    const v = run({ location: { ...ok.location!, status: "out_of_range", distanceM: 500 } });
    expect(v.steps.map((s) => s.step)).toEqual(["window_open", "enrolled", "attempts", "gps_accuracy", "distance"]);
    expect(v.steps.at(-1)).toEqual({ step: "distance", ok: false, detail: "500 m > 50 m" });
  });
  it("liveness hỏng: không so thẻ", () => {
    const v = run({ live: { ok: false, error: "LIVENESS_FAILED" } });
    expect(v.steps.map((s) => s.step)).not.toContain("card_match");
  });
  it("check-in không có bước so lượt check-in", () => {
    expect(run({}).steps.map((s) => s.step)).toEqual([
      "window_open", "enrolled", "attempts", "gps_accuracy", "distance", "faces", "liveness", "card_match", "duplicate", "gps_anomaly",
    ]);
  });
});

describe("nhiều cờ nghi vấn → một lý do chính theo mức nghiêm trọng, đủ danh sách cờ", () => {
  it("trùng mặt > lệch check-in > thẻ vùng biên > GPS bất thường", () => {
    const v = run({
      windowType: "spot_check",
      hasCheckin: true,
      checkinSimilarity: 0.2,
      cardSimilarity: 0.4,
      duplicates: [{ eventId: "e1", studentCode: "231230802", similarity: 0.9 }],
      location: { ...ok.location!, anomalies: ["impossible_speed"] },
    });
    expect(v.result).toBe("suspect");
    expect(v.reason).toBe("duplicate_face");
    expect(v.flags).toEqual(["card_borderline", "checkin_mismatch", "duplicate_face", "gps_anomaly"]);
  });
  it("chỉ giữ các lượt trùng vượt ngưỡng (để cập nhật nghi vấn cho lượt kia)", () => {
    const v = run({
      duplicates: [
        { eventId: "e1", studentCode: "A", similarity: 0.9 },
        { eventId: "e2", studentCode: "B", similarity: 0.2 },
      ],
    });
    expect(v.duplicateOf).toEqual(["e1"]);
  });
});

describe("lượt thử (FR-040: tối đa 3 lượt bị từ chối/khung; retry không tính)", () => {
  it("chỉ rejected tính lượt; retry/valid/suspect không", () => {
    expect(run({ cardSimilarity: 0.1 }).countsAsAttempt).toBe(true);
    expect(run({ live: { ok: false, error: "LIVE_NO_FACE" } }).countsAsAttempt).toBe(false);
    expect(run({}).countsAsAttempt).toBe(false);
    expect(run({ windowOpen: false }).countsAsAttempt).toBe(false); // lỗi của khung, không phải của SV
  });
  it("attemptsLeft", () => {
    expect(attemptsLeft(0)).toBe(3);
    expect(attemptsLeft(2)).toBe(1);
    expect(attemptsLeft(5)).toBe(0);
  });
});
