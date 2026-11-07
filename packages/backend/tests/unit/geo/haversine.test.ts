import { describe, expect, it } from "vitest";
import { haversineMeters, isWithinRadius } from "../../../src/geo/haversine";

describe("haversineMeters (T013)", () => {
  it("bằng 0 khi cùng một điểm", () => {
    expect(haversineMeters({ lat: 21.0278, lng: 105.8019 }, { lat: 21.0278, lng: 105.8019 })).toBe(0);
  });

  it("khoảng cách đã biết: Hà Nội → TP.HCM ≈ 1.137 km (±1%)", () => {
    const d = haversineMeters({ lat: 21.0285, lng: 105.8542 }, { lat: 10.7769, lng: 106.7009 });
    expect(d).toBeGreaterThan(1_137_000 * 0.99);
    expect(d).toBeLessThan(1_137_000 * 1.01);
  });

  it("0,0001° vĩ độ ≈ 11,1 m", () => {
    const d = haversineMeters({ lat: 21.0, lng: 105.8 }, { lat: 21.0001, lng: 105.8 });
    expect(d).toBeCloseTo(11.12, 1);
  });

  it("đối xứng", () => {
    const a = { lat: 21.0278, lng: 105.8019 };
    const b = { lat: 21.03, lng: 105.81 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 9);
  });
});

describe("isWithinRadius — biên 50 m", () => {
  const center = { lat: 21.0278, lng: 105.8019 };
  // 1 m theo vĩ độ ≈ 1 / 111_195 độ
  const offset = (m: number) => ({ lat: center.lat + m / 111_195, lng: center.lng });

  it("49 m nằm trong", () => expect(isWithinRadius(center, offset(49), 50)).toBe(true));
  it("50 m nằm trong (biên tính là trong)", () => expect(isWithinRadius(center, offset(49.99), 50)).toBe(true));
  it("51 m nằm ngoài", () => expect(isWithinRadius(center, offset(51), 50)).toBe(false));
  it("từ chối toạ độ không hợp lệ", () => {
    expect(() => haversineMeters({ lat: 91, lng: 0 }, center)).toThrow();
    expect(() => haversineMeters({ lat: 0, lng: Number.NaN }, center)).toThrow();
  });
});
