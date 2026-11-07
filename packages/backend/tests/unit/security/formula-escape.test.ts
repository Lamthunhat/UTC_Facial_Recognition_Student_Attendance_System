import { describe, expect, it } from "vitest";
import { escapeFormula } from "../../../src/security/formula-escape";

describe("escapeFormula — chống CSV/Formula injection (T017, FR-091)", () => {
  it.each(["=1+1", "+1", "-1+2", "@SUM(A1)", "\tcmd", "\rcmd", '=HYPERLINK("http://x","bấm")'])(
    "thêm tiền tố ' cho %j",
    (v) => {
      expect(escapeFormula(v)).toBe(`'${v}`);
    },
  );
  it("giữ nguyên chuỗi bình thường", () => {
    expect(escapeFormula("Nguyễn Văn Tú")).toBe("Nguyễn Văn Tú");
    expect(escapeFormula("231230821")).toBe("231230821");
    expect(escapeFormula("")).toBe("");
  });
  it("không đụng tới số và null", () => {
    expect(escapeFormula(42)).toBe(42);
    expect(escapeFormula(-3)).toBe(-3);
    expect(escapeFormula(null)).toBeNull();
  });
  it("bỏ qua khoảng trắng đầu khi xét ký tự nguy hiểm", () => {
    expect(escapeFormula("  =1+1")).toBe("'  =1+1");
  });
});
