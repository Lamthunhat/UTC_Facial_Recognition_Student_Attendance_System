import { describe, expect, it } from "vitest";
import { ADVICE_CODES, cardErrorAdvice } from "@/lib/student/card-errors";

/** Mã lỗi API đăng ký thẻ → lời hướng dẫn tiếng Việt + bước làm tiếp. Không bao giờ lộ lý do chờ duyệt/trùng mặt. */
describe("cardErrorAdvice", () => {
  it("lỗi đọc thẻ → chụp lại thẻ, kèm hướng dẫn cụ thể", () => {
    expect(cardErrorAdvice({ status: 422, code: "UNREADABLE" })).toMatchObject({ action: "retake-card" });
    expect(cardErrorAdvice({ status: 422, code: "UNREADABLE" }).message).toMatch(/đủ sáng|rõ/);
    expect(cardErrorAdvice({ status: 422, code: "CODE_MISMATCH" }).message).toMatch(/đúng thẻ của bạn/);
    for (const code of ["NO_PORTRAIT", "MULTIPLE_FACES", "UNSUPPORTED_TYPE"]) {
      expect(cardErrorAdvice({ status: 422, code }).action, code).toBe("retake-card");
    }
    expect(cardErrorAdvice({ status: 413, code: "PAYLOAD_TOO_LARGE" }).action).toBe("retake-card");
  });

  it("lỗi mặt trực tiếp → làm lại thử thách (giữ ảnh thẻ)", () => {
    expect(cardErrorAdvice({ status: 422, code: "LIVENESS_FAILED" })).toMatchObject({ action: "retake-face" });
    expect(cardErrorAdvice({ status: 422, code: "LIVENESS_FAILED" }).message).toMatch(/thử thách|quay/);
    for (const code of ["LIVE_NO_FACE", "LIVE_MULTIPLE_FACES", "VALIDATION_ERROR"]) {
      expect(cardErrorAdvice({ status: 422, code }).action, code).toBe("retake-face");
    }
  });

  it("nonce hết hạn / sai → lấy nonce mới, làm lại khuôn mặt", () => {
    expect(cardErrorAdvice({ status: 403, code: "BAD_NONCE" })).toMatchObject({ action: "retake-face" });
    expect(cardErrorAdvice({ status: 403, code: "BAD_NONCE" }).message).toMatch(/hết hạn/);
  });

  it("remainingAttempts → ghi số lượt còn lại; 0 hoặc 429 → dừng, báo thời gian chờ", () => {
    expect(cardErrorAdvice({ status: 422, code: "UNREADABLE", remainingAttempts: 3 }).attemptsNote).toBe("Bạn còn 3 lượt thử trong giờ này.");
    const zero = cardErrorAdvice({ status: 422, code: "UNREADABLE", remainingAttempts: 0 });
    expect(zero.action).toBe("stop");
    const limited = cardErrorAdvice({ status: 429, code: "RATE_LIMITED", remainingAttempts: 0, retryAfterSec: 1800 });
    expect(limited.action).toBe("stop");
    expect(limited.message).toMatch(/30 phút/);
  });

  it("chưa đồng ý / hết phiên / đã có thẻ → điều hướng tương ứng", () => {
    expect(cardErrorAdvice({ status: 403, code: "CONSENT_REQUIRED" }).action).toBe("consent");
    expect(cardErrorAdvice({ status: 401, code: "UNAUTHORIZED" }).action).toBe("login");
    expect(cardErrorAdvice({ status: 409, code: "CARD_ALREADY_REGISTERED" }).action).toBe("refresh");
    expect(cardErrorAdvice({ status: 409, code: "CARD_PENDING_REVIEW" }).action).toBe("refresh");
    expect(cardErrorAdvice({ status: 403, code: "NOT_ENROLLED" }).action).toBe("stop");
  });

  it("mất mạng (status 0) / lỗi máy chủ → làm lại khuôn mặt (khung đã gửi không được giữ lại)", () => {
    expect(cardErrorAdvice({ status: 0, code: "NETWORK" })).toMatchObject({ action: "retake-face" });
    expect(cardErrorAdvice({ status: 0, code: "NETWORK" }).message).toMatch(/mạng/);
    expect(cardErrorAdvice({ status: 500, code: "INTERNAL" }).action).toBe("retake-face");
  });

  it("lỗi máy chủ không bắt được → 'Lỗi máy chủ (mã 500)', không phải 'Máy chủ đang bận'", () => {
    const a = cardErrorAdvice({ status: 500, code: "ERROR" });
    expect(a.message).toMatch(/^Lỗi máy chủ \(mã 500\)/);
    expect(a.message).not.toMatch(/đang bận/);
    expect(cardErrorAdvice({ status: 502, code: "ERROR" }).message).toMatch(/mã 502/);
  });

  it("kho ảnh chưa cấu hình (503 STORAGE_BUCKET_MISSING) → dừng, báo quản trị viên (thử lại không giúp gì)", () => {
    const a = cardErrorAdvice({ status: 503, code: "STORAGE_BUCKET_MISSING" });
    expect(a.action).toBe("stop");
    expect(a.message).toMatch(/quản trị viên/);
  });

  it("kho ảnh tạm không phản hồi (503 STORAGE_UNAVAILABLE) → thử lại sau, kèm số lượt (lượt đã được hoàn)", () => {
    const a = cardErrorAdvice({ status: 503, code: "STORAGE_UNAVAILABLE", remainingAttempts: 6 });
    expect(a.message).toMatch(/tạm thời/);
    expect(a.message).not.toMatch(/mã 503/);
    expect(a.attemptsNote).toBe("Bạn còn 6 lượt thử trong giờ này.");
  });

  it("OCR tạm không dùng được (503 OCR_UNAVAILABLE) → thông báo riêng", () => {
    expect(cardErrorAdvice({ status: 503, code: "OCR_UNAVAILABLE" }).message).toMatch(/tạm thời/);
  });

  it("mã lạ (kể cả DUPLICATE_FACE) → thông báo chung, không lộ mã", () => {
    for (const code of ["DUPLICATE_FACE", "LIVE_MISMATCH", "NAME_MISMATCH", "XYZ"]) {
      const a = cardErrorAdvice({ status: 422, code });
      expect(a.message).toBe("Không đăng ký được thẻ. Vui lòng thử lại.");
      expect(JSON.stringify(a)).not.toContain(code);
    }
  });

  it("KHÔNG thông báo nào nhắc tới trùng mặt / độ tương đồng / người khác", () => {
    for (const code of ADVICE_CODES) {
      const { message } = cardErrorAdvice({ status: 422, code, retryAfterSec: 60 });
      expect(message, code).not.toMatch(/trùng|tương đồng|similar|duplicate|người khác|sinh viên khác/i);
    }
  });
});
