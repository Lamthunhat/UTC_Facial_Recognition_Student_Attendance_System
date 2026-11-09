import { afterEach, describe, expect, it } from "vitest";
import { duplicateThreshold, liveMatchThreshold } from "../../../src/card/register";

/** Ngưỡng mặc định khi chưa đặt biến môi trường — CHỜ HIỆU CHỈNH T011 (research R1). */
describe("ngưỡng khuôn mặt cho đăng ký thẻ", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("DUPLICATE_ABOVE mặc định 0,45; CARD_ACCEPT_ABOVE (mặt trực tiếp ↔ thẻ) mặc định 0,5", () => {
    delete process.env.DUPLICATE_ABOVE;
    delete process.env.CARD_ACCEPT_ABOVE;
    expect(duplicateThreshold()).toBe(0.45);
    expect(liveMatchThreshold()).toBe(0.5);
  });

  it("đọc từ biến môi trường; giá trị ngoài (0, 1] bị bỏ qua", () => {
    process.env.DUPLICATE_ABOVE = "0.52";
    expect(duplicateThreshold()).toBe(0.52);
    process.env.DUPLICATE_ABOVE = "7";
    expect(duplicateThreshold()).toBe(0.45);
  });
});
