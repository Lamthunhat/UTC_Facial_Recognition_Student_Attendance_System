import { describe, expect, it } from "vitest";
import {
  ARCFACE_TEMPLATE,
  applySimilarity,
  estimateSimilarity,
  estimateYawDeg,
  invertSimilarity,
  type Point,
} from "../../../src/face/align";
import { cosine, l2normalize } from "../../../src/face/similarity";

describe("estimateSimilarity", () => {
  it("khôi phục đúng phép biến đổi đã biết (xoay 20°, tỉ lệ 1.5, tịnh tiến)", () => {
    const th = (20 * Math.PI) / 180;
    const truth = { a: 1.5 * Math.cos(th), b: 1.5 * Math.sin(th), tx: 30, ty: -12 };
    const src = ARCFACE_TEMPLATE;
    const dst = src.map((p) => applySimilarity(truth, p));
    const m = estimateSimilarity(src, dst);
    expect(m.a).toBeCloseTo(truth.a, 6);
    expect(m.b).toBeCloseTo(truth.b, 6);
    expect(m.tx).toBeCloseTo(truth.tx, 6);
    expect(m.ty).toBeCloseTo(truth.ty, 6);
  });
  it("nghịch đảo đưa điểm về chỗ cũ", () => {
    const m = { a: 0.8, b: 0.3, tx: 5, ty: 7 };
    const p: Point = [12, 34];
    const back = applySimilarity(invertSimilarity(m), applySimilarity(m, p));
    expect(back[0]).toBeCloseTo(12, 9);
    expect(back[1]).toBeCloseTo(34, 9);
  });
});

describe("estimateYawDeg", () => {
  const frontal: Point[] = [
    [40, 50],
    [72, 50],
    [56, 70],
    [42, 90],
    [70, 90],
  ];
  it("≈ 0° khi nhìn thẳng", () => expect(Math.abs(estimateYawDeg(frontal))).toBeLessThan(1));
  it("dấu ngược nhau khi mũi lệch trái/phải", () => {
    const left = frontal.map((p, i) => (i === 2 ? ([p[0] - 8, p[1]] as Point) : p));
    const right = frontal.map((p, i) => (i === 2 ? ([p[0] + 8, p[1]] as Point) : p));
    expect(estimateYawDeg(left)).toBeLessThan(-15);
    expect(estimateYawDeg(right)).toBeGreaterThan(15);
  });
  it("không đổi khi cả khuôn mặt bị xoay nghiêng (roll)", () => {
    const th = (25 * Math.PI) / 180;
    const rot = { a: Math.cos(th), b: Math.sin(th), tx: 0, ty: 0 };
    expect(Math.abs(estimateYawDeg(frontal.map((p) => applySimilarity(rot, p))))).toBeLessThan(1);
  });
});

describe("cosine / l2normalize", () => {
  it("cosine của vector với chính nó = 1, vuông góc = 0", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 9);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it("chuẩn hoá L2 có độ dài 1", () => {
    const v = l2normalize([3, 4]);
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 6);
  });
});
