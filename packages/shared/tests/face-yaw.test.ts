import { describe, expect, it } from "vitest";
import { classifyFaceYaw, faceYaw, YAW_SCALE } from "../src/face-yaw";
import { CLIENT_YAW, SERVER_YAW } from "../src/face-yaw-thresholds";
import { syntheticHead } from "../src/head-model";

/**
 * Yaw dùng chung client (BlazeFace 6 điểm) + server (SCRFD 5 điểm): kẹp(5 × (mũi.x − tâm 2 mắt.x) / bề rộng bbox, ±1).
 * Công thức cũ chia cho KHOẢNG CÁCH 2 MẮT (≈ cos θ → 0 khi quay mạnh) → ra -3,95 / 7,06 / -41,12 và đổi dấu (thử thật iPhone).
 * Mô hình đầu tổng hợp quay θ ∈ [-80°, 80°] (θ > 0 = SV quay sang TRÁI của mình → mũi lệch PHẢI ảnh không lật).
 */
const ANGLES = Array.from({ length: 33 }, (_, i) => -80 + i * 5);

function yawSeries(kind: "scrfd" | "blaze", over: Partial<Parameters<typeof syntheticHead>[1]> = {}) {
  return ANGLES.map((deg) => {
    const h = syntheticHead(deg, over);
    const k = kind === "scrfd" ? h.scrfd : h.blaze;
    return faceYaw(k.eyeA, k.eyeB, k.nose, h.box.x2 - h.box.x1)!;
  });
}

describe("faceYaw — thang mới", () => {
  for (const kind of ["scrfd", "blaze"] as const) {
    it(`${kind}: tăng ĐƠN ĐIỆU theo góc -80° → +80°, không đổi dấu, nằm trong [-1, 1]`, () => {
      const ys = yawSeries(kind);
      for (let i = 1; i < ys.length; i++) expect(ys[i], `${ANGLES[i]}°`).toBeGreaterThan(ys[i - 1]);
      ANGLES.forEach((deg, i) => {
        expect(Math.sign(ys[i]), `${deg}°`).toBe(Math.sign(deg));
        expect(Math.abs(ys[i])).toBeLessThanOrEqual(1);
      });
    });

    it(`${kind}: không phụ thuộc kích thước / vị trí mặt trong khung`, () => {
      const a = yawSeries(kind);
      const b = yawSeries(kind, { scale: 900, cx: 300, cy: 700 });
      a.forEach((y, i) => expect(b[i]).toBeCloseTo(y, 9));
    });
  }

  it("thang ≈ sin θ ở góc nhỏ (YAW_SCALE = 5 theo mô hình đầu)", () => {
    expect(YAW_SCALE).toBe(5);
    const h = syntheticHead(10);
    expect(faceYaw(h.scrfd.eyeA, h.scrfd.eyeB, h.scrfd.nose, h.box.x2 - h.box.x1)).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 1);
  });

  it("kẹp ±1; thiếu bề rộng → null", () => {
    expect(faceYaw({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 500, y: 0 }, 100)).toBe(1);
    expect(faceYaw({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -500, y: 0 }, 100)).toBe(-1);
    expect(faceYaw({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 0)).toBeNull();
  });

  it("công thức CŨ (chia khoảng cách 2 mắt) thì vượt xa ±1 khi quay mạnh — đúng lỗi đã gặp", () => {
    const h = syntheticHead(80);
    const k = h.scrfd;
    const old = (k.nose.x - (k.eyeA.x + k.eyeB.x) / 2) / Math.hypot(k.eyeB.x - k.eyeA.x, k.eyeB.y - k.eyeA.y);
    expect(Math.abs(old)).toBeGreaterThan(2);
  });
});

describe("classifyFaceYaw — ngưỡng theo thang mới", () => {
  it("server: thẳng ≤ 0,18 · quay 0,22–0,80 · quá mạnh > 0,80 (không phải khung quay hợp lệ)", () => {
    expect(SERVER_YAW).toEqual({ centerMax: 0.18, turnMin: 0.22, turnMax: 0.8 });
    expect(classifyFaceYaw(0.1, SERVER_YAW)).toBe("center");
    expect(classifyFaceYaw(0.5, SERVER_YAW)).toBe("left");
    expect(classifyFaceYaw(-0.5, SERVER_YAW)).toBe("right");
    expect(classifyFaceYaw(0.2, SERVER_YAW)).toBe("unclear");
    expect(classifyFaceYaw(0.25, SERVER_YAW)).toBe("left");
    expect(classifyFaceYaw(0.9, SERVER_YAW)).toBe("too_far");
    expect(classifyFaceYaw(-0.95, SERVER_YAW)).toBe("too_far");
    expect(classifyFaceYaw(null, SERVER_YAW)).toBe("unclear");
  });

  it("client CHẶT HƠN server ở cả ba ngưỡng (biên an toàn giữa BlazeFace và SCRFD)", () => {
    expect(CLIENT_YAW).toEqual({ centerMax: 0.12, turnMin: 0.4, turnMax: 0.65 });
    expect(CLIENT_YAW.centerMax).toBeLessThan(SERVER_YAW.centerMax);
    expect(CLIENT_YAW.turnMin).toBeGreaterThan(SERVER_YAW.turnMin);
    expect(CLIENT_YAW.turnMax).toBeLessThan(SERVER_YAW.turnMax);
  });

  it("theo mô hình đầu: client chấp nhận quay ~25°–48°, server ~13°–72°", () => {
    const at = (deg: number) => {
      const h = syntheticHead(deg);
      return faceYaw(h.blaze.eyeA, h.blaze.eyeB, h.blaze.nose, h.box.x2 - h.box.x1);
    };
    expect(classifyFaceYaw(at(30), CLIENT_YAW)).toBe("left");
    expect(classifyFaceYaw(at(-30), CLIENT_YAW)).toBe("right");
    expect(classifyFaceYaw(at(60), CLIENT_YAW)).toBe("too_far");
    expect(classifyFaceYaw(at(60), SERVER_YAW)).toBe("left");
    expect(classifyFaceYaw(at(5), CLIENT_YAW)).toBe("center");
  });
});
