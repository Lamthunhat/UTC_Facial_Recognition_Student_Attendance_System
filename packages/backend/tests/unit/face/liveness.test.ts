import { describe, expect, it } from "vitest";
import type { Point } from "../../../src/face/align";
import { checkLiveFrames, classifyPose, expectedPoses, headYaw, LIVENESS_RULES, samePerson } from "../../../src/face/liveness";

/**
 * Liveness bằng thử thách quay đầu (research R2): yaw ước lượng từ 5 điểm mốc SCRFD
 * [mắt trái ảnh, mắt phải ảnh, mũi, mép trái, mép phải]. Ảnh camera trước KHÔNG lật:
 * SV quay đầu sang TRÁI của mình → mũi lệch sang PHẢI ảnh → yaw > 0.
 */
const kps = (noseOffset: number): Point[] => [
  [100, 100], // mắt (trái ảnh)
  [160, 100], // mắt (phải ảnh)
  [130 + noseOffset * 60, 130], // mũi
  [108, 160],
  [152, 160],
];
const face = (noseOffset: number, side = 120) => ({ box: { x1: 70, y1: 60, x2: 70 + side, y2: 60 + side * 1.2 }, kps: kps(noseOffset) });

describe("headYaw / classifyPose", () => {
  it("nhìn thẳng ≈ 0; mũi lệch phải ảnh → dương; lệch trái → âm", () => {
    expect(headYaw(kps(0))).toBeCloseTo(0, 5);
    expect(headYaw(kps(0.3))).toBeCloseTo(0.3, 5);
    expect(headYaw(kps(-0.3))).toBeCloseTo(-0.3, 5);
  });

  it("phân loại tư thế theo ngưỡng (có vùng đệm 'unclear' giữa thẳng và quay)", () => {
    expect(classifyPose(0)).toBe("center");
    expect(classifyPose(LIVENESS_RULES.centerMaxYaw - 0.01)).toBe("center");
    expect(classifyPose(LIVENESS_RULES.turnMinYaw + 0.01)).toBe("left");
    expect(classifyPose(-(LIVENESS_RULES.turnMinYaw + 0.01))).toBe("right");
    expect(classifyPose((LIVENESS_RULES.centerMaxYaw + LIVENESS_RULES.turnMinYaw) / 2)).toBe("unclear");
  });

  it("hai mắt trùng nhau (điểm mốc hỏng) → yaw NaN → unclear", () => {
    const bad: Point[] = [[100, 100], [100, 100], [130, 130], [108, 160], [152, 160]];
    expect(classifyPose(headYaw(bad))).toBe("unclear");
  });
});

describe("checkLiveFrames — đúng 3 khung theo thử thách [hướng 1, thẳng, hướng 2]", () => {
  it("thứ tự khung mong đợi", () => {
    expect(expectedPoses(["left", "right"])).toEqual(["left", "center", "right"]);
  });

  it("đúng chuỗi thử thách → ok, khung giữa là khung nhìn thẳng", () => {
    expect(checkLiveFrames([[face(0.3)], [face(0)], [face(-0.3)]], ["left", "right"])).toEqual({ ok: true, centerIndex: 1 });
    expect(checkLiveFrames([[face(-0.3)], [face(0)], [face(0.3)]], ["right", "left"])).toEqual({ ok: true, centerIndex: 1 });
  });

  it("quay ngược chiều thử thách → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(-0.3)], [face(0)], [face(0.3)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });

  it("ảnh tĩnh (3 khung cùng nhìn thẳng — ảnh in/màn hình) → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(0)], [face(0)], [face(0)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });

  it("khung không có mặt → LIVE_NO_FACE; khung có 2 mặt → LIVE_MULTIPLE_FACES", () => {
    expect(checkLiveFrames([[face(0.3)], [], [face(-0.3)]], ["left", "right"])).toEqual({ ok: false, error: "LIVE_NO_FACE" });
    const other = { box: { x1: 400, y1: 60, x2: 520, y2: 204 }, kps: kps(0) };
    expect(checkLiveFrames([[face(0.3)], [face(0), other], [face(-0.3)]], ["left", "right"])).toEqual({ ok: false, error: "LIVE_MULTIPLE_FACES" });
  });

  it("mặt quá nhỏ (người ở xa phía sau) không tính", () => {
    const tiny = { box: { x1: 0, y1: 0, x2: 20, y2: 24 }, kps: kps(0) };
    expect(checkLiveFrames([[face(0.3)], [face(0), tiny], [face(-0.3)]], ["left", "right"])).toEqual({ ok: true, centerIndex: 1 });
  });

  it("số khung khác 3 → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(0.3)], [face(0)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });
});

describe("samePerson — 3 khung phải cùng một người", () => {
  const e = (i: number) => Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0));
  it("cùng vector → true; một khung là người khác (trực giao) → false", () => {
    expect(samePerson([e(0), e(0), e(0)], 1, LIVENESS_RULES.samePersonMin)).toBe(true);
    expect(samePerson([e(0), e(0), e(1)], 1, LIVENESS_RULES.samePersonMin)).toBe(false);
  });
});
