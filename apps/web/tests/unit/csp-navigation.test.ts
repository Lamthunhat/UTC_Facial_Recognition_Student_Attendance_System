import { describe, expect, it } from "vitest";
import { crossesCspBoundary } from "@/lib/csp-navigation";

/**
 * CSP gắn với DOCUMENT: điều hướng phía client (next/link, router.push) giữ CSP của trang cũ. Route nhận diện mặt cần
 * 'wasm-unsafe-eval' (needsWasm) → mọi điều hướng băng qua ranh giới (vào hoặc ra khỏi route đó) phải tải document mới.
 */
describe("crossesCspBoundary", () => {
  it("vào trang thẻ SV từ trang khác → phải tải lại document (để có 'wasm-unsafe-eval')", () => {
    expect(crossesCspBoundary("/sv/lop", "/sv/the-sinh-vien")).toBe(true);
    expect(crossesCspBoundary("/sv/dong-y", "/sv/the-sinh-vien")).toBe(true);
    expect(crossesCspBoundary("/sv", "/sv/the-sinh-vien/debug")).toBe(true);
  });
  it("rời trang thẻ SV sang trang khác → tải lại (trang khác giữ CSP chặt)", () => {
    expect(crossesCspBoundary("/sv/the-sinh-vien", "/sv/lop")).toBe(true);
  });
  it("trong cùng một phía → điều hướng phía client bình thường", () => {
    expect(crossesCspBoundary("/sv/lop", "/sv/dong-y")).toBe(false);
    expect(crossesCspBoundary("/sv/the-sinh-vien", "/sv/the-sinh-vien/debug")).toBe(false);
    expect(crossesCspBoundary("/gv/lop", "/gv/lop/abc/the")).toBe(false);
  });
  it("href có query/hash → so theo pathname", () => {
    expect(crossesCspBoundary("/sv/lop", "/sv/the-sinh-vien?x=1#a")).toBe(true);
    expect(crossesCspBoundary("/sv/dong-y?next=/sv/the-sinh-vien", "/sv/lop")).toBe(false);
  });
});
