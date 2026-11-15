import { faceYaw, SERVER_YAW } from "@utc/shared/face-yaw";
import { syntheticHead } from "@utc/shared/head-model";
import { describe, expect, it } from "vitest";
import type { Point } from "../../../src/face/align";
import { checkLiveFrames, classifyPose, expectedPoses, headYaw, samePerson, LIVENESS_RULES } from "../../../src/face/liveness";

/**
 * Liveness bằng thử thách quay đầu (research R2): yaw từ 5 điểm SCRFD [mắt, mắt, mũi, mép, mép] + bbox mặt, CÙNG công thức
 * với client (@utc/shared/face-yaw): kẹp(5 × (mũi.x − tâm 2 mắt.x) / bề rộng bbox, ±1). Ảnh KHÔNG lật:
 * SV quay sang TRÁI của mình → mũi lệch PHẢI ảnh → yaw > 0. Dữ liệu: mô hình đầu tổng hợp (không dùng ảnh mặt thật).
 */
const face = (deg: number) => {
  const h = syntheticHead(deg);
  return { box: h.box, kps: h.scrfd.kps as Point[] };
};

describe("headYaw — công thức dùng chung, thang mới", () => {
  it("= faceYaw của @utc/shared với 2 mắt + mũi + bề rộng bbox", () => {
    const h = syntheticHead(25);
    expect(headYaw(h.scrfd.kps as Point[], h.box)).toBe(faceYaw(h.scrfd.eyeA, h.scrfd.eyeB, h.scrfd.nose, h.box.x2 - h.box.x1));
  });

  it("đơn điệu -80° → +80°, không đổi dấu, trong [-1, 1] (công thức cũ ra -41 / đổi dấu khi quay mạnh)", () => {
    let prev = -Infinity;
    for (let deg = -80; deg <= 80; deg += 5) {
      const f = face(deg);
      const y = headYaw(f.kps, f.box);
      expect(y, `${deg}°`).toBeGreaterThan(prev);
      expect(Math.sign(y), `${deg}°`).toBe(Math.sign(deg));
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
      prev = y;
    }
  });

  it("bbox hỏng (bề rộng 0) → NaN → unclear", () => {
    const f = face(0);
    expect(classifyPose(headYaw(f.kps, { ...f.box, x2: f.box.x1 }))).toBe("unclear");
  });
});

describe("classifyPose — ngưỡng server theo thang mới", () => {
  it("thẳng ≤ 0,18 · quay 0,30–0,80 · quá mạnh > 0,80 · vùng đệm giữa thẳng và quay", () => {
    expect(classifyPose(0)).toBe("center");
    expect(classifyPose(SERVER_YAW.centerMax)).toBe("center");
    expect(classifyPose(SERVER_YAW.turnMin)).toBe("left");
    expect(classifyPose(-SERVER_YAW.turnMax)).toBe("right");
    expect(classifyPose(SERVER_YAW.turnMax + 0.01)).toBe("too_far");
    expect(classifyPose((SERVER_YAW.centerMax + SERVER_YAW.turnMin) / 2)).toBe("unclear");
  });
});

describe("checkLiveFrames — đúng 3 khung theo thử thách [hướng 1, thẳng, hướng 2]", () => {
  it("thứ tự khung mong đợi", () => {
    expect(expectedPoses(["left", "right"])).toEqual(["left", "center", "right"]);
  });

  it("quay ~30° đúng chuỗi thử thách → ok, khung giữa là khung nhìn thẳng", () => {
    expect(checkLiveFrames([[face(30)], [face(0)], [face(-30)]], ["left", "right"])).toEqual({ ok: true, centerIndex: 1 });
    expect(checkLiveFrames([[face(-30)], [face(2)], [face(30)]], ["right", "left"])).toEqual({ ok: true, centerIndex: 1 });
  });

  it("QUAY QUÁ MẠNH (~85°, |yaw| > 0,80) → không phải khung quay hợp lệ → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(85)], [face(0)], [face(-30)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });

  it("quay ngược chiều thử thách → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(-30)], [face(0)], [face(30)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });

  it("quay quá ít (~10°, vùng đệm) → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(10)], [face(0)], [face(-30)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });

  it("ảnh tĩnh (3 khung cùng nhìn thẳng — ảnh in/màn hình) → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(0)], [face(0)], [face(0)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });

  it("khung không có mặt → LIVE_NO_FACE; khung có 2 mặt → LIVE_MULTIPLE_FACES", () => {
    expect(checkLiveFrames([[face(30)], [], [face(-30)]], ["left", "right"])).toEqual({ ok: false, error: "LIVE_NO_FACE" });
    expect(checkLiveFrames([[face(30)], [face(0), face(0)], [face(-30)]], ["left", "right"])).toEqual({ ok: false, error: "LIVE_MULTIPLE_FACES" });
  });

  it("mặt quá nhỏ (người ở xa phía sau) không tính", () => {
    const tiny = { box: { x1: 0, y1: 0, x2: 20, y2: 24 }, kps: face(0).kps };
    expect(checkLiveFrames([[face(30)], [face(0), tiny], [face(-30)]], ["left", "right"])).toEqual({ ok: true, centerIndex: 1 });
  });

  it("số khung khác 3 → LIVENESS_FAILED", () => {
    expect(checkLiveFrames([[face(30)], [face(0)]], ["left", "right"])).toEqual({ ok: false, error: "LIVENESS_FAILED" });
  });
});

describe("samePerson — 3 khung phải cùng một người", () => {
  const e = (i: number) => Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0));
  it("cùng vector → true; một khung là người khác (trực giao) → false", () => {
    expect(samePerson([e(0), e(0), e(0)], 1, LIVENESS_RULES.samePersonMin)).toBe(true);
    expect(samePerson([e(0), e(0), e(1)], 1, LIVENESS_RULES.samePersonMin)).toBe(false);
  });
});
