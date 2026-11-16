import { describe, expect, it } from "vitest";
import { checkoutWindowTimes, isWindowOpen, lateMinutes, recordPurgeAfter, vnWeekday } from "../../../src/attendance/window-times";

/** Khung giờ (FR-022, FR-023, FR-073): giờ server, VN = UTC+7. */
describe("checkoutWindowTimes — check-out tự mở theo giờ kết thúc tiết cuối (FR-023)", () => {
  it("buổi tiết 1–3 (kết thúc 9:25) → 9:15–9:35 với độ lệch mặc định 10'/10'", () => {
    const ends = new Date("2026-11-14T02:25:00Z"); // 09:25 VN
    const w = checkoutWindowTimes(ends, 10, 10);
    expect(w.opensAt.toISOString()).toBe("2026-11-14T02:15:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-14T02:35:00.000Z");
  });
  it("độ lệch theo lớp (5' trước, 15' sau)", () => {
    const w = checkoutWindowTimes(new Date("2026-11-14T02:25:00Z"), 5, 15);
    expect(w.opensAt.toISOString()).toBe("2026-11-14T02:20:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-14T02:40:00.000Z");
  });
});

describe("isWindowOpen — opens_at ≤ now < coalesce(closed_early_at, closes_at)", () => {
  const w = { opensAt: new Date("2026-11-14T00:00:00Z"), closesAt: new Date("2026-11-14T00:15:00Z"), closedEarlyAt: null };
  it.each([
    ["trước giờ mở", "2026-11-13T23:59:59Z", false],
    ["đúng giờ mở", "2026-11-14T00:00:00Z", true],
    ["giữa khung", "2026-11-14T00:10:00Z", true],
    ["đúng giờ đóng", "2026-11-14T00:15:00Z", false],
  ])("%s", (_n, t, open) => {
    expect(isWindowOpen(w, new Date(t))).toBe(open);
  });
  it("đóng sớm → đóng từ closed_early_at", () => {
    const early = { ...w, closedEarlyAt: new Date("2026-11-14T00:05:00Z") };
    expect(isWindowOpen(early, new Date("2026-11-14T00:04:59Z"))).toBe(true);
    expect(isWindowOpen(early, new Date("2026-11-14T00:05:00Z"))).toBe(false);
  });
});

describe("lateMinutes — muộn tính từ lúc GV mở check-in (FR-073)", () => {
  it("7 phút 30 giây → 7.5", () => {
    expect(lateMinutes(new Date("2026-11-14T00:07:30Z"), new Date("2026-11-14T00:00:00Z"))).toBe(7.5);
  });
  it("không âm", () => {
    expect(lateMinutes(new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T00:00:01Z"))).toBe(0);
  });
});

describe("vnWeekday — Thứ 2 = 2 … Chủ nhật = 8 (như class_schedules)", () => {
  it.each([
    ["2026-11-16", 2], // thứ Hai
    ["2026-11-21", 7], // thứ Bảy
    ["2026-11-22", 8], // Chủ nhật
  ])("%s → %d", (d, w) => {
    expect(vnWeekday(d)).toBe(w);
  });
});

describe("recordPurgeAfter — hồ sơ giữ tới hết 30 ngày sau ngày kết thúc lớp (FR-114)", () => {
  it("lớp kết thúc 2026-12-20 → 00:00 giờ VN ngày 2027-01-20", () => {
    expect(recordPurgeAfter("2026-12-20").toISOString()).toBe("2027-01-19T17:00:00.000Z");
  });
});
