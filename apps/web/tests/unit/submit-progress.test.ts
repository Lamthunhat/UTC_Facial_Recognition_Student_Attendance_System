import { describe, expect, it } from "vitest";
import { SUBMIT_STAGES, submitProgress } from "@/lib/student/submit-progress";

/**
 * Tiến trình gửi đăng ký thẻ (ước lượng theo thời gian — server không báo từng bước; Vercel đo ~5–7 s):
 * tăng đơn điệu, không bao giờ 100 % trước khi có phản hồi, bước hiện tại theo mốc thời gian.
 */
describe("submitProgress", () => {
  it("bắt đầu ở 0 %, bước 'gửi ảnh'", () => {
    expect(submitProgress(0)).toEqual({ percent: 0, stage: 0 });
    expect(SUBMIT_STAGES[0]).toMatch(/gửi ảnh/i);
  });

  it("tăng đơn điệu, ~10 s đạt ~90 %, không vượt 97 % khi chờ lâu", () => {
    let prev = -1;
    for (let t = 0; t <= 60_000; t += 250) {
      const p = submitProgress(t).percent;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(submitProgress(10_000).percent).toBeGreaterThanOrEqual(85);
    expect(submitProgress(10_000).percent).toBeLessThanOrEqual(92);
    expect(submitProgress(60_000).percent).toBeLessThanOrEqual(97);
  });

  it("bước theo mốc: gửi ảnh → đọc thẻ → kiểm tra khuôn mặt → sắp xong", () => {
    expect(SUBMIT_STAGES).toHaveLength(4);
    expect(submitProgress(1_000).stage).toBe(0);
    expect(submitProgress(3_000).stage).toBe(1);
    expect(submitProgress(6_500).stage).toBe(2);
    expect(submitProgress(11_000).stage).toBe(3);
  });
});
