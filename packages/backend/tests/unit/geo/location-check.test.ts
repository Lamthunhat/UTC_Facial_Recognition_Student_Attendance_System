import { describe, expect, it } from "vitest";
import { assessLocation, parseGpsFix } from "../../../src/geo/location-check";

/**
 * GPS của lượt điểm danh (FR-034, research R17): sai số > 100 m → thử lại (không tính lượt); ngoài bán kính → từ chối;
 * toạ độ bất thường KHÔNG tự từ chối mà gắn cờ để lượt thành nghi vấn (Constitution III):
 *  - độ chính xác < 1 m (máy thật không đạt; app giả vị trí hay báo 0–1 m);
 *  - "dịch chuyển tức thời" so với lượt trước trong cùng khung (tốc độ > 50 m/s sau khi trừ sai số hai lần đo).
 */
const C = { lat: 21.02741, lng: 105.80123 }; // tâm (vị trí GV)
const north = (m: number) => ({ lat: C.lat + m / 111_195, lng: C.lng }); // ~m mét về phía bắc
const now = new Date("2026-11-14T00:10:00Z");

describe("parseGpsFix — kiểm đầu vào trước khi xử lý ảnh", () => {
  it("chuỗi số hợp lệ → số", () => {
    expect(parseGpsFix({ lat: "21.02741", lng: "105.80123", accuracyM: "18" })).toEqual({ lat: 21.02741, lng: 105.80123, accuracyM: 18 });
  });
  it.each([
    [{ lat: "91", lng: "105", accuracyM: "10" }],
    [{ lat: "21", lng: "-181", accuracyM: "10" }],
    [{ lat: "21", lng: "105", accuracyM: "0" }],
    [{ lat: "21", lng: "105", accuracyM: "-5" }],
    [{ lat: "NaN", lng: "105", accuracyM: "10" }],
    [{ lat: "21", lng: "Infinity", accuracyM: "10" }],
    [{ lat: "21", lng: "105", accuracyM: "100001" }],
    [{ lat: "", lng: "105", accuracyM: "10" }],
    [{ lat: "21", lng: "105" }],
    [{ lat: "0x15", lng: "105", accuracyM: "10" }],
  ])("không hợp lệ %j → null", (v) => {
    expect(parseGpsFix(v as Record<string, unknown>)).toBeNull();
  });
});

describe("assessLocation", () => {
  it("trong bán kính, sai số tốt → ok + khoảng cách", () => {
    const r = assessLocation({ ...north(20), accuracyM: 12 }, C, 50, { now });
    expect(r.status).toBe("ok");
    expect(r.distanceM).toBeCloseTo(20, 0);
    expect(r.anomalies).toEqual([]);
  });
  it("sai số > 100 m → retry (kể cả khi ở gần)", () => {
    expect(assessLocation({ ...north(5), accuracyM: 101 }, C, 50, { now }).status).toBe("retry_low_accuracy");
    expect(assessLocation({ ...north(5), accuracyM: 100 }, C, 50, { now }).status).toBe("ok");
  });
  it("ngoài bán kính → out_of_range (500 m)", () => {
    const r = assessLocation({ ...north(500), accuracyM: 10 }, C, 50, { now });
    expect(r.status).toBe("out_of_range");
    expect(r.distanceM).toBeCloseTo(500, -1);
  });
  it("đúng biên bán kính vẫn tính trong phạm vi", () => {
    expect(assessLocation({ ...north(49.9), accuracyM: 10 }, C, 50, { now }).status).toBe("ok");
  });
  it("độ chính xác < 1 m → cờ implausible_accuracy (không đổi status)", () => {
    const r = assessLocation({ ...north(10), accuracyM: 0.5 }, C, 50, { now });
    expect(r.status).toBe("ok");
    expect(r.anomalies).toEqual(["implausible_accuracy"]);
    expect(assessLocation({ ...north(10), accuracyM: 1 }, C, 50, { now }).anomalies).toEqual([]);
  });
  it("lượt trước cách 5 km 10 giây trước → impossible_speed", () => {
    const prior = { ...north(5000), accuracyM: 10, at: new Date(now.getTime() - 10_000) };
    expect(assessLocation({ ...north(10), accuracyM: 10 }, C, 50, { now, prior }).anomalies).toEqual(["impossible_speed"]);
  });
  it("đi bộ hợp lý giữa hai lượt (300 m trong 2 phút) → không cờ; sai số lớn được trừ đi", () => {
    const walk = { ...north(300), accuracyM: 10, at: new Date(now.getTime() - 120_000) };
    expect(assessLocation({ ...north(10), accuracyM: 10 }, C, 50, { now, prior: walk }).anomalies).toEqual([]);
    const noisy = { ...north(400), accuracyM: 300, at: new Date(now.getTime() - 5_000) };
    expect(assessLocation({ ...north(10), accuracyM: 90, }, C, 50, { now, prior: noisy }).anomalies).toEqual([]);
  });
});
