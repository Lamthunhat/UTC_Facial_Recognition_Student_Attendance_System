import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIODS,
  SHIFTS,
  sessionTimes,
  shiftToPeriods,
  vnDateOf,
  isSameVnDay,
} from "../src/periods";

describe("bảng tiết mặc định (FR-010a)", () => {
  it("có đủ 16 tiết, liên tục, kết thúc sau bắt đầu", () => {
    expect(DEFAULT_PERIODS).toHaveLength(16);
    DEFAULT_PERIODS.forEach((p, i) => {
      expect(p.number).toBe(i + 1);
      expect(p.endsAt > p.startsAt).toBe(true);
    });
  });
  it("giờ khớp thông báo của trường", () => {
    const byNo = Object.fromEntries(DEFAULT_PERIODS.map((p) => [p.number, p]));
    expect(byNo[1]).toMatchObject({ startsAt: "07:00", endsAt: "07:45" });
    expect(byNo[3]).toMatchObject({ startsAt: "08:40", endsAt: "09:25" });
    expect(byNo[7]).toMatchObject({ startsAt: "13:00", endsAt: "13:45" });
    expect(byNo[16]).toMatchObject({ startsAt: "20:45", endsAt: "21:30" });
  });
});

describe("ca → tiết (FR-010b)", () => {
  it.each([
    [1, 1, 3],
    [2, 4, 6],
    [3, 7, 9],
    [4, 10, 12],
    [5, 13, 16],
  ])("Ca %i = tiết %i–%i", (shift, first, last) => {
    expect(shiftToPeriods(shift)).toEqual({ firstPeriod: first, lastPeriod: last });
  });
  it("có đúng 5 ca", () => expect(SHIFTS).toHaveLength(5));
  it("ca không tồn tại báo lỗi", () => expect(() => shiftToPeriods(6)).toThrow());
});

describe("ngày + tiết → giờ bắt đầu/kết thúc theo Asia/Ho_Chi_Minh (FR-010c)", () => {
  it("14/11/2026 tiết 1–3 = 07:00–09:25 giờ VN = 00:00–02:25 UTC", () => {
    const { startsAt, endsAt } = sessionTimes("2026-11-14", 1, 3);
    expect(startsAt.toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-11-14T02:25:00.000Z");
  });
  it("tiết 13–16 kết thúc 21:30 giờ VN", () => {
    const { endsAt } = sessionTimes("2026-11-14", 13, 16);
    expect(endsAt.toISOString()).toBe("2026-11-14T14:30:00.000Z");
  });
  it("khoảng tiết bất kỳ (2–4) dùng giờ bắt đầu tiết đầu, kết thúc tiết cuối", () => {
    const { startsAt, endsAt } = sessionTimes("2026-11-14", 2, 4);
    expect(startsAt.toISOString()).toBe("2026-11-14T00:50:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-11-14T03:20:00.000Z");
  });
  it("từ chối tiết đầu > tiết cuối hoặc ngoài 1–16", () => {
    expect(() => sessionTimes("2026-11-14", 4, 2)).toThrow();
    expect(() => sessionTimes("2026-11-14", 0, 2)).toThrow();
    expect(() => sessionTimes("2026-11-14", 15, 17)).toThrow();
  });
});

describe("ngày theo giờ Việt Nam (FR-101)", () => {
  it("23:30 UTC ngày 13/11 là ngày 14/11 ở VN", () => {
    expect(vnDateOf(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-14");
  });
  it("16:59 UTC là 23:59 cùng ngày VN; 17:00 UTC sang ngày mới", () => {
    expect(vnDateOf(new Date("2026-11-14T16:59:59Z"))).toBe("2026-11-14");
    expect(vnDateOf(new Date("2026-11-14T17:00:00Z"))).toBe("2026-11-15");
  });
  it("isSameVnDay", () => {
    expect(isSameVnDay("2026-11-14", new Date("2026-11-14T16:59:59Z"))).toBe(true);
    expect(isSameVnDay("2026-11-14", new Date("2026-11-14T17:00:00Z"))).toBe(false);
  });
});
