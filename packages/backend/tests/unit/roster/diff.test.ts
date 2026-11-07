import { describe, expect, it } from "vitest";
import { diffRoster, rosterWarnings, summarizeRoster } from "../../../src/roster/commit";
import type { PreviewRow } from "../../../src/roster/columns";

/** T041 — Diff danh sách khi nhập (lại): mới / đã có / ghi danh lại / rút (FR-014). */

const cur = (code: string, status: "active" | "withdrawn") => ({ code, status });

describe("diffRoster", () => {
  it("lớp trống: mọi mã trong file là mới", () => {
    expect(diffRoster(["111111", "222222"], [])).toEqual({
      added: ["111111", "222222"],
      reactivated: [],
      existing: [],
      toWithdraw: [],
    });
  });

  it("nhập lại cùng file: tất cả đã có, không rút ai", () => {
    const d = diffRoster(["111111", "222222"], [cur("111111", "active"), cur("222222", "active")]);
    expect(d).toEqual({ added: [], reactivated: [], existing: ["111111", "222222"], toWithdraw: [] });
  });

  it("SV đang học không còn trong file → rút; SV mới → thêm", () => {
    const d = diffRoster(["111111", "333333"], [cur("111111", "active"), cur("222222", "active")]);
    expect(d.added).toEqual(["333333"]);
    expect(d.existing).toEqual(["111111"]);
    expect(d.toWithdraw).toEqual(["222222"]);
  });

  it("SV đã rút xuất hiện lại trong file → ghi danh lại (không tính là mới)", () => {
    const d = diffRoster(["222222"], [cur("222222", "withdrawn")]);
    expect(d).toEqual({ added: [], reactivated: ["222222"], existing: [], toWithdraw: [] });
  });

  it("SV đã rút và vẫn không có trong file → không đụng tới", () => {
    const d = diffRoster(["111111"], [cur("111111", "active"), cur("222222", "withdrawn")]);
    expect(d.toWithdraw).toEqual([]);
    expect(d.reactivated).toEqual([]);
  });

  it("mã lặp trong đầu vào chỉ tính một lần, giữ thứ tự xuất hiện", () => {
    const d = diffRoster(["333333", "111111", "333333"], []);
    expect(d.added).toEqual(["333333", "111111"]);
  });

  it("các nhóm rời nhau và phủ hết mã trong file", () => {
    const file = ["1000001", "1000002", "1000003", "1000004"];
    const d = diffRoster(file, [cur("1000001", "active"), cur("1000002", "withdrawn"), cur("1000005", "active")]);
    const inFile = [...d.added, ...d.reactivated, ...d.existing].sort();
    expect(inFile).toEqual([...file].sort());
    expect(d.toWithdraw).toEqual(["1000005"]);
  });
});

describe("summarizeRoster", () => {
  const row = (code: string, errors: PreviewRow["errors"] = []): PreviewRow => ({
    rowNo: 0,
    data: { code, lastName: "A", firstName: "B", adminClass: "L", cohort: null },
    errors,
  });

  it("đếm hợp lệ/lỗi theo dòng, mới/đã có/rút theo diff; 'new' gồm cả ghi danh lại", () => {
    const rows = [row("111111"), row("222222"), row("333333"), row("333333", ["DUPLICATE_CODE"]), row("", ["MISSING_CODE"])];
    const diff = diffRoster(["111111", "222222", "333333"], [cur("111111", "active"), cur("222222", "withdrawn"), cur("999999", "active")]);
    expect(summarizeRoster(rows, diff)).toEqual({ valid: 3, invalid: 2, new: 2, reactivated: 1, existing: 1, toWithdraw: 1 });
  });
});

describe("rosterWarnings — ENCODING_LOSS", () => {
  const summary = { valid: 1, invalid: 1, new: 1, reactivated: 0, existing: 0, toWithdraw: 0 };
  const row = (rowNo: number, lastName: string, errors: PreviewRow["errors"] = []): PreviewRow => ({
    rowNo,
    data: { code: "231230801", lastName, firstName: "B", adminClass: "L", cohort: null },
    errors,
  });

  it("có dòng LOST_CHARACTERS → cảnh báo kèm số dòng", () => {
    const w = rosterWarnings([row(2, "Lê"), row(3, "Nguy?n", ["LOST_CHARACTERS"])], summary, ["MSSV", "Họ", "Tên", "Lớp"]);
    expect(w).toContainEqual({ code: "ENCODING_LOSS", rows: [3] });
  });

  it("tiêu đề bị mất dấu (chưa nhận ra cột nên chưa có dòng) → vẫn cảnh báo", () => {
    const w = rosterWarnings([], { ...summary, valid: 0, invalid: 0, new: 0 }, ["STT", "Mã sinh viên", "H? ??m", "Tên", "L?p"]);
    expect(w).toContainEqual({ code: "ENCODING_LOSS", rows: [] });
  });

  it("file bình thường → không cảnh báo", () => {
    expect(rosterWarnings([row(2, "Lê")], summary, ["MSSV", "Họ", "Tên", "Lớp", "Ghi chú?"])).toEqual([]);
  });
});
