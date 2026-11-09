import { describe, expect, it } from "vitest";
import { stepTimer } from "../../../src/card/step-timer";

/** Đo thời gian từng bước đăng ký thẻ (log ở dev). Đồng hồ truyền vào để test xác định. */
describe("stepTimer", () => {
  it("mỗi mark ghi thời gian từ mốc trước; total = tổng", () => {
    let t = 1000;
    const timer = stepTimer(() => t);
    t = 1040;
    timer.mark("sanitize");
    t = 1900;
    timer.mark("decode");
    t = 1950;
    timer.mark("liveness");
    expect(timer.done()).toEqual({ sanitize: 40, decode: 860, liveness: 50, total: 950 });
  });

  it("mark trùng tên → cộng dồn", () => {
    let t = 0;
    const timer = stepTimer(() => t);
    t = 10;
    timer.mark("x");
    t = 25;
    timer.mark("x");
    expect(timer.done()).toEqual({ x: 25, total: 25 });
  });
});
