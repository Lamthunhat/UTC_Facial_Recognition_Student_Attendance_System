import { describe, expect, it } from "vitest";
import { isActiveNav } from "@/lib/nav";

/** Mục menu đang chọn (aria-current) — khớp đúng đoạn đường dẫn, không khớp nhầm tiền tố. */
describe("isActiveNav", () => {
  it("trùng hẳn hoặc là trang con", () => {
    expect(isActiveNav("/sv/lop", "/sv/lop")).toBe(true);
    expect(isActiveNav("/sv/the-sinh-vien/debug", "/sv/the-sinh-vien")).toBe(true);
    expect(isActiveNav("/gv/lop/abc/the", "/gv/lop")).toBe(true);
  });
  it("không khớp nhầm tiền tố chuỗi", () => {
    expect(isActiveNav("/sv/lop-khac", "/sv/lop")).toBe(false);
    expect(isActiveNav("/sv/the-sinh-vien", "/sv/lop")).toBe(false);
  });
});
